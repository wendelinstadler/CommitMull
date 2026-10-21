import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pet } from "./Pet";
import { PetState } from "./sprites";

const DRAG_THRESHOLD = 4;
const BUBBLE_MS = 3000;

export default function App() {
  const [paused, setPaused] = useState(false);
  const [override, setOverride] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const state: PetState = paused ? "sleep" : override ?? "idle";

  const say = (text: string) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), BUBBLE_MS);
  };

  useEffect(() => {
    const unlisten = listen<boolean>("pause-changed", (e) => setPaused(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Nur im Dev-Modus: Tasten 1-5 schalten Animationen durch
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const order: PetState[] = ["idle", "walk", "sleep", "eat", "sad"];
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < order.length) setOverride(order[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    press.current = { x: e.screenX, y: e.screenY, dragging: false };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = press.current;
    if (!p || p.dragging) return;
    if (Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
      p.dragging = true;
      press.current = null;
      getCurrentWindow().startDragging();
    }
  };

  const onMouseUp = () => {
    if (press.current && !press.current.dragging) say("Hallo, ich bin CommitMull!");
    press.current = null;
  };

  return (
    <div
      className="stage"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => {
        e.preventDefault();
        invoke("show_pet_menu");
      }}
    >
      {bubble && <div className="bubble">{bubble}</div>}
      <Pet state={state} facing="right" />
    </div>
  );
}
