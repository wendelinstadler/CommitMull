import { boxed, Ctx, line, rect } from "./draw";

/**
 * Accessoires der Rollen. Sie liegen als Ueberlagerung ueber der Tierart und hangen nur an
 * Ankerpunkten (siehe species.ts), nicht an der Art selbst.
 */
export type Accessory = "none" | "laptop" | "whiteboard" | "book" | "dumbbell" | "checklist";

export const ACCESSORIES: { id: Accessory; label: string }[] = [
  { id: "none", label: "Keines" },
  { id: "laptop", label: "Laptop" },
  { id: "whiteboard", label: "Whiteboard" },
  { id: "book", label: "Buch" },
  { id: "dumbbell", label: "Hantel" },
  { id: "checklist", label: "Checkliste" },
];

const K = {
  frame: "#4a4f5c",
  lid: "#aab0bf",
  lidLight: "#d3d8e4",
  board: "#fbfbff",
  axis: "#b6bac6",
  up: "#2ea043",
  down: "#d9534f",
  cover: "#3a6ea5",
  coverLight: "#5a8ec5",
  page: "#fffdf5",
  mark: "#d9534f",
  weight: "#2f3340",
  weightLight: "#5a5f6b",
  bar: "#9aa0ae",
  clip: "#b07a3a",
  clipDark: "#7a5220",
  ok: "#2ea043",
  ink: "#8a8f9c",
  budget: "#6b7a99",
};

/** Stand des Wochenbudgets auf dem Whiteboard: unter dem Budget (gruen) oder darueber (rot). */
export type Board = "ok" | "over";

/** Zeichnet das Whiteboard hinter dem Tier (Vorderansicht, links neben dem Tier). */
export function drawBackAccessory(ctx: Ctx, acc: Accessory, board: Board = "ok") {
  if (acc !== "whiteboard") return;
  rect(ctx, 11, 26, 2, 30, K.frame);
  rect(ctx, 6, 56, 12, 2, K.frame);
  boxed(ctx, 1, 8, 22, 17, K.board, K.frame);
  // Achsen und Verlauf (Ausgaben ueber die Woche)
  rect(ctx, 4, 11, 1, 11, K.axis);
  rect(ctx, 4, 21, 17, 1, K.axis);
  // Budgetlinie (gestrichelt); der Verlauf endet darunter (ok) oder darueber (ueber Budget)
  for (let x = 5; x < 21; x += 3) rect(ctx, x, 14, 2, 1, K.budget);
  const c = board === "over" ? K.down : K.up;
  const end = board === "over" ? 10 : 17;
  line(ctx, 5, 19, 9, 17, c);
  line(ctx, 9, 17, 12, 18, c);
  line(ctx, 12, 18, 16, board === "over" ? 14 : 18, c);
  line(ctx, 16, board === "over" ? 14 : 18, 20, end, c);
  rect(ctx, 19, end - 1, 3, 3, c);
}

/** Zeichnet Accessoires, die das Tier vor dem Bauch haelt (Vorderansicht). (x, y) = Mitte oben. */
export function drawFrontAccessory(ctx: Ctx, acc: Accessory, x: number, y: number) {
  switch (acc) {
    case "laptop": {
      // Der Betrachter sieht die Rueckseite des Deckels.
      boxed(ctx, x - 8, y, 16, 10, K.lid, K.frame);
      rect(ctx, x - 7, y + 1, 14, 1, K.lidLight);
      rect(ctx, x - 1, y + 4, 3, 3, K.lidLight);
      rect(ctx, x - 11, y + 11, 22, 2, K.frame);
      rect(ctx, x - 10, y + 11, 20, 1, K.bar);
      break;
    }
    case "book": {
      boxed(ctx, x - 7, y, 14, 13, K.cover, K.frame);
      rect(ctx, x - 6, y + 1, 12, 1, K.coverLight);
      rect(ctx, x - 6, y + 1, 1, 11, K.coverLight);
      rect(ctx, x + 7, y + 1, 1, 11, K.page);
      rect(ctx, x - 3, y + 4, 8, 1, K.page);
      rect(ctx, x - 3, y + 6, 6, 1, K.page);
      rect(ctx, x + 3, y + 13, 2, 3, K.mark);
      break;
    }
    case "dumbbell": {
      rect(ctx, x - 9, y + 4, 18, 3, K.frame);
      rect(ctx, x - 8, y + 5, 16, 1, K.bar);
      for (const wx of [x - 13, x + 8]) {
        boxed(ctx, wx, y, 5, 11, K.weight, K.frame);
        rect(ctx, wx + 1, y + 1, 1, 9, K.weightLight);
      }
      break;
    }
    case "checklist": {
      boxed(ctx, x - 6, y, 12, 16, K.clip, K.clipDark);
      rect(ctx, x - 5, y + 3, 10, 12, K.page);
      rect(ctx, x - 3, y - 2, 6, 3, K.clipDark);
      for (let i = 0; i < 3; i++) {
        const ly = y + 5 + i * 3;
        rect(ctx, x - 4, ly + 1, 1, 1, K.ok);
        rect(ctx, x - 3, ly + 2, 1, 1, K.ok);
        rect(ctx, x - 2, ly + 1, 1, 1, K.ok);
        rect(ctx, x, ly + 1, 4, 1, K.ink);
      }
      break;
    }
    default:
      break;
  }
}

/** Zeichnet das Accessoire auf dem Ruecken (Seitenansicht beim Laufen). (x, y) = Rueckenpunkt. */
export function drawCarriedAccessory(ctx: Ctx, acc: Accessory, x: number, y: number) {
  switch (acc) {
    case "laptop":
      boxed(ctx, x - 7, y - 3, 14, 3, K.lid, K.frame);
      rect(ctx, x - 6, y - 3, 12, 1, K.lidLight);
      break;
    case "whiteboard":
      rect(ctx, x - 1, y - 6, 2, 6, K.frame);
      boxed(ctx, x - 7, y - 15, 14, 9, K.board, K.frame);
      line(ctx, x - 5, y - 8, x - 2, y - 11, K.up);
      line(ctx, x - 2, y - 11, x, y - 9, K.up);
      line(ctx, x, y - 9, x + 4, y - 13, K.up);
      break;
    case "book":
      boxed(ctx, x - 5, y - 4, 10, 4, K.cover, K.frame);
      rect(ctx, x - 4, y - 3, 8, 1, K.page);
      break;
    case "dumbbell":
      rect(ctx, x - 6, y - 3, 12, 1, K.bar);
      for (const wx of [x - 8, x + 5]) boxed(ctx, wx, y - 5, 3, 5, K.weight, K.frame);
      break;
    case "checklist":
      boxed(ctx, x - 4, y - 10, 8, 10, K.clip, K.clipDark);
      rect(ctx, x - 3, y - 8, 6, 7, K.page);
      rect(ctx, x - 2, y - 7, 4, 1, K.ok);
      rect(ctx, x - 2, y - 5, 4, 1, K.ink);
      rect(ctx, x - 2, y - 3, 4, 1, K.ink);
      break;
    default:
      break;
  }
}
