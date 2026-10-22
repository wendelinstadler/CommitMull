import { Ctx, drawEyes, ellipse, outlined, Pose, rect, tri } from "./draw";

/**
 * Tierarten. Vierbeiner (Nacktmull, Katze, Hund, Echse, Maulwurf) sind reine Daten (QuadFront,
 * QuadSide) fuer einen gemeinsamen Zeichner; Vogel und Schlange haben eigene Zeichenfunktionen.
 * Eine neue Art braucht: Palette, Beschreibung (oder eigene Funktionen), Ankerpunkte, einen Eintrag in SPECIES.
 *
 * Ankerpunkte fuer Accessoires: hold = Mitte oben vor dem Bauch (Vorderansicht),
 * back = Rueckenpunkt (Seitenansicht).
 */
export type Species = "naked-mole-rat" | "cat" | "dog" | "lizard" | "snake" | "bird" | "mole";

export interface Anchor {
  x: number;
  y: number;
}

export interface SpeciesInfo {
  id: Species;
  label: string;
  /** Vorderansicht (schaut den Betrachter an). */
  front: (ctx: Ctx, p: Pose) => void;
  /** Seitenansicht beim Laufen, blickt nach rechts. */
  side: (ctx: Ctx, frame: number) => void;
  hold: Anchor;
  back: Anchor;
}

interface Palette {
  outline: string;
  body: string;
  shade: string;
  light: string;
  /** Nase, Hautfarbe an Pfoten, Schnabel */
  nose: string;
  eye: string;
  mouth: string;
  tongue: string;
  ring?: string;
}

const TEAR = "#6ab7ff";

/** [x, y, Breite, Hoehe] */
type R = [number, number, number, number];

function drawRects(ctx: Ctx, rs: R[], dy: number, fill: string, outline: string) {
  for (const [x, y, w, h] of rs) rect(ctx, x - 1, y - 1 + dy, w + 2, h + 2, outline);
  for (const [x, y, w, h] of rs) rect(ctx, x, y + dy, w, h, fill);
}

// ---------------------------------------------------------------------------------------------
// Vierbeiner

type Ears = "none" | "tiny" | "pointy" | "floppy" | "round";
type Face = "rat" | "cat" | "dog" | "lizard" | "mole";
type Marks = "none" | "wrinkles" | "stripes" | "patch" | "spots";

interface QuadFront {
  /** Halbachsen der Fuellung (der Umriss kommt aussen dazu). */
  body: [number, number];
  head: [number, number];
  ears: Ears;
  face: Face;
  marks: Marks;
  belly: boolean;
  hands: "none" | "rat" | "spades";
  tail?: R[];
  /** Farbe der Beine: Koerper, hell oder Schattenton. */
  legs: "body" | "light" | "shade" | "nose";
  eyeDx: number;
}

const WRINKLES_FRONT: [number, number][] = [[20, 40], [26, 46], [38, 46], [41, 40], [30, 50], [24, 36], [37, 36]];
const SPOTS_FRONT: [number, number][] = [[22, 38], [38, 40], [28, 48], [35, 35], [24, 46], [42, 46]];

