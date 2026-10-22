import "./sheet.css";
import { ACCESSORIES } from "./accessories";
import { Pet } from "./Pet";
import { SPECIES_LIST } from "./species";
import { PetState } from "./sprites";

const STATES: PetState[] = ["idle", "walk", "sleep", "eat", "sad"];

/** Nur im Dev-Modus (?sheet): alle Arten und Accessoires nebeneinander zum Justieren der Sprites. */
export function Sheet() {
  const params = new URLSearchParams(window.location.search);
  const accIds = (params.get("acc") ?? "cat,snake").split(",");
  return (
    <div className="sheet">
      <h2>Arten und Animationen</h2>
      <div className="sheet-grid">
        {SPECIES_LIST.map((s) => (
          <div className="sheet-row" key={s.id}>
            <b>{s.label}</b>
            {STATES.map((st) => (
              <Pet key={st} species={s.id} accessory="none" state={st} facing="right" size={96} />
            ))}
          </div>
        ))}
      </div>
      {SPECIES_LIST.filter((s) => accIds.includes(s.id)).map((s) => (
        <div key={s.id}>
          <h2>Accessoires: {s.label}</h2>
          <div className="sheet-grid">
            {ACCESSORIES.map((a) => (
              <div className="sheet-row" key={a.id}>
                <b>{a.label}</b>
                {(["idle", "walk", "sleep", "eat"] as PetState[]).map((st) => (
                  <Pet key={st} species={s.id} accessory={a.id} state={st} facing="right" size={96} />
                ))}
              </div>
            ))}
            <div className="sheet-row">
              <b>Whiteboard, ueber Budget</b>
              {(["idle", "walk", "sleep", "eat"] as PetState[]).map((st) => (
                <Pet key={st} species={s.id} accessory="whiteboard" board="over" state={st} facing="right" size={96} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
