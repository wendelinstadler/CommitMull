import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Accessory } from "./accessories";
import { Pet } from "./Pet";
import { EVENT_GHOST_LOOK } from "./protocol";
import { Species } from "./species";

/** Inhalt des Geisterfensters: das Tier halbtransparent, zeigt das Ziel beim Ziehen. */
export function Ghost() {
  const [look, setLook] = useState<{ species: Species; accessory: Accessory }>({
    species: "naked-mole-rat",
    accessory: "none",
  });

  // Das gezogene Tier meldet vor der Vorschau sein Aussehen.
  useEffect(() => {
    const unlisten = listen<{ species: Species; accessory: Accessory }>(EVENT_GHOST_LOOK, (e) => setLook(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="stage ghost">
      <Pet species={look.species} accessory={look.accessory} state="idle" facing="right" alpha={0.5} />
    </div>
  );
}
