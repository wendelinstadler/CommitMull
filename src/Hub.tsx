import { useEffect } from "react";
import { startHub } from "./hubLogic";

/** Unsichtbares Fenster, in dem die Logik aller Agenten laeuft. */
export function Hub() {
  useEffect(() => startHub(), []);
  return null;
}
