import { useEffect, useRef } from "react";
import { Accessory, Board } from "./accessories";
import { drawPet, FRAME_MS, PetState, SIZE } from "./sprites";
import { Species } from "./species";

interface Props {
  species: Species;
  accessory: Accessory;
  /** Stand des Wochenbudgets fuer das Whiteboard. */
  board?: Board;
  state: PetState;
  facing: "left" | "right";
  /** Deckkraft 0..1; wird beim Zeichnen angewendet, damit die Pixel scharf bleiben. */
  alpha?: number;
  /** Ziel-Anzeigegroesse in CSS-Pixeln; die echte Groesse ist ein ganzzahliges Vielfaches der Sprite-Pixel. */
  size?: number;
}

const DEFAULT_CSS_SIZE = 128;

function cssSize(target: number) {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.round((target * dpr) / SIZE));
  return (SIZE * scale) / dpr;
}

export function Pet({ species, accessory, board, state, facing, alpha = 1, size = DEFAULT_CSS_SIZE }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const look = { species, accessory, board };

    // Bei Transparenz erst deckend zeichnen, dann mit Alpha uebertragen, sonst scheinen sich
    // Umriss und Fuellung gegenseitig durch.
    const layer = alpha < 1 ? document.createElement("canvas") : null;
    if (layer) {
      layer.width = SIZE;
      layer.height = SIZE;
    }
    const draw = (frame: number) => {
      if (!layer) return drawPet(ctx, look, state, frame);
      const lctx = layer.getContext("2d");
      if (!lctx) return;
      drawPet(lctx, look, state, frame);
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
  }, [species, accessory, board, state, alpha]);

  const px = cssSize(size);
  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{ width: px, height: px }}
      className={`pet ${facing === "left" ? "flip" : ""}`}
    />
  );
}