function quadFront(ctx: Ctx, p: Pose, c: Palette, f: QuadFront) {
  const dy = p.bodyDy;
  const [brx, bry] = f.body;
  const [hrx, hry] = f.head;

  if (f.tail) drawRects(ctx, f.tail, dy, c.body, c.outline);

  // Ohren hinter dem Kopf
  if (f.ears === "pointy") {
    for (const [x, apex] of [[19, "left"], [36, "right"]] as const) {
      tri(ctx, x - 1, 12 + dy, 11, 11, apex, c.outline);
      tri(ctx, x, 13 + dy, 9, 9, apex, c.body);
      tri(ctx, apex === "left" ? x + 1 : x + 3, 17 + dy, 5, 5, apex, c.nose);
    }
  } else if (f.ears === "floppy") {
    outlined(ctx, 16, 30 + dy, 3, 7, c.shade, c.outline);
    outlined(ctx, 48, 30 + dy, 3, 7, c.shade, c.outline);
  } else if (f.ears === "round") {
    outlined(ctx, 21, 19 + dy, 3, 3, c.body, c.outline);
    outlined(ctx, 43, 19 + dy, 3, 3, c.body, c.outline);
  }

  // Beine (hinter dem Koerper)
  const legFill = { body: c.body, light: c.light, shade: c.shade, nose: c.nose }[f.legs];
  [21, 40].forEach((x, i) => {
    const lift = p.legs[i];
    const h = Math.max(2, 6 - lift - Math.min(dy, 2));
    const y = 55 + dy + lift;
    rect(ctx, x, y, 4, h, c.outline);
    rect(ctx, x + 1, y, 2, h - 1, legFill);
  });

  // Koerper
  outlined(ctx, 32, 41 + dy, brx, bry, c.body, c.outline);
  if (f.belly) ellipse(ctx, 32, 45 + dy, brx - 8, bry - 6, c.light);
  if (f.marks === "wrinkles") for (const [x, y] of WRINKLES_FRONT) rect(ctx, x, y + dy, 3, 1, c.shade);
  if (f.marks === "stripes") {
    for (const [x, y, w] of [[17, 37, 4], [16, 42, 5], [43, 37, 4], [43, 42, 5]]) rect(ctx, x, y + dy, w, 1, c.shade);
  }
  if (f.marks === "patch") ellipse(ctx, 24, 43 + dy, 5, 6, c.shade);
  if (f.marks === "spots") for (const [x, y] of SPOTS_FRONT) rect(ctx, x, y + dy, 2, 2, c.shade);

  // Haende
  if (f.hands === "rat") {
    for (const x of [17, 44]) {
      rect(ctx, x, 44 + dy, 3, 4, c.outline);
      rect(ctx, x, 44 + dy, 2, 3, c.body);
    }
  } else if (f.hands === "spades") {
    for (const x of [10, 47]) {
      rect(ctx, x - 1, 40 + dy, 9, 10, c.outline);
      rect(ctx, x, 41 + dy, 7, 7, c.nose);
      for (const cx of [x + 1, x + 3, x + 5]) rect(ctx, cx, 48 + dy, 1, 2, "#fff6e0");
    }
  }

  // Kopf
  outlined(ctx, 32, 28 + dy, hrx, hry, c.body, c.outline);
  if (f.ears === "tiny") {
    rect(ctx, 32 - hrx - 1, 27 + dy, 2, 3, c.shade);
    rect(ctx, 32 + hrx - 1, 27 + dy, 2, 3, c.shade);
  }
  if (f.marks === "stripes") {
    rect(ctx, 30, 19 + dy, 1, 3, c.shade);
    rect(ctx, 32, 18 + dy, 1, 4, c.shade);
    rect(ctx, 34, 19 + dy, 1, 3, c.shade);
  }
  if (f.marks === "patch") ellipse(ctx, 39, 24 + dy, 5, 5, c.shade);
  if (f.marks === "spots") {
    rect(ctx, 27, 20 + dy, 2, 2, c.shade);
    rect(ctx, 35, 21 + dy, 2, 2, c.shade);
  }

  frontFace(ctx, p, c, f.face, dy);
  drawEyes(ctx, p, 32, 24 + dy, f.eyeDx, { eye: c.eye, outline: c.outline, ring: c.ring }, TEAR);
}

