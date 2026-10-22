import { Pet } from "./Pet";

/** Inhalt des Geisterfensters: das Tier halbtransparent, zeigt das Ziel beim Ziehen. */
export function Ghost() {
  return (
    <div className="stage ghost">
      <Pet state="idle" facing="right" alpha={0.5} />
    </div>
  );
}
