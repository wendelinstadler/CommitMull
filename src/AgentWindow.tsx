import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize, Window } from "@tauri-apps/api/window";
import { Pet } from "./Pet";
import { Panel } from "./Panel";
import { aimTarget, defaultNest, measureWindow, moodOf, sleepSpot, useWalker, WindowMeasure } from "./behavior";
import {
  AgentCommand,
  AgentFedPayload,
  AgentStatePayload,
  EVENT_AGENT_CMD,
  EVENT_AGENT_FED,
  EVENT_AGENT_SLEEP_REQUEST,
  EVENT_AGENT_STATE,
  EVENT_GHOST_LOOK,
  EVENT_SLEEP_ALL,
  HUB_LABEL,
} from "./protocol";
import { PetState } from "./sprites";

const DRAG_THRESHOLD = 4;
const BUBBLE_MS = 3000;
const EAT_MS = 1000;
/** Fensterhoehe ohne und mit Panel (logische Pixel); das Fenster waechst nach oben. */
const CLOSED_H = 190;
/** Hoechste Fensterhoehe mit Panel (logische Pixel), falls das Panel durch viele Eintraege hoch wird. */
const MAX_H = 900;

interface Props {
  id: string;
}

/** Fenster eines Agenten: zeigt das Tier an und meldet Eingaben; die Logik liegt im Hub. */
export function AgentWindow({ id }: Props) {
  const [info, setInfo] = useState<AgentStatePayload | null>(null);
  const [paused, setPaused] = useState(false);
  const [override, setOverride] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [eating, setEating] = useState(false);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const eatTimer = useRef<number | undefined>(undefined);
  /** Geisterfenster: halbtransparente Vorschau, wo das Tier landet, waehrend man zieht. */
  const ghost = useRef<{ win: Window | null; measure: WindowMeasure | null; active: boolean }>({
    win: null,
    measure: null,
    active: false,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  /** Hoehe des Panels (CSS-Pixel); das Fenster waechst entsprechend mit. */
  const [panelH, setPanelH] = useState(0);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const hunger = info?.hunger ?? 1;
  const mood = moodOf(hunger);

  const sleep = info?.sleep ?? "awake";
  const sleepWalk = sleep === "to-nest" || sleep === "back";

  const canWalk = !paused && !override && !eating && !panelOpen && sleep === "awake";
  const { walking, facing, walkTo, walkToPos, stop } = useWalker(canWalk || sleepWalk);

  const state: PetState = paused
    ? "sleep"
    : override ?? (sleep === "asleep" ? "sleep" : eating ? "eat" : walking ? "walk" : mood === "sad" ? "sad" : "idle");

  const command = (cmd: AgentCommand) => emitTo(HUB_LABEL, EVENT_AGENT_CMD, cmd).catch(() => {});

  const infoRef = useRef(info);
  infoRef.current = info;
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  /** Klappt das Panel zu und wartet, bis das Fenster wieder die kleine Hoehe hat (Position ist erst dann verlaesslich). */
  const settleClosed = async () => {
    if (!panelOpenRef.current) return;
    setPanelOpen(false);
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if ((await win.outerSize()).height <= Math.round(CLOSED_H * scale) + 2) return;
    }
  };

  /** Schlafen gehen: Platz und Nest an den Hub melden, der den Gang ins Nest anordnet. */
  const goToSleep = async () => {
    if (infoRef.current?.sleep !== "awake") return;
    await settleClosed();
    stop();
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const nest = infoRef.current?.nest ?? (await defaultNest());
    if (nest) command({ id, type: "sleep", home: { x: pos.x, y: pos.y }, nest });
  };

  const editNest = async () => {
    await settleClosed();
    const nest = infoRef.current?.nest ?? (await defaultNest());
    if (nest) command({ id, type: "nest-edit", nest });
  };

  const say = (text: string) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), BUBBLE_MS);
  };

  const eat = () => {
    setEating(true);
    window.clearTimeout(eatTimer.current);
    eatTimer.current = window.setTimeout(() => setEating(false), EAT_MS);
  };

  const goToSleepRef = useRef(goToSleep);
  goToSleepRef.current = goToSleep;

  // Schlafphasen: ins Nest laufen, nach dem Aufwecken zurueck an den Platz. Nach einem App-Start im Schlaf
  // wird das Tier direkt ins Nest gesetzt.
  const snapped = useRef(false);
  useEffect(() => {
    const cur = infoRef.current;
    if (!cur) return;
    let cancelled = false;
    const arrive = (ok: boolean) => {
      if (ok && !cancelled) command({ id, type: "arrived" });
    };
    // Die Ziele gelten fuer das kleine Fenster: erst das Panel zuklappen, dann laufen.
    if (cur.sleep === "to-nest" && cur.nest) {
      const nest = cur.nest;
      settleClosed()
        .then(() => sleepSpot(nest))
        .then((spot) => (cancelled ? false : walkToPos(spot)))
        .then(arrive);
    } else if (cur.sleep === "back" && cur.home) {
      const home = cur.home;
      settleClosed()
        .then(() => (cancelled ? false : walkToPos(home)))
        .then(arrive);
    } else if (cur.sleep === "asleep" && cur.nest && !snapped.current) {
      sleepSpot(cur.nest).then((spot) => getCurrentWindow().setPosition(new PhysicalPosition(spot.x, spot.y)));
    }
    snapped.current = true;
    return () => {
      cancelled = true;
    };
  }, [info?.sleep, info !== null]);

  // Zustand und Futter kommen vom Hub; danach melden wir uns beim Hub, damit er den Zustand schickt.
  const eatRef = useRef(eat);
  eatRef.current = eat;
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => {
    let alive = true;
    const unlisteners = Promise.all([
      listen<AgentStatePayload>(EVENT_AGENT_STATE, (e) => {
        if (e.payload.id === id) setInfo(e.payload);
      }),
      listen<AgentFedPayload>(EVENT_AGENT_FED, (e) => {
        eatRef.current();
        if (e.payload.text) sayRef.current(e.payload.text);
      }),
      listen<boolean>("pause-changed", (e) => setPaused(e.payload)),
      listen(EVENT_AGENT_SLEEP_REQUEST, () => goToSleepRef.current()),
    ]);
    unlisteners.then(() => {
      if (alive) command({ id, type: "ready" });
    });
    invoke<boolean>("get_paused").then(setPaused);
    invoke<boolean>("get_autostart").then(setAutostart);
    return () => {
      alive = false;
      unlisteners.then((list) => list.forEach((f) => f()));
    };
  }, [id]);

  // Fenster nach oben aufziehen, wenn das Panel offen ist; die Unterkante (das Tier) bleibt stehen.
  useEffect(() => {
    const win = getCurrentWindow();
    (async () => {
      const [pos, size, scale] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
      const target = panelOpen ? Math.min(MAX_H, CLOSED_H + panelH + 6) : CLOSED_H;
      const height = Math.round(target * scale);
      if (height === size.height) return;
      const bottom = pos.y + size.height;
      await Promise.all([
        win.setSize(new PhysicalSize(size.width, height)),
        win.setPosition(new PhysicalPosition(pos.x, Math.max(0, bottom - height))),
      ]);
    })().catch(() => {});
  }, [panelOpen, panelH]);

  // Panel-Hoehe beobachten (Eintragsliste, Formular ...).
  const ready = info !== null;
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !panelOpen) return;
    const observer = new ResizeObserver(() => setPanelH(el.offsetHeight));
    observer.observe(el);
    setPanelH(el.offsetHeight);
    return () => observer.disconnect();
  }, [panelOpen, ready]);

  // Nur im Dev-Modus: Tasten 1-5 schalten Animationen durch, 0 = Automatik,
  // F = Futter geben, H = Hunger um 20 % senken, G = Tracker jetzt abfragen
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const order: PetState[] = ["idle", "walk", "sleep", "eat", "sad"];
    const onKey = (e: KeyboardEvent) => {
      // Beim Tippen ins Panel (Betrag, Notiz) keine Dev-Tasten ausloesen.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < order.length) setOverride(order[i]);
      else if (e.key === "0") setOverride(null);
      else if (e.key === "f") command({ id, type: "dev-feed" });
      else if (e.key === "h") command({ id, type: "dev-hunger", delta: -0.2 });
      else if (e.key === "g") command({ id, type: "poll-now" });
      else if (e.key === "s") {
        if (infoRef.current?.sleep === "awake") goToSleepRef.current();
        else command({ id, type: "wake" });
      } else if (e.key === "S") emitTo(HUB_LABEL, EVENT_SLEEP_ALL, null).catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Auf dem Weg ins Nest oder zurueck laesst sich das Tier nicht anfassen.
    const phase = infoRef.current?.sleep;
    if (phase === "to-nest" || phase === "back") return;
    stop();
    // Capture: Bewegung und Loslassen kommen auch an, wenn die Maus das kleine Fenster verlaesst.
    e.currentTarget.setPointerCapture(e.pointerId);
    ghost.current.measure = null;
    measureWindow().then((m) => (ghost.current.measure = m));
    Window.getByLabel("ghost").then((w) => (ghost.current.win = w));
    if (info) emitTo("ghost", EVENT_GHOST_LOOK, { species: info.species, accessory: info.accessory }).catch(() => {});
    press.current = { x: e.screenX, y: e.screenY, dragging: false };
  };

  const canWalkRef = useRef(canWalk);
  canWalkRef.current = canWalk;
  const walkToRef = useRef(walkTo);
  walkToRef.current = walkTo;
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (p && !p.dragging && Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
        p.dragging = true;
      }
      const g = ghost.current;
      if (p?.dragging && canWalkRef.current && g.win && g.measure) {
        const t = aimTarget(g.measure, e.screenX, e.screenY);
        const win = g.win;
        g.active = true;
        // Nach dem Loslassen (active = false) darf ein noch laufender Aufruf nicht mehr einblenden.
        win
          .setPosition(new PhysicalPosition(t.x, t.y))
          .then(() => (g.active ? win.show() : undefined))
          .catch(() => {});
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      const g = ghost.current;
      g.active = false;
      g.win?.hide().catch(() => {});
      if (!p || e.button !== 0) return;
      if (!p.dragging) setPanelOpen((open) => !open);
      else if (canWalkRef.current) walkToRef.current(e.screenX, e.screenY);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const togglePause = () => invoke("set_paused", { paused: !paused });
  const toggleAutostart = () => invoke<boolean>("set_autostart", { enabled: !autostart }).then(setAutostart);
  const openSettings = () => {
    setPanelOpen(false);
    invoke("open_settings");
  };

  // Bis der Hub den ersten Zustand geschickt hat, nichts zeigen (sonst blitzt kurz der falsche Hunger auf).
  if (!info) return null;

  return (
    <div
      className="stage"
      onPointerDown={onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        invoke("show_pet_menu");
      }}
    >
      {bubble && <div className="bubble">{bubble}</div>}
      {panelOpen && (
        <div ref={panelRef}>
        <Panel
          name={info.name}
          subtitle={info.roleLabel}
          hunger={hunger}
          mood={mood}
          paused={paused}
          sleep={sleep}
          onSleep={goToSleep}
          onWake={() => command({ id, type: "wake" })}
          onNestEdit={editNest}
          views={info.views}
          onEntry={(amount, note) => command({ id, type: "entry", amount, note })}
          onUndo={() => command({ id, type: "entry-undo" })}
          onFocusToggle={() => command({ id, type: "focus-toggle" })}
          autostart={autostart}
          onTogglePause={togglePause}
          onToggleAutostart={toggleAutostart}
          onSettings={openSettings}
          onQuit={() => invoke("quit_app")}
          onFeed={import.meta.env.DEV ? () => command({ id, type: "dev-feed" }) : undefined}
        />
        </div>
      )}
      <Pet species={info.species} accessory={info.accessory} board={info.views.entries?.over ? "over" : "ok"} state={state} facing={facing} />
    </div>
  );
}