function frontFace(ctx: Ctx, p: Pose, c: Palette, face: Face, dy: number) {
  const open = p.mouthOpen;
  switch (face) {
    case "rat":
      rect(ctx, 28, 30 + dy, 8, 4, c.shade);
      rect(ctx, 30, 29 + dy, 4, 2, c.outline);
      if (open) {
        rect(ctx, 28, 33 + dy, 8, 6, c.mouth);
        rect(ctx, 29, 33 + dy, 3, 3, c.light);
        rect(ctx, 32, 33 + dy, 3, 3, c.light);
      } else {
        rect(ctx, 29, 34 + dy, 3, 4, c.light);
        rect(ctx, 32, 34 + dy, 3, 4, c.light);
        rect(ctx, 28, 38 + dy, 8, 1, c.outline);
      }
      break;
    case "cat":
      rect(ctx, 31, 30 + dy, 2, 2, c.nose);
      if (open) {
        rect(ctx, 30, 32 + dy, 4, 4, c.mouth);
        rect(ctx, 31, 34 + dy, 2, 2, c.tongue);
      } else {
        rect(ctx, 31, 32 + dy, 2, 1, c.outline);
        rect(ctx, 29, 33 + dy, 2, 1, c.outline);
        rect(ctx, 33, 33 + dy, 2, 1, c.outline);
      }
      rect(ctx, 16, 31 + dy, 6, 1, c.outline);
      rect(ctx, 42, 31 + dy, 6, 1, c.outline);
      break;
    case "dog":
      ellipse(ctx, 32, 33 + dy, 6, 4, c.light);
      rect(ctx, 30, 30 + dy, 4, 3, c.eye);
      if (open) {
        rect(ctx, 29, 34 + dy, 6, 4, c.mouth);
        rect(ctx, 31, 36 + dy, 3, 2, c.tongue);
      } else {
        rect(ctx, 32, 33 + dy, 1, 2, c.outline);
        rect(ctx, 29, 35 + dy, 6, 1, c.outline);
      }
      break;
    case "lizard":
      rect(ctx, 30, 30 + dy, 1, 1, c.outline);
      rect(ctx, 33, 30 + dy, 1, 1, c.outline);
      if (open) {
        rect(ctx, 26, 34 + dy, 12, 3, c.mouth);
        rect(ctx, 31, 37 + dy, 2, 3, c.tongue);
        rect(ctx, 30, 39 + dy, 1, 1, c.tongue);
        rect(ctx, 33, 39 + dy, 1, 1, c.tongue);
      } else {
        rect(ctx, 26, 34 + dy, 12, 1, c.outline);
      }
      break;
    case "mole":
      // Sternnase
      rect(ctx, 28, 32 + dy, 1, 3, c.nose);
      rect(ctx, 35, 32 + dy, 1, 3, c.nose);
      rect(ctx, 29, 30 + dy, 6, 5, c.nose);
      rect(ctx, 30, 31 + dy, 1, 1, c.outline);
      rect(ctx, 33, 31 + dy, 1, 1, c.outline);
      if (open) rect(ctx, 30, 36 + dy, 4, 3, c.mouth);
      else rect(ctx, 30, 36 + dy, 4, 1, c.outline);
      break;
  }
}

interface QuadSide {
  /** Mitte und Halbachsen der Fuellung. */
  body: [number, number, number, number];
  head: [number, number, number, number];
  /** Beinpositionen: vorne rechts, vorne links, hinten rechts, hinten links. */
  legX: [number, number, number, number];
  legTop: number;
  legH: number;
  legs: "body" | "light" | "shade" | "nose";
  /** Pro Lauf-Frame (abwechselnd) die Schwanzteile, relativ zu dy. */
  tail: R[][];
  ear?: "pointy" | "floppy" | "tiny";
  /** Heller Schnauzenteil: Mitte und Halbachsen. */
  muzzle?: [number, number, number, number];
  nose?: R;
  mouth?: R;
  teeth?: R[];
  whiskers?: R[];
  eye: [number, number];
  marks?: "wrinkles" | "stripes" | "patch" | "spots";
}

const WRINKLES_SIDE: [number, number][] = [[20, 32], [26, 30], [33, 31], [24, 40], [31, 42], [38, 40]];

