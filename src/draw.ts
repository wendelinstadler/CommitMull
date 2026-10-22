/** Gemeinsame Typen und Zeichenhilfen fuer Tierarten und Accessoires (64x64-Pixelflaeche). */

export type PetState = "idle" | "walk" | "sleep" | "eat" | "sad";

export const SIZE = 64;

export type Ctx = CanvasRenderingContext2D;

export interface Pose {
  bodyDy: number;
  /** Anheben der Beine in Pixeln: links, rechts */
  legs: [number, number];
  eyes: "open" | "closed" | "sad";
  mouthOpen: boolean;
  tear: boolean;
  /** 0 = kein Z, 1..3 = so viele Z */
  zzz: number;
  food: { x: number; y: number } | null;
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Ellipse mit 2 Pixel Umriss (1 Pixel breiter als die Fuellung nach jeder Seite). */
export function outlined(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, outline: string) {
  ellipse(ctx, cx, cy, rx + 2, ry + 2, outline);
  ellipse(ctx, cx, cy, rx, ry, fill);
}

/** Rechteck mit 1 Pixel Umriss ausserhalb. */
export function boxed(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, outline: string) {
  rect(ctx, x - 1, y - 1, w + 2, h + 2, outline);
  rect(ctx, x, y, w, h, fill);
}

/**
 * Gefuelltes Dreieck: Spitze oben (bei apex = "left"/"right" zu dieser Seite versetzt), Basis unten.
 * (x, y) ist die linke obere Ecke der Begrenzungsbox.
 */
export function tri(ctx: Ctx, x: number, y: number, w: number, h: number, apex: "left" | "right", c: string) {
  ctx.fillStyle = c;
  for (let i = 0; i < h; i++) {
    const rowW = Math.max(1, Math.round((w * (i + 1)) / h));
    const rx = apex === "left" ? x : x + w - rowW;
    ctx.fillRect(rx, y + i, rowW, 1);
  }
}

/** Gerade Linie aus Einzelpixeln (Bresenham). */
export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, c: string) {
  ctx.fillStyle = c;
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x, y, 1, 1);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export interface EyeColors {
  eye: string;
  outline: string;
  /** Farbiger Ring um das Auge (Echse, Schlange). */
  ring?: string;
}

/**
 * Zwei Augen in Vorderansicht. (cx, y) ist Mitte und Oberkante, dx der Abstand der Augen von der Mitte.
 * Zeichnet auch die Traene unter dem linken Auge.
 */
export function drawEyes(ctx: Ctx, p: Pose, cx: number, y: number, dx: number, c: EyeColors, tearColor: string) {
  const lx = cx - dx - 1;
  const rx = cx + dx - 1;
  if (p.eyes === "closed") {
    rect(ctx, lx - 1, y + 1, 4, 1, c.eye);
    rect(ctx, rx - 1, y + 1, 4, 1, c.eye);
    return;
  }
  const ey = p.eyes === "sad" ? y + 1 : y;
  if (c.ring) {
    rect(ctx, lx - 1, ey - 1, 4, 4, c.ring);
    rect(ctx, rx - 1, ey - 1, 4, 4, c.ring);
  }
  rect(ctx, lx, ey, 2, 2, c.eye);
  rect(ctx, rx, ey, 2, 2, c.eye);
  if (p.eyes === "sad") {
    rect(ctx, lx - 1, ey - 2, 2, 1, c.outline);
    rect(ctx, lx + 1, ey - 3, 2, 1, c.outline);
    rect(ctx, rx + 1, ey - 2, 2, 1, c.outline);
    rect(ctx, rx - 1, ey - 3, 2, 1, c.outline);
  }
  if (p.tear) rect(ctx, lx, y + 4, 1, 3, tearColor);
}
