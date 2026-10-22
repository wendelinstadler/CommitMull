import { useEffect, useRef } from "react";
import { drawPet, FRAME_MS, PetState, SIZE } from "./sprites";

interface Props {
  state: PetState;
  facing: "left" | "right";
  /** Deckkraft 0..1; wird beim Zeichnen angewendet, damit die Pixel scharf bleiben. */
  alpha?: number;
}

/** Ziel-Anzeigegroesse in CSS-Pixeln, gerundet auf ein ganzzahliges Vielfaches der Sprite-Pixel. */
const TARGET_CSS_SIZE = 128;

function cssSize() {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.round((TARGET_CSS_SIZE * dpr) / SIZE));
  return (SIZE * scale) / dpr;
}

export function Pet({ state, facing, alpha = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    // Bei Transparenz erst deckend zeichnen, dann mit Alpha uebertragen, sonst scheinen sich
    // Umriss und Fuellung gegenseitig durch.
    const layer = alpha < 1 ? document.createElement("canvas") : null;
    if (layer) {
      layer.width = SIZE;
      layer.height = SIZE;
    }
    const draw = (frame: number) => {
      if (!layer) return drawPet(ctx, state, frame);
      const lctx = layer.getContext("2d");
      if (!lctx) return;
      drawPet(lctx, state, frame);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    };

    let frame = 0;
    draw(frame);
    const id = window.setInterval(() => {
      frame++;
      draw(frame);
    }, FRAME_MS[state]);
    return () => window.clearInterval(id);
  }, [state, alpha]);

  const size = cssSize();
  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{ width: size, height: size }}
      className={`pet ${facing === "left" ? "flip" : ""}`}
    />
  );
}
