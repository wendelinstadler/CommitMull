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
      const [monitor, pos, size, scale] = await Promise.all([
        currentMonitor(),
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
      ]);
      if (token !== run.current || !monitor) return;

      const area = monitor.workArea;
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
      const targetX = clamp(
        Math.round(screenX * scale - size.width / 2),
        area.position.x,
        area.position.x + area.size.width - size.width,
      );
      // Das Tier steht unten im Fenster, die Fenster-Unterkante liegt also bei den Fuessen.
      const targetY = clamp(
        Math.round(screenY * scale - size.height),
        area.position.y,
        area.position.y + area.size.height - size.height,
      );

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
