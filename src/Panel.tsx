import { Mood } from "./behavior";

interface Props {
  hunger: number;
  mood: Mood;
  paused: boolean;
  autostart: boolean;
  onTogglePause: () => void;
  onToggleAutostart: () => void;
  onSettings: () => void;
  onQuit: () => void;
  /** Nur im Dev-Modus gesetzt */
  onFeed?: () => void;
}

const MOOD_LABEL: Record<Mood, string> = {
  happy: "Froehlich",
  ok: "Geht so",
  sad: "Hungrig",
};

export function Panel({
  hunger,
  mood,
  paused,
  autostart,
  onTogglePause,
  onToggleAutostart,
  onSettings,
  onQuit,
  onFeed,
}: Props) {
  const percent = Math.round(hunger * 100);

  return (
    <div className="panel" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <div className="panel-title">CommitMull</div>

      <div className="panel-row">
        <span>Stimmung</span>
        <strong>{paused ? "Schlaeft" : MOOD_LABEL[mood]}</strong>
      </div>

      <div className="panel-row">
        <span>Sattheit</span>
        <strong>{percent} %</strong>
      </div>
      <div className={`meter meter-${mood}`}>
        <div className="meter-fill" style={{ transform: `scaleX(${hunger})` }} />
      </div>

      <div className="panel-row">
        <span>Commits heute</span>
        <strong>-</strong>
      </div>

      <div className="panel-buttons">
        {onFeed && <button onClick={onFeed}>Futter geben (Dev)</button>}
        <button onClick={onTogglePause}>{paused ? "Weiter" : "Pausieren"}</button>
        <button onClick={onToggleAutostart}>Autostart: {autostart ? "an" : "aus"}</button>
        <button onClick={onSettings}>Einstellungen</button>
        <button className="danger" onClick={onQuit}>
          Beenden
        </button>
      </div>
    </div>
  );
}
