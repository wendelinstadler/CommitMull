import { useCallback, useEffect, useRef, useState } from "react";
import { load, Store } from "@tauri-apps/plugin-store";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

/** Dauer, in der der Hunger (aktive, nicht pausierte Zeit) von voll auf leer faellt. */
export const HUNGER_EMPTY_MS = 8 * 60 * 60 * 1000;
const TICK_MS = 30_000;
const STORE_FILE = "state.json";

export type Mood = "happy" | "ok" | "sad";

/** hunger: 1 = satt, 0 = leer. */
export function moodOf(hunger: number): Mood {
  if (hunger > 0.6) return "happy";
  if (hunger >= 0.2) return "ok";
  return "sad";
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function useHunger(paused: boolean) {
  const [hunger, setHunger] = useState(1);
  const hungerRef = useRef(1);
  const pausedRef = useRef(paused);
  const store = useRef<Store | null>(null);
  pausedRef.current = paused;

  const apply = useCallback((next: number) => {
    hungerRef.current = clamp(next);
    setHunger(hungerRef.current);
  }, []);

  const save = useCallback(() => {
    const s = store.current;
    if (!s) return;
    s.set("hunger", hungerRef.current).then(() => s.save());
  }, []);

  useEffect(() => {
    let alive = true;
    load(STORE_FILE, { defaults: {}, autoSave: false }).then(async (s) => {
      const saved = await s.get<number>("hunger");
      if (!alive) return;
      store.current = s;
      if (typeof saved === "number") apply(saved);
    });

    // Die Zeit zaehlt nur, solange das Tier laeuft und nicht pausiert ist.
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      if (pausedRef.current) return;
      apply(hungerRef.current - elapsed / HUNGER_EMPTY_MS);
      save();
    }, TICK_MS);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [apply, save]);

  const feed = useCallback(
    (amount: number) => {
      apply(hungerRef.current + amount);
      save();
    },
    [apply, save],
  );

  return { hunger, feed };
}

const STEP_MS = 50;
/** Lauftempo in logischen Pixeln pro Sekunde. */
const WALK_SPEED = 45;

export interface WindowMeasure {
  area: { position: { x: number; y: number }; size: { width: number; height: number } };
  pos: { x: number; y: number };
  size: { width: number; height: number };
  scale: number;
}

/** Misst Fenster und Arbeitsbereich des Monitors, auf dem das Fenster liegt (physische Pixel). */
export async function measureWindow(): Promise<WindowMeasure | null> {
  const win = getCurrentWindow();
  const [monitor, pos, size, scale] = await Promise.all([
    currentMonitor(),
    win.outerPosition(),
    win.outerSize(),
    win.scaleFactor(),
  ]);
  return monitor ? { area: monitor.workArea, pos, size, scale } : null;
}

/**
 * Fensterposition (physisch), bei der die Fuesse des Tiers am Bildschirmpunkt screenX/screenY
 * (CSS-Pixel) stehen. Das Tier steht mittig unten im Fenster.
 */
export function aimTarget(m: WindowMeasure, screenX: number, screenY: number) {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  return {
    x: clamp(
      Math.round(screenX * m.scale - m.size.width / 2),
      m.area.position.x,
      m.area.position.x + m.area.size.width - m.size.width,
    ),
    y: clamp(
      Math.round(screenY * m.scale - m.size.height),
      m.area.position.y,
      m.area.position.y + m.area.size.height - m.size.height,
    ),
  };
}

/**
 * Laesst das Fenster ueber den Bildschirm zu einem Ziel laufen (walkTo).
 * Mit enabled = false bricht ein laufender Gang ab (Pause, Panel offen, Fressen ...).
 */
export function useWalker(enabled: boolean) {
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const stepTimer = useRef<number | undefined>(undefined);
  /** Jeder Aufruf von stop/walkTo erhoeht die Nummer; veraltete async-Laeufe erkennen sich daran. */
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current++;
    window.clearInterval(stepTimer.current);
    setWalking(false);
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => stop, [stop]);

  /** screenX/screenY: Zielpunkt in CSS-Pixeln auf dem Bildschirm; die Fuesse des Tiers laufen dorthin. */
  const walkTo = useCallback(
    async (screenX: number, screenY: number) => {
      stop();
      const token = run.current;
      const win = getCurrentWindow();
      const m = await measureWindow();
      if (token !== run.current || !m) return;
      const { pos, scale } = m;
      const { x: targetX, y: targetY } = aimTarget(m, screenX, screenY);

      let x = pos.x;
      let y = pos.y;
      const step = Math.max(1, (WALK_SPEED * scale * STEP_MS) / 1000);
      if (Math.hypot(targetX - x, targetY - y) <= step) return;
      if (targetX !== x) setFacing(targetX < x ? "left" : "right");
      setWalking(true);

      stepTimer.current = window.setInterval(() => {
        const dx = targetX - x;
        const dy = targetY - y;
        const dist = Math.hypot(dx, dy);
        if (dist <= step) {
          x = targetX;
          y = targetY;
          window.clearInterval(stepTimer.current);
          setWalking(false);
        } else {
          x += (dx / dist) * step;
          y += (dy / dist) * step;
        }
        win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y))).catch(() => {});
      }, STEP_MS);
    },
    [stop],
  );

  return { walking, facing, walkTo, stop };
}