/** Beinhub (vorne rechts, vorne links, hinten rechts, hinten links) und Koerperhub pro Lauf-Frame. */
const WALK_FRAMES: { legs: [number, number, number, number]; bodyDy: number }[] = [
  { legs: [3, 0, 0, 3], bodyDy: 0 },
  { legs: [0, 0, 0, 0], bodyDy: 1 },
  { legs: [0, 3, 3, 0], bodyDy: 0 },
  { legs: [0, 0, 0, 0], bodyDy: 1 },
];

const walk = (frame: number) => WALK_FRAMES[frame % WALK_FRAMES.length];

function quadSide(ctx: Ctx, frame: number, c: Palette, s: QuadSide) {
  const { legs, bodyDy: dy } = walk(frame);
  const [bx, by, brx, bry] = s.body;
  const [hx, hy, hrx, hry] = s.head;

  // Schwanz
  const tail = s.tail[frame % s.tail.length];
  drawRects(ctx, tail, dy, c.body, c.outline);

  // Beine (hinter dem Koerper)
  const legFill = { body: c.body, light: c.light, shade: c.shade, nose: c.nose }[s.legs];
  s.legX.forEach((x, i) => {
    const lift = legs[i];
    const h = Math.max(2, s.legH - lift - Math.min(dy, 2));
    const y = s.legTop + dy + lift;
    rect(ctx, x, y, 4, h, c.outline);
    rect(ctx, x + 1, y, 2, h - 1, i < 2 && s.legs === "nose" ? c.nose : legFill);
  });

  // Koerper
  outlined(ctx, bx, by + dy, brx, bry, c.body, c.outline);
  if (s.marks === "wrinkles") for (const [x, y] of WRINKLES_SIDE) rect(ctx, x, y + dy, 3, 1, c.shade);
  if (s.marks === "stripes") for (let x = bx - brx + 3; x < bx + brx - 6; x += 5) rect(ctx, x, by - bry + dy, 2, 4, c.shade);
  if (s.marks === "patch") ellipse(ctx, bx - 5, by - 2 + dy, 5, 5, c.shade);
  if (s.marks === "spots") for (let x = bx - brx + 4; x < bx + brx - 6; x += 6) rect(ctx, x, by - bry + 2 + dy, 2, 2, c.shade);

  // Ohr hinter dem Kopf (spitz) bzw. vor dem Kopf (haengend)
  if (s.ear === "pointy") {
    tri(ctx, hx - 7, hy - hry - 9 + dy, 11, 11, "right", c.outline);
    tri(ctx, hx - 6, hy - hry - 8 + dy, 9, 9, "right", c.body);
    tri(ctx, hx - 4, hy - hry - 4 + dy, 4, 5, "right", c.nose);
  }

  // Kopf
  outlined(ctx, hx, hy + dy, hrx, hry, c.body, c.outline);
  if (s.muzzle) {
    const [mx, my, mrx, mry] = s.muzzle;
    outlined(ctx, mx, my + dy, mrx, mry, c.light, c.outline);
  }
  if (s.ear === "floppy") outlined(ctx, hx - 3, hy + 1 + dy, 3, 6, c.shade, c.outline);
  if (s.ear === "tiny") rect(ctx, hx - hrx + 1, hy - hry + 3 + dy, 2, 2, c.shade);

  if (s.nose) rect(ctx, s.nose[0], s.nose[1] + dy, s.nose[2], s.nose[3], c.nose);
  if (s.teeth) for (const [x, y, w, h] of s.teeth) rect(ctx, x, y + dy, w, h, c.light);
  if (s.mouth) rect(ctx, s.mouth[0], s.mouth[1] + dy, s.mouth[2], s.mouth[3], c.outline);
  if (s.whiskers) for (const [x, y, w, h] of s.whiskers) rect(ctx, x, y + dy, w, h, c.outline);

  const [ex, ey] = s.eye;
  if (c.ring) rect(ctx, ex - 1, ey - 1 + dy, 4, 4, c.ring);
  rect(ctx, ex, ey + dy, 2, 2, c.eye);
}

