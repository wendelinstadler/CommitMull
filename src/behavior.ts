import { useCallback, useEffect, useRef, useState } from "react";
import { Point } from "./agents";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

export type Mood = "happy" | "ok" | "sad";

/** hunger: 1 = satt, 0 = leer. */
export function moodOf(hunger: number): Mood {
  if (hunger > 0.6) return "happy";
  if (hunger >= 0.2) return "ok";
  return "sad";
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

/** Groesse des Nestfensters in logischen Pixeln (muss zu lib.rs passen). */
export const NEST_W = 150;
export const NEST_H = 72;
/** So viele logische Pixel sinkt das Tier ins Nest ein (Fuesse unterhalb der Nestoberkante). */
const NEST_SINK = 8;

/**
 * Fensterposition des Tiers, wenn es im Nest liegt (physische Pixel): mittig ueber dem Nest, Fuesse im Nest.
 * nest = obere linke Ecke des Nestfensters.
 */
export async function sleepSpot(nest: Point): Promise<Point> {
  const win = getCurrentWindow();
  const [size, scale] = await Promise.all([win.outerSize(), win.scaleFactor()]);
  return {
    x: Math.round(nest.x + (NEST_W * scale - size.width) / 2),
    y: Math.round(nest.y + (NEST_H - NEST_SINK) * scale - size.height),
  };
}

/** Standardnest: unten am Bildschirmrand (Arbeitsbereich), unter dem aktuellen Standort des Tiers. */
export async function defaultNest(): Promise<Point | null> {
  const m = await measureWindow();
  if (!m) return null;
  const w = NEST_W * m.scale;
  const h = NEST_H * m.scale;
  const x = m.pos.x + (m.size.width - w) / 2;
  return {
    x: Math.round(Math.min(Math.max(x, m.area.position.x), m.area.position.x + m.area.size.width - w)),
    y: Math.round(m.area.position.y + m.area.size.height - h),
  };
}

/**
 * Laesst das Fenster ueber den Bildschirm zu einem Ziel laufen (walkTo bzw. walkToPos).
 * Mit enabled = false bricht ein laufender Gang ab (Pause, Panel offen, Fressen ...).
 * Beide Funktionen liefern true, wenn das Ziel erreicht wurde, und false, wenn der Gang abgebrochen wurde.
 */
export function useWalker(enabled: boolean) {
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const stepTimer = useRef<number | undefined>(undefined);
  /** Jeder Aufruf von stop/walkTo erhoeht die Nummer; veraltete async-Laeufe erkennen sich daran. */
  const run = useRef(0);
  /** Wartet auf das Ende des laufenden Gangs (true = angekommen, false = abgebrochen). */
  const pending = useRef<((arrived: boolean) => void) | null>(null);

  const stop = useCallback(() => {
    run.current++;
    window.clearInterval(stepTimer.current);
    setWalking(false);
    pending.current?.(false);
    pending.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => stop, [stop]);

  /** Laeuft zu dem Fenster-Ziel, das resolveTarget aus der Messung berechnet (physische Pixel). */
  const goTo = useCallback(
    async (resolveTarget: (m: WindowMeasure) => Point): Promise<boolean> => {
      stop();
      const token = run.current;
      const win = getCurrentWindow();
      const m = await measureWindow();
      if (token !== run.current || !m) return false;
      const { pos, scale } = m;
      const { x: targetX, y: targetY } = resolveTarget(m);

      let x = pos.x;
      let y = pos.y;
      const step = Math.max(1, (WALK_SPEED * scale * STEP_MS) / 1000);
      if (Math.hypot(targetX - x, targetY - y) <= step) {
        await win.setPosition(new PhysicalPosition(targetX, targetY)).catch(() => {});
        return true;
      }
      if (targetX !== x) setFacing(targetX < x ? "left" : "right");
      setWalking(true);

      return new Promise<boolean>((resolve) => {
        pending.current = resolve;
        stepTimer.current = window.setInterval(() => {
          const dx = targetX - x;
          const dy = targetY - y;
          const dist = Math.hypot(dx, dy);
          if (dist <= step) {
            x = targetX;
            y = targetY;
            window.clearInterval(stepTimer.current);
            setWalking(false);
            pending.current = null;
            resolve(true);
          } else {
            x += (dx / dist) * step;
            y += (dy / dist) * step;
          }
          win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y))).catch(() => {});
        }, STEP_MS);
      });
    },
    [stop],
  );

  /** screenX/screenY: Zielpunkt in CSS-Pixeln auf dem Bildschirm; die Fuesse des Tiers laufen dorthin. */
  const walkTo = useCallback(
    (screenX: number, screenY: number) => goTo((m) => aimTarget(m, screenX, screenY)),
    [goTo],
  );

  /** Laeuft zu einer Fensterposition (physische Pixel), z. B. ins Nest; bleibt im Arbeitsbereich des Monitors. */
  const walkToPos = useCallback(
    (target: Point) =>
      goTo((m) => ({
        x: Math.min(Math.max(target.x, m.area.position.x), m.area.position.x + m.area.size.width - m.size.width),
        y: Math.min(Math.max(target.y, m.area.position.y), m.area.position.y + m.area.size.height - m.size.height),
      })),
    [goTo],
  );

  return { walking, facing, walkTo, walkToPos, stop };
}
