import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize, Window } from "@tauri-apps/api/window";
import { Pet } from "./Pet";
import { Panel } from "./Panel";
import { aimTarget, measureWindow, moodOf, useHunger, useWalker, WindowMeasure } from "./behavior";
import { useCommits } from "./commits";
import { DEFAULT_SETTINGS, useSettings } from "./settings";
import { PetState } from "./sprites";

const DRAG_THRESHOLD = 4;
const BUBBLE_MS = 3000;
const EAT_MS = 1000;
/** Fensterhoehe ohne und mit Panel (logische Pixel); das Fenster waechst nach oben. */
const CLOSED_H = 190;
const OPEN_H = 460;

export default function App() {
  const [paused, setPaused] = useState(false);
  const [override, setOverride] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const bubbleTimer = useRef<number | undefined>(undefined);
  /** Geisterfenster: halbtransparente Vorschau, wo das Tier landet, waehrend man zieht. */
  const ghost = useRef<{ win: Window | null; measure: WindowMeasure | null; active: boolean }>({
    win: null,
    measure: null,
    active: false,
  });
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const settings = useSettings();
  /** Futter pro Commit in Hunger-Anteilen (1 = komplett satt). */
  const foodPerCommit = (settings ?? DEFAULT_SETTINGS).foodPercent / 100;

  const { hunger, feed } = useHunger(paused, (settings ?? DEFAULT_SETTINGS).hungerHours);
  const mood = moodOf(hunger);
  const [eating, setEating] = useState(false);
  const eatTimer = useRef<number | undefined>(undefined);

  const canWalk = !paused && !override && !eating && !panelOpen;
  const { walking, facing, walkTo, stop } = useWalker(canWalk);

  const state: PetState = paused
    ? "sleep"
    : override ?? (eating ? "eat" : walking ? "walk" : mood === "sad" ? "sad" : "idle");

  /** Futter geben (spaeter: neue GitHub-Commits) und kurz fressen lassen. */
  const eat = (amount: number) => {
    feed(amount);
    setEating(true);
    window.clearTimeout(eatTimer.current);
    eatTimer.current = window.setTimeout(() => setEating(false), EAT_MS);
  };

  const say = (text: string) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), BUBBLE_MS);
  };

  // Neue GitHub-Commits sind Futter
  const { pollNow } = useCommits((fresh, today) => {
    eat(fresh * foodPerCommit);
    say(`${today} ${today === 1 ? "Commit" : "Commits"} heute!`);
  }, settings);

  useEffect(() => {
    const unlisten = listen<boolean>("pause-changed", (e) => setPaused(e.payload));
    invoke<boolean>("get_autostart").then(setAutostart);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Fenster nach oben aufziehen, wenn das Panel offen ist; die Unterkante (das Tier) bleibt stehen.
  useEffect(() => {
    const win = getCurrentWindow();
    (async () => {
      const [pos, size, scale] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
      const height = Math.round((panelOpen ? OPEN_H : CLOSED_H) * scale);
      if (height === size.height) return;
      const bottom = pos.y + size.height;
      await Promise.all([
        win.setSize(new PhysicalSize(size.width, height)),
        win.setPosition(new PhysicalPosition(pos.x, Math.max(0, bottom - height))),
      ]);
    })().catch(() => {});
  }, [panelOpen]);

  // Nur im Dev-Modus: Tasten 1-5 schalten Animationen durch, 0 = Automatik,
  // F = Futter geben, H = Hunger um 20 % senken, G = GitHub jetzt abfragen
  const eatRef = useRef(eat);
  eatRef.current = eat;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const foodRef = useRef(foodPerCommit);
  foodRef.current = foodPerCommit;
  const pollRef = useRef(pollNow);
  pollRef.current = pollNow;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const order: PetState[] = ["idle", "walk", "sleep", "eat", "sad"];
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < order.length) setOverride(order[i]);
      else if (e.key === "0") setOverride(null);
      else if (e.key === "f") eatRef.current(foodRef.current);
      else if (e.key === "h") feedRef.current(-0.2);
      else if (e.key === "g") pollRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    stop();
    // Capture: Bewegung und Loslassen kommen auch an, wenn die Maus das kleine Fenster verlaesst.
    e.currentTarget.setPointerCapture(e.pointerId);
    ghost.current.measure = null;
    measureWindow().then((m) => (ghost.current.measure = m));
    Window.getByLabel("ghost").then((w) => (ghost.current.win = w));
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
        <Panel
          hunger={hunger}
          mood={mood}
          paused={paused}
          autostart={autostart}
          onTogglePause={togglePause}
          onToggleAutostart={toggleAutostart}
          onSettings={openSettings}
          onQuit={() => invoke("quit_app")}
          onFeed={import.meta.env.DEV ? () => eat(foodPerCommit) : undefined}
        />
      )}
      <Pet state={state} facing={facing} />
    </div>
  );
}
