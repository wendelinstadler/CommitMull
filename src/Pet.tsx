import { useEffect, useRef } from "react";
import { drawPet, FRAME_MS, PetState, SIZE } from "./sprites";

interface Props {
  state: PetState;
  facing: "left" | "right";
}

export function Pet({ state, facing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    drawPet(ctx, state, frame);
    const id = window.setInterval(() => {
      frame++;
      drawPet(ctx, state, frame);
    }, FRAME_MS[state]);
    return () => window.clearInterval(id);
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className={`pet ${facing === "left" ? "flip" : ""}`}
    />
  );
}