// ---------------------------------------------------------------------------------------------
// Paletten

const RAT: Palette = {
  outline: "#7a3b4a",
  body: "#e8a0a8",
  shade: "#c97a86",
  light: "#fff3c4",
  nose: "#7a3b4a",
  eye: "#2b1620",
  mouth: "#4a1f2c",
  tongue: "#e8808c",
};

const CAT: Palette = {
  outline: "#4a2e20",
  body: "#f0a24a",
  shade: "#c9741f",
  light: "#fff0d8",
  nose: "#f08a98",
  eye: "#2b1a10",
  mouth: "#5a1f2c",
  tongue: "#f06a80",
};

const DOG: Palette = {
  outline: "#3a2a20",
  body: "#d4a66a",
  shade: "#8a5a32",
  light: "#f6e6c8",
  nose: "#3a2a20",
  eye: "#2b1a10",
  mouth: "#5a1f2c",
  tongue: "#f06a80",
};

const LIZARD: Palette = {
  outline: "#1f4a2a",
  body: "#62b84a",
  shade: "#3f8a35",
  light: "#d6e88a",
  nose: "#3f8a35",
  eye: "#1a1a14",
  mouth: "#5a1f2c",
  tongue: "#d9435a",
  ring: "#f0d24a",
};

const MOLE: Palette = {
  outline: "#1f1d28",
  body: "#5a5670",
  shade: "#42404f",
  light: "#8a86a0",
  nose: "#f0a0b0",
  eye: "#f4f0ff",
  mouth: "#5a1f2c",
  tongue: "#f06a80",
};

const BIRD: Palette = {
  outline: "#24365a",
  body: "#6aa8e8",
  shade: "#3f78c0",
  light: "#f4f8ff",
  nose: "#f2a23a",
  eye: "#1a1a2a",
  mouth: "#5a1f2c",
  tongue: "#f06a80",
};

const SNAKE: Palette = {
  outline: "#4a3014",
  body: "#dcb450",
  shade: "#9a6420",
  light: "#f6e6a8",
  nose: "#9a6420",
  eye: "#1a1208",
  mouth: "#5a1f2c",
  tongue: "#d9435a",
  ring: "#fff6c8",
};

// ---------------------------------------------------------------------------------------------
// Vogel

function birdFront(ctx: Ctx, p: Pose) {
  const c = BIRD;
  const dy = p.bodyDy;

  // Beine (duenn, orange)
  [27, 35].forEach((x, i) => {
    const lift = p.legs[i];
    const h = Math.max(2, 6 - lift - Math.min(dy, 2));
    const y = 55 + dy + lift;
    rect(ctx, x, y, 2, h, c.nose);
    rect(ctx, x - 1, y + h - 1, 4, 1, c.nose);
  });

  // Schopf
  for (const [x, y, w, h] of [[31, 11, 2, 5], [27, 13, 2, 4], [35, 13, 2, 4]] as R[]) {
    rect(ctx, x - 1, y - 1 + dy, w + 2, h + 2, c.outline);
    rect(ctx, x, y + dy, w, h, c.shade);
  }

  // Fluegel hinter dem Koerper, Koerper, Bauch
  outlined(ctx, 17, 42 + dy, 3, 8, c.shade, c.outline);
  outlined(ctx, 47, 42 + dy, 3, 8, c.shade, c.outline);
  outlined(ctx, 32, 41 + dy, 14, 13, c.body, c.outline);
  ellipse(ctx, 32, 46 + dy, 9, 8, c.light);

  // Kopf
  outlined(ctx, 32, 27 + dy, 12, 10, c.body, c.outline);
  rect(ctx, 22, 29 + dy, 3, 2, "#f4a0a8");
  rect(ctx, 39, 29 + dy, 3, 2, "#f4a0a8");

  // Schnabel
  rect(ctx, 28, 28 + dy, 8, 6, c.outline);
  if (p.mouthOpen) {
    rect(ctx, 29, 29 + dy, 6, 2, c.nose);
    rect(ctx, 30, 31 + dy, 4, 2, c.mouth);
    rect(ctx, 30, 33 + dy, 4, 1, c.nose);
  } else {
    rect(ctx, 29, 29 + dy, 6, 3, c.nose);
    rect(ctx, 30, 32 + dy, 4, 1, c.nose);
  }

  drawEyes(ctx, p, 32, 23 + dy, 6, { eye: c.eye, outline: c.outline }, TEAR);
}

