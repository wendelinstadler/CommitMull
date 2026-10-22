import { useState } from "react";
import { Mood } from "./behavior";
import { EntriesView, FocusView, formatAmount, TrackerViews } from "./trackers";

interface Props {
  name: string;
  subtitle: string;
  hunger: number;
  mood: Mood;
  paused: boolean;
  views: TrackerViews;
  onEntry: (amount: number, note: string) => void;
  onUndo: () => void;
  onFocusToggle: () => void;
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
  name,
  subtitle,
  hunger,
  mood,
  paused,
  views,
  onEntry,
  onUndo,
  onFocusToggle,
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
      <div className="panel-title">{name}</div>
      <div className="panel-subtitle">{subtitle}</div>

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

      {views.entries && <EntriesSection view={views.entries} onEntry={onEntry} onUndo={onUndo} />}
      {views.focus && <FocusSection view={views.focus} onToggle={onFocusToggle} />}

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

/** Eintragen: Ausgaben mit Betrag gegen das Wochenbudget, oder Haken. */
function EntriesSection({
  view,
  onEntry,
  onUndo,
}: {
  view: EntriesView;
  onEntry: (amount: number, note: string) => void;
  onUndo: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const expense = view.kind === "expense";
  const value = Number(amount.replace(",", "."));
  const valid = expense ? amount !== "" && Number.isFinite(value) && value > 0 : true;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onEntry(expense ? value : 1, note);
    setAmount("");
    setNote("");
  };

  const used = view.budget > 0 ? view.weekTotal / view.budget : 0;
  const meter = view.over ? "sad" : used > 0.8 ? "ok" : "happy";

  return (
    <div className="panel-section">
      {expense ? (
        <>
          <div className="panel-row">
            <span>Diese Woche</span>
            <strong className={view.over ? "over" : ""}>
              {formatAmount(view.weekTotal)} von {formatAmount(view.budget)} {view.currency}
            </strong>
          </div>
          <div className={`meter meter-${meter}`}>
            <div className="meter-fill" style={{ transform: `scaleX(${Math.min(1, used)})` }} />
          </div>
        </>
      ) : (
        <div className="panel-row">
          <span>Heute</span>
          <strong>{view.todayCount}x</strong>
        </div>
      )}

      <form className="panel-form" onSubmit={submit}>
        {expense && (
          <input
            inputMode="decimal"
            placeholder={`Betrag (${view.currency})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Betrag"
          />
        )}
        <input
          placeholder="Notiz (optional)"
          value={note}
          maxLength={60}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Notiz"
        />
        <button type="submit" disabled={!valid}>
          {expense ? "Eintragen" : `${view.label} setzen`}
        </button>
      </form>

      {view.recent.length > 0 && (
        <>
          <ul className="panel-recent">
            {view.recent.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
          <button className="panel-link" onClick={onUndo}>
            Letzten Eintrag zuruecknehmen
          </button>
        </>
      )}
    </div>
  );
}

/** Fokus-Timer: Start und Stopp, pro volle Zeitspanne gibt es Futter. */
function FocusSection({ view, onToggle }: { view: FocusView; onToggle: () => void }) {
  return (
    <div className="panel-section">
      <div className="panel-row">
        <span>Fokus heute</span>
        <strong>{view.todayMinutes} Min</strong>
      </div>
      {view.running && (
        <div className="panel-row">
          <span>Laeuft</span>
          <strong>
            {view.elapsedMinutes % view.blockMinutes} von {view.blockMinutes} Min
          </strong>
        </div>
      )}
      <div className="panel-form">
        <button onClick={onToggle}>{view.running ? "Stopp" : "Fokus starten"}</button>
      </div>
    </div>
  );
}
