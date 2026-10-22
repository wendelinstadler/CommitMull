import { useState } from "react";
import { Mood } from "./behavior";
import { SleepPhase } from "./protocol";
import { formatMoney, formatPercent } from "./investTracker";
import { EntriesView, FocusView, formatAmount, InvestView, TrackerViews } from "./trackers";

interface Props {
  name: string;
  subtitle: string;
  hunger: number;
  mood: Mood;
  paused: boolean;
  sleep: SleepPhase;
  onSleep: () => void;
  onWake: () => void;
  onNestEdit: () => void;
  views: TrackerViews;
  onEntry: (amount: number, note: string) => void;
  onUndo: () => void;
  onFocusToggle: () => void;
  onInvestRefresh: () => void;
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
  sleep,
  onSleep,
  onWake,
  onNestEdit,
  views,
  onEntry,
  onUndo,
  onFocusToggle,
  onInvestRefresh,
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
        <strong>{paused || sleep === "asleep" || sleep === "to-nest" ? "Schlaeft" : MOOD_LABEL[mood]}</strong>
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
      {views.invest && <InvestSection view={views.invest} onRefresh={onInvestRefresh} />}

      <div className="panel-buttons">
        {onFeed && <button onClick={onFeed}>Futter geben (Dev)</button>}
        {sleep === "awake" ? (
          <button onClick={onSleep}>Schlafen schicken</button>
        ) : (
          <button onClick={onWake} disabled={sleep === "back"}>
            {sleep === "back" ? "Kommt zurueck ..." : "Aufwecken"}
          </button>
        )}
        {sleep === "awake" && <button onClick={onNestEdit}>Nest verschieben</button>}
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
      {view.blocked.length > 0 && (
        <div className="panel-note">
          Gesperrt: {view.blocked.join(", ")}
          {view.running && view.closedCount > 0 && <> ({view.closedCount} geschlossen)</>}
        </div>
      )}
      <div className="panel-form">
        <button onClick={onToggle}>{view.running ? "Stopp" : "Fokus starten"}</button>
      </div>
    </div>
  );
}

const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");

/** Depot: Wert, Gewinn/Verlust und die einzelnen Positionen mit Tages- und Gesamtveraenderung. Nur Anzeige. */
function InvestSection({ view, onRefresh }: { view: InvestView; onRefresh: () => void }) {
  const time = view.updatedAt
    ? new Date(view.updatedAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div className="panel-section">
      <div className="panel-row">
        <span>Depot</span>
        <strong>
          {formatMoney(view.value)} {view.base}
        </strong>
      </div>
      {view.count === 0 ? (
        <div className="panel-note">Keine Positionen. Trage sie in den Einstellungen ein.</div>
      ) : (
        <>
          <div className="panel-row">
            <span>Gewinn</span>
            <strong className={tone(view.gain)}>
              {view.gain >= 0 ? "+" : "-"}
              {formatMoney(Math.abs(view.gain))} ({formatPercent(view.gainPct)})
            </strong>
          </div>
          <div className="panel-row">
            <span>Heute</span>
            <strong className={tone(view.day)}>{formatPercent(view.dayPct)}</strong>
          </div>
          <div className="panel-table">
            <span />
            <span className="head">Heute</span>
            <span className="head">Gesamt</span>
            {view.rows.slice(0, 8).map((r) => (
              <PositionRow key={r.symbol} row={r} />
            ))}
          </div>
          {view.rows.length > 8 && <div className="panel-note">und {view.rows.length - 8} weitere</div>}
          {view.errors.length > 0 && <div className="panel-note error">{view.errors[0]}</div>}
          <div className="panel-note">
            {view.loading ? "Lade Kurse ..." : time ? `Stand ${time}` : "Noch keine Kurse"}{" "}
            <button className="panel-link" onClick={onRefresh} disabled={view.loading}>
              Aktualisieren
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PositionRow({ row }: { row: InvestView["rows"][number] }) {
  return (
    <>
      <span className="sym" title={row.name}>
        {row.symbol}
      </span>
      <span className={row.dayPct === null ? "" : tone(row.dayPct)}>{row.dayPct === null ? "-" : formatPercent(row.dayPct)}</span>
      <span className={row.gainPct === null ? "" : tone(row.gainPct)}>{row.gainPct === null ? "-" : formatPercent(row.gainPct)}</span>
    </>
  );
}