function birdSide(ctx: Ctx, frame: number) {
  const c = BIRD;
  const { legs, bodyDy: dy } = walk(frame);

  // Schwanzfedern
  drawRects(ctx, [[4, 34, 10, 4], [2, 38, 11, 3]], dy, c.shade, c.outline);

  // Beine
  [30, 25].forEach((x, i) => {
    const lift = legs[i];
    const h = Math.max(2, 8 - lift - Math.min(dy, 2));
    const y = 48 + dy + lift;
    rect(ctx, x, y, 2, h, c.nose);
    rect(ctx, x, y + h - 1, 5, 1, c.nose);
  });

  // Koerper, Bauch, Fluegel (schlaegt leicht)
  outlined(ctx, 28, 38 + dy, 15, 10, c.body, c.outline);
  ellipse(ctx, 34, 43 + dy, 7, 4, c.light);
  const flap = frame % 2 === 1 ? -1 : 0;
  outlined(ctx, 25, 37 + dy + flap, 8, 5, c.shade, c.outline);
  ellipse(ctx, 24, 36 + dy + flap, 5, 2, c.body);

  // Schopf und Kopf
  rect(ctx, 41, 17 + dy, 3, 5, c.outline);
  rect(ctx, 42, 18 + dy, 1, 4, c.shade);
  outlined(ctx, 44, 28 + dy, 8, 8, c.body, c.outline);

  // Schnabel
  rect(ctx, 50, 26 + dy, 9, 5, c.outline);
  rect(ctx, 51, 27 + dy, 7, 3, c.nose);
  rect(ctx, 52, 30 + dy, 5, 1, c.nose);

  rect(ctx, 46, 25 + dy, 2, 2, c.eye);
}

// ---------------------------------------------------------------------------------------------
// Schlange

function snakeFront(ctx: Ctx, p: Pose) {
  const c = SNAKE;
  const dy = p.bodyDy;

  // Windungen (bleiben liegen), Kopf und Hals bewegen sich
  outlined(ctx, 32, 52, 21, 6, c.body, c.outline);
  outlined(ctx, 32, 44, 15, 5, c.body, c.outline);
  for (const x of [15, 22, 29, 36, 43]) rect(ctx, x, 51, 4, 2, c.shade);
  for (const x of [24, 32, 38]) rect(ctx, x, 43, 3, 2, c.shade);

  outlined(ctx, 32, 37 + dy, 6, 6, c.body, c.outline);
  rect(ctx, 31, 36 + dy, 2, 2, c.shade);
  outlined(ctx, 32, 27 + dy, 11, 9, c.body, c.outline);
  // Rautenzeichnung auf dem Kopf
  rect(ctx, 31, 19 + dy, 2, 3, c.shade);
  rect(ctx, 30, 20 + dy, 4, 1, c.shade);

  drawEyes(ctx, p, 32, 24 + dy, 6, { eye: c.eye, outline: c.outline, ring: c.ring }, TEAR);

  rect(ctx, 30, 29 + dy, 1, 1, c.outline);
  rect(ctx, 33, 29 + dy, 1, 1, c.outline);
  if (p.mouthOpen) {
    rect(ctx, 26, 32 + dy, 12, 2, c.mouth);
    rect(ctx, 31, 34 + dy, 2, 4, c.tongue);
    rect(ctx, 30, 37 + dy, 1, 2, c.tongue);
    rect(ctx, 33, 37 + dy, 1, 2, c.tongue);
  } else {
    rect(ctx, 26, 32 + dy, 12, 1, c.outline);
  }
}

