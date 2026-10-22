import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { Pet } from "./Pet";
import { Panel } from "./Panel";
import { moodOf, useHunger, useWalker } from "./behavior";
import { PetState } from "./sprites";

const DRAG_THRESHOLD = 4;
const BUBBLE_MS = 3000;
const EAT_MS = 1000;
/** Fensterhoehe ohne und mit Panel (logische Pixel); das Fenster waechst nach oben. */
const CLOSED_H = 190;
const OPEN_H = 460;
/** Futter pro Commit in Hunger-Anteilen (1 = komplett satt). */
const FOOD_PER_COMMIT = 0.25;

export default function App() {
  const [paused, setPaused] = useState(false);
  const [override, setOverride] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const { hunger, feed } = useHunger(paused);
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
        win.setPosition(new PhysicalPosition(pos.x, bottom - height)),
      ]);
    })().catch(() => {});
  }, [panelOpen]);

  // Nur im Dev-Modus: Tasten 1-5 schalten Animationen durch, 0 = Automatik,
  // F = Futter geben, H = Hunger um 20 % senken
  const eatRef = useRef(eat);
  eatRef.current = eat;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const order: PetState[] = ["idle", "walk", "sleep", "eat", "sad"];
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < order.length) setOverride(order[i]);
      else if (e.key === "0") setOverride(null);
      else if (e.key === "f") eatRef.current(FOOD_PER_COMMIT);
      else if (e.key === "h") feedRef.current(-0.2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    stop();
    press.current = { x: e.screenX, y: e.screenY, dragging: false };
  };

  // Maus- und Loslass-Ereignisse am Fenster, damit auch ein Loslassen ausserhalb des Fensters ankommt.
  const canWalkRef = useRef(canWalk);
  canWalkRef.current = canWalk;
  const walkToRef = useRef(walkTo);
  walkToRef.current = walkTo;
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = press.current;
      if (p && !p.dragging && Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
        p.dragging = true;
      }
    };
    const onUp = (e: MouseEvent) => {
      const p = press.current;
      press.current = null;
      if (!p || e.button !== 0) return;
      if (!p.dragging) setPanelOpen((open) => !open);
      else if (canWalkRef.current) walkToRef.current(e.screenX);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const togglePause = () => invoke("set_paused", { paused: !paused });
  const toggleAutostart = () => invoke<boolean>("set_autostart", { enabled: !autostart }).then(setAutostart);
  const openSettings = () => {
    setPanelOpen(false);
    say("Einstellungen kommen noch.");
  };

  return (
    <div
      className="stage"
      onMouseDown={onMouseDown}
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
          onFeed={import.meta.env.DEV ? () => eat(FOOD_PER_COMMIT) : undefined}
        />
      )}
      <Pet state={state} facing={facing} />
    </div>
  );
}
