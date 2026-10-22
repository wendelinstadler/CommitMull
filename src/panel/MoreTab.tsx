import { AgentCommand, AgentStatePayload } from "../protocol";

interface Props {
  info: AgentStatePayload;
  send: (cmd: AgentCommand) => void;
  paused: boolean;
  autostart: boolean;
  onSleep: () => void;
  onNest: () => void;
  onPause: () => void;
  onAutostart: () => void;
  onHome: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

/** Reiter "Mehr": Schlaf und Nest des Tiers, App-Einstellungen, Beenden. */
export function MoreTab({ info, send, paused, autostart, onSleep, onNest, onPause, onAutostart, onHome, onSettings, onQuit }: Props) {
  const asleep = info.sleep === "asleep" || info.sleep === "to-nest";
  return (
    <>
      <div className="pw-group">
        <h3>{info.name}</h3>
        <div className="pw-rows">
          {info.sleep === "awake" ? (
            <button className="pw-row" onClick={onSleep}>
              <span>
                Schlafen schicken
                <small>Das Tier legt sich ins Nest, der Hunger steht still.</small>
              </span>
            </button>
          ) : (
            <button className="pw-row" onClick={() => send({ id: info.id, type: "wake" })} disabled={info.sleep === "back"}>
              <span>
                {info.sleep === "back" ? "Kommt zurueck ..." : "Aufwecken"}
                <small>{asleep ? "Futter aus der Schlafzeit wird gutgeschrieben." : "Das Tier laeuft an seinen Platz."}</small>
              </span>
            </button>
          )}
          {info.sleep === "awake" && (
            <button className="pw-row" onClick={onNest}>
              <span>
                Nest verschieben
                <small>Zeigt das Nest zum Ziehen.</small>
              </span>
            </button>
          )}
          <button className="pw-row" role="switch" aria-checked={paused} onClick={onPause}>
            <span>
              Pausieren
              <small>Alle Tiere schlafen am Platz, kein Hunger.</small>
            </span>
            <span className="pw-switch" />
          </button>
        </div>
      </div>

      <div className="pw-group">
        <h3>App</h3>
        <div className="pw-rows">
          <button className="pw-row" onClick={onHome}>
            <span>Tiere verwalten</span>
          </button>
          <button className="pw-row" onClick={onSettings}>
            <span>Einstellungen</span>
          </button>
          <button className="pw-row" role="switch" aria-checked={autostart} onClick={onAutostart}>
            <span>
              Autostart mit Windows
              <small>Die Tiere erscheinen beim Anmelden.</small>
            </span>
            <span className="pw-switch" />
          </button>
          <button className="pw-row danger" onClick={onQuit}>
            <span>Beenden</span>
          </button>
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="pw-group">
          <h3>Entwickler</h3>
          <div className="pw-rows">
            <button className="pw-row" onClick={() => send({ id: info.id, type: "dev-feed" })}>
              <span>Futter geben</span>
            </button>
            <button className="pw-row" onClick={() => send({ id: info.id, type: "dev-hunger", delta: -0.2 })}>
              <span>Hunger um 20 % senken</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
