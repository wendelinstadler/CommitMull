import { Accessory, drawBackAccessory, drawCarriedAccessory, drawFrontAccessory } from "./accessories";
import { Ctx, PetState, Pose, rect, SIZE } from "./draw";
import { SPECIES, Species, walkBodyDy } from "./species";

export type { PetState } from "./draw";
export { SIZE } from "./draw";

/** Aussehen eines Tiers: Art plus Accessoire der Rolle. */
export interface Look {
  species: Species;
  accessory: Accessory;
}

const C = {
  food: "#3fb950",
  foodLight: "#7ee787",
  zzz: "#8ab4ff",
};

const base: Pose = {
  bodyDy: 0,
  legs: [0, 0],
  eyes: "open",
  mouthOpen: false,
  tear: false,
  zzz: 0,
  food: null,
};

const pose = (p: Partial<Pose>): Pose => ({ ...base, ...p });

/** Posen der Animationen in Vorderansicht; "walk" ist die Seitenansicht und steht in species.ts. */
export const FRAMES: Record<Exclude<PetState, "walk">, Pose[]> = {
  idle: [pose({}), pose({ bodyDy: 1 })],
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
  sad: [pose({ bodyDy: 2, eyes: "sad", tear: true }), pose({ bodyDy: 3, eyes: "sad" })],
};

export const FRAME_MS: Record<PetState, number> = {
  idle: 600,
  walk: 160,
  sleep: 700,
  eat: 250,
  sad: 700,
};

function drawZ(ctx: Ctx, x: number, y: number, s: number) {
  rect(ctx, x, y, s, 1, C.zzz);
  for (let i = 0; i < s; i++) rect(ctx, x + s - 1 - i, y + i, 1, 1, C.zzz);
  rect(ctx, x, y + s - 1, s, 1, C.zzz);
}

/** Zeichnet das Tier auf eine 64x64-Flaeche: Vorderansicht, beim Laufen Seitenansicht (blickt nach rechts). */
export function drawPet(ctx: Ctx, look: Look, state: PetState, frame: number) {
  const species = SPECIES[look.species];
  ctx.clearRect(0, 0, SIZE, SIZE);

  if (state === "walk") {
    const dy = walkBodyDy(frame);
    species.side(ctx, frame);
    drawCarriedAccessory(ctx, look.accessory, species.back.x, species.back.y + dy);
    return;
  }

  const frames = FRAMES[state];
  const p = frames[frame % frames.length];

  drawBackAccessory(ctx, look.accessory);
  species.front(ctx, p);
  drawFrontAccessory(ctx, look.accessory, species.hold.x, species.hold.y + p.bodyDy);

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