function snakeSide(ctx: Ctx, frame: number) {
  const c = SNAKE;
  const N = 24;
  const wave = (i: number) => 44 + 3.2 * Math.sin((i / (N - 1)) * Math.PI * 3 + (frame * Math.PI) / 2);
  const radius = (i: number) => 2 + 3.5 * Math.min(1, i / 9);
  // erst alle Umrisse, dann die Fuellung, damit die Segmente nahtlos wirken
  for (let i = 0; i < N; i++) ellipse(ctx, 5 + i * 2, Math.round(wave(i)), radius(i) + 1, radius(i) + 1, c.outline);
  for (let i = 0; i < N; i++) {
    ellipse(ctx, 5 + i * 2, Math.round(wave(i)), radius(i), radius(i), i % 5 < 2 ? c.shade : c.body);
  }
  const hy = Math.round(wave(N - 1));
  outlined(ctx, 54, hy, 6, 4, c.body, c.outline);
  rect(ctx, 54, hy - 3, 3, 3, c.ring ?? "#fff");
  rect(ctx, 55, hy - 2, 1, 2, c.eye);
  rect(ctx, 57, hy + 1, 4, 1, c.outline);
  if (frame % 2 === 1) {
    rect(ctx, 61, hy + 1, 2, 1, c.tongue);
    rect(ctx, 62, hy, 1, 1, c.tongue);
    rect(ctx, 62, hy + 2, 1, 1, c.tongue);
  }
}

// ---------------------------------------------------------------------------------------------
// Tabelle

