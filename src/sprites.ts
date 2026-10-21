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
  /** Anheben der Beine in Pixeln: vorne rechts, vorne links, hinten rechts, hinten links */
  legs: [number, number, number, number];
  eyes: "open" | "closed" | "sad";
  mouthOpen: boolean;
  tear: boolean;
  /** 0 = kein Z, 1..3 = so viele Z */
  zzz: number;
  food: { x: number; y: number } | null;
}

const base: Pose = {
  bodyDy: 0,
  legs: [0, 0, 0, 0],
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
    pose({ legs: [3, 0, 0, 3] }),
    pose({ legs: [0, 0, 0, 0], bodyDy: 1 }),
    pose({ legs: [0, 3, 3, 0] }),
    pose({ legs: [0, 0, 0, 0], bodyDy: 1 }),
  ],
  sleep: [
    pose({ bodyDy: 3, eyes: "closed", zzz: 1 }),
    pose({ bodyDy: 4, eyes: "closed", zzz: 2 }),
    pose({ bodyDy: 3, eyes: "closed", zzz: 3 }),
    pose({ bodyDy: 4, eyes: "closed", zzz: 0 }),
  ],
  eat: [
    pose({ food: { x: 58, y: 24 }, mouthOpen: true }),
    pose({ food: { x: 58, y: 32 }, mouthOpen: true }),
    pose({ food: { x: 57, y: 40 } }),
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

/** Zeichnet den Nacktmull (blickt nach rechts) auf eine 64x64-Flaeche. */
export function drawPet(ctx: Ctx, state: PetState, frame: number) {
  const frames = FRAMES[state];
  const p = frames[frame % frames.length];
  const dy = p.bodyDy;

  ctx.clearRect(0, 0, SIZE, SIZE);

  // Schwanz
  rect(ctx, 5, 38 + dy, 5, 2, C.outline);
  rect(ctx, 6, 38 + dy, 3, 1, C.shade);

  // Beine (hinter dem Koerper)
  const legX = [43, 37, 17, 11];
  const legBase = 49;
  p.legs.forEach((lift, i) => {
    const h = Math.max(2, 6 - lift - Math.min(dy, 2));
    const y = legBase + dy - 1 + lift;
    rect(ctx, legX[i], y, 4, h, C.outline);
    rect(ctx, legX[i] + 1, y, 2, h - 1, C.skin);
  });

  // Koerper
  ellipse(ctx, 30, 38 + dy, 22, 13, C.outline);
  ellipse(ctx, 30, 38 + dy, 20, 11, C.skin);
  // Falten
  for (const [x, y] of [[20, 32], [26, 30], [33, 31], [24, 40], [31, 42], [38, 40]]) {
    rect(ctx, x, y + dy, 3, 1, C.shade);
  }

  // Kopf
  ellipse(ctx, 47, 37 + dy, 10, 9, C.outline);
  ellipse(ctx, 47, 37 + dy, 8, 7, C.skin);
  rect(ctx, 41, 30 + dy, 2, 2, C.shade); // Ohr

  // Mund und Zaehne
  if (p.mouthOpen) {
    rect(ctx, 52, 41 + dy, 6, 5, C.mouth);
    rect(ctx, 54, 40 + dy, 2, 3, C.teeth);
    rect(ctx, 56, 40 + dy, 2, 3, C.teeth);
  } else {
    rect(ctx, 54, 41 + dy, 2, 4, C.teeth);
    rect(ctx, 56, 41 + dy, 2, 4, C.teeth);
    rect(ctx, 54, 45 + dy, 4, 1, C.outline);
  }

  // Auge
  if (p.eyes === "open") {
    rect(ctx, 51, 33 + dy, 2, 2, C.eye);
  } else if (p.eyes === "closed") {
    rect(ctx, 50, 34 + dy, 4, 1, C.eye);
  } else {
    rect(ctx, 51, 34 + dy, 2, 2, C.eye);
    rect(ctx, 49, 32 + dy, 2, 1, C.outline);
    rect(ctx, 51, 31 + dy, 3, 1, C.outline);
  }
  if (p.tear) rect(ctx, 53, 36 + dy, 1, 3, C.tear);

  // Schlafen
  if (p.zzz >= 1) drawZ(ctx, 50, 22, 4);
  if (p.zzz >= 2) drawZ(ctx, 55, 14, 5);
  if (p.zzz >= 3) drawZ(ctx, 48, 8, 3);

  // Futter (ein gruener Commit-Block)
  if (p.food) {
    rect(ctx, p.food.x, p.food.y, 5, 5, C.food);
    rect(ctx, p.food.x, p.food.y, 5, 1, C.foodLight);
    rect(ctx, p.food.x, p.food.y, 1, 5, C.foodLight);
  }
}
