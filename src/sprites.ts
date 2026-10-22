export type PetState = "idle" | "walk" | "sleep" | "eat" | "sad";

export const SIZE = 64;

const C = {
  outline: "#7a3b4a",
  skin: "#e8a0a8",
  shade: "#c97a86",
  teeth: "#fff3c4",
  eye: "#2b1620",
  mouth: "#4a1f2c",
  tear: "#6ab7ff",
  food: "#3fb950",
  foodLight: "#7ee787",
  zzz: "#8ab4ff",
};

interface Pose {
  bodyDy: number;
  /** Anheben der Beine in Pixeln: links, rechts */
  legs: [number, number];
  /** Seitliches Wackeln des ganzen Tiers in Pixeln */
  sway: number;
  eyes: "open" | "closed" | "sad";
  mouthOpen: boolean;
  tear: boolean;
  /** 0 = kein Z, 1..3 = so viele Z */
  zzz: number;
  food: { x: number; y: number } | null;
}

const base: Pose = {
  bodyDy: 0,
  legs: [0, 0],
  sway: 0,
  eyes: "open",
  mouthOpen: false,
  tear: false,
  zzz: 0,
  food: null,
};

const pose = (p: Partial<Pose>): Pose => ({ ...base, ...p });

export const FRAMES: Record<PetState, Pose[]> = {
  idle: [pose({}), pose({ bodyDy: 1 })],
  walk: [
    pose({ legs: [3, 0], sway: -1 }),
    pose({ bodyDy: 1 }),
    pose({ legs: [0, 3], sway: 1 }),
    pose({ bodyDy: 1 }),
  ],
  sleep: [
    pose({ bodyDy: 3, eyes: "closed", zzz: 1 }),
    pose({ bodyDy: 4, eyes: "closed", zzz: 2 }),
    pose({ bodyDy: 3, eyes: "closed", zzz: 3 }),
    pose({ bodyDy: 4, eyes: "closed", zzz: 0 }),
  ],
  eat: [
    pose({ food: { x: 50, y: 24 }, mouthOpen: true }),
    pose({ food: { x: 45, y: 30 }, mouthOpen: true }),
    pose({ food: { x: 39, y: 34 } }),
    pose({ bodyDy: 1, eyes: "closed" }),
  ],
  sad: [
    pose({ bodyDy: 2, eyes: "sad", tear: true }),
    pose({ bodyDy: 3, eyes: "sad" }),
  ],
};

export const FRAME_MS: Record<PetState, number> = {
  idle: 600,
  walk: 160,
  sleep: 700,
  eat: 250,
  sad: 700,
};

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) {
  ctx.fillStyle = c;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawZ(ctx: Ctx, x: number, y: number, s: number) {
  rect(ctx, x, y, s, 1, C.zzz);
  for (let i = 0; i < s; i++) rect(ctx, x + s - 1 - i, y + i, 1, 1, C.zzz);
  rect(ctx, x, y + s - 1, s, 1, C.zzz);
}

/** Zeichnet den Nacktmull in Vorderansicht (schaut den Betrachter an) auf eine 64x64-Flaeche. */
export function drawPet(ctx: Ctx, state: PetState, frame: number) {
  const frames = FRAMES[state];
  const p = frames[frame % frames.length];
  const dy = p.bodyDy;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.translate(p.sway, 0);

  // Beine (hinter dem Koerper)
  const legX = [21, 40];
  p.legs.forEach((lift, i) => {
    const h = Math.max(2, 6 - lift - Math.min(dy, 2));
    const y = 55 + dy + lift;
    rect(ctx, legX[i], y, 4, h, C.outline);
    rect(ctx, legX[i] + 1, y, 2, h - 1, C.skin);
  });

  // Koerper
  ellipse(ctx, 32, 41 + dy, 19, 17, C.outline);
  ellipse(ctx, 32, 41 + dy, 17, 15, C.skin);
  // Falten
  for (const [x, y] of [[20, 40], [26, 46], [38, 46], [41, 40], [30, 50], [24, 36], [37, 36]]) {
    rect(ctx, x, y + dy, 3, 1, C.shade);
  }
  // Haendchen
  for (const x of [17, 44]) {
    rect(ctx, x, 44 + dy, 3, 4, C.outline);
    rect(ctx, x, 44 + dy, 2, 3, C.skin);
  }

  // Kopf
  ellipse(ctx, 32, 28 + dy, 13, 11, C.outline);
  ellipse(ctx, 32, 28 + dy, 11, 9, C.skin);
  rect(ctx, 20, 27 + dy, 2, 3, C.shade); // Ohren
  rect(ctx, 42, 27 + dy, 2, 3, C.shade);
  rect(ctx, 28, 30 + dy, 8, 4, C.shade); // Schnauze
  rect(ctx, 30, 29 + dy, 4, 2, C.outline); // Nase

  // Mund und Zaehne
  if (p.mouthOpen) {
    rect(ctx, 28, 33 + dy, 8, 6, C.mouth);
    rect(ctx, 29, 33 + dy, 3, 3, C.teeth);
    rect(ctx, 32, 33 + dy, 3, 3, C.teeth);
  } else {
    rect(ctx, 29, 34 + dy, 3, 4, C.teeth);
    rect(ctx, 32, 34 + dy, 3, 4, C.teeth);
    rect(ctx, 28, 38 + dy, 8, 1, C.outline);
  }

  // Augen
  if (p.eyes === "open") {
    rect(ctx, 25, 24 + dy, 2, 2, C.eye);
    rect(ctx, 37, 24 + dy, 2, 2, C.eye);
  } else if (p.eyes === "closed") {
    rect(ctx, 24, 25 + dy, 4, 1, C.eye);
    rect(ctx, 36, 25 + dy, 4, 1, C.eye);
  } else {
    rect(ctx, 25, 25 + dy, 2, 2, C.eye);
    rect(ctx, 37, 25 + dy, 2, 2, C.eye);
    rect(ctx, 24, 23 + dy, 2, 1, C.outline);
    rect(ctx, 26, 22 + dy, 2, 1, C.outline);
    rect(ctx, 38, 23 + dy, 2, 1, C.outline);
    rect(ctx, 36, 22 + dy, 2, 1, C.outline);
  }
  if (p.tear) rect(ctx, 25, 28 + dy, 1, 3, C.tear);

  ctx.restore();

  // Schlafen
  if (p.zzz >= 1) drawZ(ctx, 46, 12, 4);
  if (p.zzz >= 2) drawZ(ctx, 51, 6, 5);
  if (p.zzz >= 3) drawZ(ctx, 42, 3, 3);

  // Futter (ein gruener Commit-Block)
  if (p.food) {
    rect(ctx, p.food.x, p.food.y, 5, 5, C.food);
    rect(ctx, p.food.x, p.food.y, 5, 1, C.foodLight);
    rect(ctx, p.food.x, p.food.y, 1, 5, C.foodLight);
  }
}
