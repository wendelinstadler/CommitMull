import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import "./home.css";
import { Agent, AGENTS_CHANGED, ensureAgents, modeAccessory, modeLabel, readAgents, saveAgents } from "./agents";
import { Pet } from "./Pet";
import { SPECIES } from "./species";

/** Oeffnet die Verwaltung, optional mit vorgewaehltem Agenten oder "new" fuer einen neuen. */
async function openSettings(select?: string) {
  if (select) await emitTo("settings", "settings-select", select).catch(() => {});
  await invoke("open_settings");
}

/** Startseite der App: alle Tiere als Karten, pro Tier ein Schalter zum Aktivieren. */
export function Home() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    ensureAgents().then(setAgents);
    const unlisten = listen(AGENTS_CHANGED, () => readAgents().then(setAgents));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const toggle = async (id: string) => {
    // Immer vom gespeicherten Stand ausgehen, falls das Tray-Menue zwischenzeitlich etwas geaendert hat.
    const current = await readAgents();
    await saveAgents(current.map((a) => (a.id === id ? { ...a, visible: !a.visible } : a)));
  };

  if (!agents) return null;
  const active = agents.filter((a) => a.visible).length;

  return (
    <div className="home">
      <header className="home-header">
        <div>
          <h1>CommitMull</h1>
          <p>
            {agents.length === 0
              ? "Noch keine Tiere. Lege dein erstes an."
              : `${active} von ${agents.length} ${agents.length === 1 ? "Tier" : "Tieren"} aktiv`}
          </p>
        </div>
        <button className="home-button" onClick={() => openSettings()}>
          Einstellungen
        </button>
      </header>

      <div className="home-grid">
        {agents.map((a) => (
          <article key={a.id} className={`home-card ${a.visible ? "" : "off"}`}>
            <Pet species={a.species} accessory={modeAccessory(a.modes[0])} state={a.visible ? "idle" : "sleep"} facing="right" size={96} />
            <div className="home-card-text">
              <strong>{a.name}</strong>
              <small>
                {SPECIES[a.species].label}, {a.modes.map(modeLabel).join(" / ")}
              </small>
            </div>
            <div className="home-card-actions">
              <button
                role="switch"
                aria-checked={a.visible}
                aria-label={`${a.name} ${a.visible ? "deaktivieren" : "aktivieren"}`}
                className={`home-switch ${a.visible ? "on" : ""}`}
                onClick={() => toggle(a.id)}
              >
                <span />
              </button>
              <button className="home-link" onClick={() => openSettings(a.id)}>
                Bearbeiten
              </button>
            </div>
          </article>
        ))}

        <button className="home-card home-new" onClick={() => openSettings("new")}>
          <span className="home-plus">+</span>
          <span>Neues Tier</span>
        </button>
      </div>
    </div>
  );
}