export const SPECIES: Record<Species, SpeciesInfo> = {
  "naked-mole-rat": {
    id: "naked-mole-rat",
    label: "Nacktmull",
    front: (ctx, p) =>
      quadFront(ctx, p, RAT, {
        body: [17, 15],
        head: [11, 9],
        ears: "tiny",
        face: "rat",
        marks: "wrinkles",
        belly: false,
        hands: "rat",
        legs: "body",
        eyeDx: 6,
      }),
    side: (ctx, frame) =>
      quadSide(ctx, frame, RAT, {
        body: [30, 38, 20, 11],
        head: [47, 37, 8, 7],
        legX: [43, 37, 17, 11],
        legTop: 48,
        legH: 6,
        legs: "body",
        tail: [[[5, 38, 5, 2]]],
        ear: "tiny",
        teeth: [[54, 41, 2, 4], [56, 41, 2, 4]],
        mouth: [54, 45, 4, 1],
        eye: [51, 33],
        marks: "wrinkles",
      }),
    hold: { x: 32, y: 44 },
    back: { x: 28, y: 26 },
  },

  cat: {
    id: "cat",
    label: "Katze",
    front: (ctx, p) =>
      quadFront(ctx, p, CAT, {
        body: [14, 13],
        head: [12, 10],
        ears: "pointy",
        face: "cat",
        marks: "stripes",
        belly: true,
        hands: "none",
        tail: [[47, 50, 6, 3], [51, 43, 4, 8], [50, 40, 3, 4]],
        legs: "light",
        eyeDx: 6,
      }),
    side: (ctx, frame) =>
      quadSide(ctx, frame, CAT, {
        body: [28, 38, 17, 10],
        head: [45, 33, 8, 7],
        legX: [38, 33, 16, 11],
        legTop: 47,
        legH: 7,
        legs: "light",
        tail: [[[8, 36, 5, 3], [5, 31, 4, 6], [4, 25, 3, 7], [5, 22, 3, 4]]],
        ear: "pointy",
        muzzle: [51, 36, 3, 2],
        nose: [53, 34, 2, 2],
        whiskers: [[55, 36, 5, 1]],
        eye: [48, 30],
        marks: "stripes",
      }),
    hold: { x: 32, y: 44 },
    back: { x: 26, y: 27 },
  },

  dog: {
    id: "dog",
    label: "Hund",
    front: (ctx, p) =>
      quadFront(ctx, p, DOG, {
        body: [15, 14],
        head: [12, 10],
        ears: "floppy",
        face: "dog",
        marks: "patch",
        belly: true,
        hands: "none",
        tail: [[47, 46, 4, 3], [50, 40, 3, 7]],
        legs: "light",
        eyeDx: 6,
      }),
    side: (ctx, frame) =>
      quadSide(ctx, frame, DOG, {
        body: [27, 38, 18, 10],
        head: [45, 32, 8, 7],
        legX: [38, 33, 16, 11],
        legTop: 47,
        legH: 7,
        legs: "light",
        tail: [
          [[7, 34, 5, 3], [4, 28, 4, 7]],
          [[7, 34, 5, 3], [5, 29, 4, 6], [3, 26, 3, 4]],
        ],
        ear: "floppy",
        muzzle: [52, 35, 4, 2],
        nose: [56, 33, 3, 3],
        mouth: [53, 38, 4, 1],
        eye: [48, 29],
        marks: "patch",
      }),
    hold: { x: 32, y: 44 },
    back: { x: 26, y: 27 },
  },

  lizard: {
    id: "lizard",
    label: "Echse",
    front: (ctx, p) =>
      quadFront(ctx, p, LIZARD, {
        body: [13, 12],
        head: [12, 8],
        ears: "none",
        face: "lizard",
        marks: "spots",
        belly: true,
        hands: "none",
        tail: [[43, 51, 10, 3], [51, 48, 4, 4]],
        legs: "body",
        eyeDx: 7,
      }),
    side: (ctx, frame) =>
      quadSide(ctx, frame, LIZARD, {
        body: [27, 40, 16, 6],
        head: [45, 38, 8, 5],
        legX: [40, 35, 17, 12],
        legTop: 45,
        legH: 5,
        legs: "body",
        tail: [[[6, 40, 6, 5], [2, 42, 5, 4], [0, 45, 3, 2]]],
        mouth: [50, 41, 7, 1],
        eye: [48, 35],
        marks: "spots",
      }),
    hold: { x: 32, y: 45 },
    back: { x: 28, y: 33 },
  },

  snake: {
    id: "snake",
    label: "Schlange",
    front: snakeFront,
    side: snakeSide,
    hold: { x: 32, y: 42 },
    back: { x: 26, y: 38 },
  },

  bird: {
    id: "bird",
    label: "Vogel",
    front: birdFront,
    side: birdSide,
    hold: { x: 32, y: 44 },
    back: { x: 26, y: 28 },
  },

  mole: {
    id: "mole",
    label: "Maulwurf",
    front: (ctx, p) =>
      quadFront(ctx, p, MOLE, {
        body: [16, 14],
        head: [10, 9],
        ears: "none",
        face: "mole",
        marks: "none",
        belly: false,
        hands: "spades",
        legs: "shade",
        eyeDx: 5,
      }),
    side: (ctx, frame) =>
      quadSide(ctx, frame, MOLE, {
        body: [29, 38, 17, 9],
        head: [45, 36, 7, 6],
        legX: [43, 37, 16, 11],
        legTop: 47,
        legH: 7,
        legs: "nose",
        tail: [[[9, 40, 4, 2]]],
        muzzle: [53, 38, 3, 2],
        eye: [49, 33],
      }),
    hold: { x: 32, y: 44 },
    back: { x: 27, y: 28 },
  },
};

export const SPECIES_LIST: SpeciesInfo[] = Object.values(SPECIES);

/** Lauf-Frame fuer Koerperhub (gemeinsam fuer die Seitenansicht aller Arten). */
export const walkBodyDy = (frame: number) => walk(frame).bodyDy;
