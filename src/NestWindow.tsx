import { useEffect, useRef } from "react";
import "./nest.css";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Ctx, ellipse, rect } from "./draw";
import { NEST_H, NEST_W } from "./behavior";
import { EVENT_AGENT_CMD, HUB_LABEL } from "./protocol";

/** Nest-Grafik: 50x24 Pixel, wird dreifach vergroessert (= Fenstergroesse 150x72). */
const ART_W = 50;
const ART_H = 24;
const SCALE = 3;

const K = {
  outline: "#6b4423",
  straw: "#d9a65a",
  strawLight: "#f0cf8a",
  strawDark: "#b07a3a",
  hole: "#8f5f2c",
};

function drawNest(ctx: Ctx) {
  ctx.clearRect(0, 0, ART_W, ART_H);
  // Schale
  ellipse(ctx, 25, 15, 24, 8, K.outline);
  ellipse(ctx, 25, 15, 22, 6, K.straw);
  // Halme am Rand
  for (const [x, y, w] of [[4, 14, 5], [10, 19, 4], [18, 21, 6], [30, 21, 5], [38, 19, 5], [42, 14, 4], [14, 12, 3], [34, 11, 4]]) {
    rect(ctx, x, y, w, 1, K.strawDark);
  }
  for (const [x, y, w] of [[8, 16, 4], [22, 19, 5], [34, 17, 4], [27, 12, 3]]) rect(ctx, x, y, w, 1, K.strawLight);
  // Mulde oben
  ellipse(ctx, 25, 12, 19, 3, K.strawDark);
  ellipse(ctx, 25, 12, 17, 2, K.hole);
}

interface Props {
  id: string;
  /** true = zum Verschieben: ziehbar, mit "Fertig". */
  edit: boolean;
}

/** Nestfenster: zeigt das Nest, solange das Tier schlaeft, oder zum Verschieben (edit). */
export function NestWindow({ id, edit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    drawNest(ctx);
  }, []);

  const done = async () => {
    const pos = await getCurrentWindow().outerPosition();
    await emitTo(HUB_LABEL, EVENT_AGENT_CMD, { id, type: "nest-set", nest: { x: pos.x, y: pos.y } });
  };

  return (
    <div className="nest" style={{ width: NEST_W, height: NEST_H }} data-tauri-drag-region={edit ? "" : undefined}>
      {edit && (
        <div className="nest-bar" data-tauri-drag-region>
          <span data-tauri-drag-region>Nest ziehen</span>
          <button onClick={done}>Fertig</button>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={ART_W}
        height={ART_H}
        style={{ width: ART_W * SCALE, height: ART_H * SCALE }}
        className={edit ? "nest-art edit" : "nest-art"}
        data-tauri-drag-region={edit ? "" : undefined}
      />
    </div>
  );
}
