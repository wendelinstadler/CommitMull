import { useState } from "react";
import { formatMoney, formatPercent } from "../investTracker";
import { AgentCommand, AgentStatePayload } from "../protocol";
import { EntriesView, FocusView, formatAmount, InvestView } from "../trackers";

type Send = (cmd: AgentCommand) => void;

interface Props {
  info: AgentStatePayload;
  send: Send;
}

const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");

/** Reiter "Heute": Hinweise und die Ansichten der Futterquellen des aktiven Modus. */
export function TodayTab({ info, send }: Props) {
  const v = info.views;
  const id = info.id;
  const empty = !v.entries && !v.focus && !v.invest && !v.github;
  const modeName = (modeId: string) => info.modes.find((m) => m.id === modeId)?.label;

  return (
    <>
      {info.alerts.map((a) => (
        <div className="pw-alert" role="status" key={a.id}>
          <p>
            {a.text}
            {a.modeId !== info.activeMode && modeName(a.modeId) && <small> ({modeName(a.modeId)})</small>}
          </p>
          <button aria-label="Hinweis schliessen" onClick={() => send({ id, type: "alert-dismiss", alert: a.id })}>
            x
          </button>
        </div>
      ))}

      {v.entries && <EntriesCard view={v.entries} send={send} id={id} />}
      {v.focus && <FocusCard view={v.focus} send={send} id={id} />}
      {v.invest && <InvestCard view={v.invest} send={send} id={id} />}
      {v.github && (
        <section className="pw-section">
          <h2 className="pw-h">
            <span>GitHub</span>
            <button className="pw-link" onClick={() => send({ id, type: "poll-now" })}>
              Jetzt abfragen
            </button>
          </h2>
          <p className="pw-note" style={{ marginTop: 0 }}>
            Jeder neue Commit von <strong>{v.github.user || "(kein Benutzer)"}</strong> fuettert dein Tier. Die App fragt
            regelmaessig nach.
          </p>
        </section>
      )}

      {empty && (
        <div className="pw-empty">
          <strong>Dieser Modus hat noch keine Futterquelle.</strong>
          Lege in den Einstellungen unter "Modi" fest, was dein Tier fuettert.
        </div>
      )}
    </>
  );
}

function EntriesCard({ view, send, id }: { view: EntriesView; send: Send; id: string }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const expense = view.kind === "expense";
  const value = Number(amount.replace(",", "."));
  const valid = expense ? amount !== "" && Number.isFinite(value) && value > 0 : true;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    send({ id, type: "entry", amount: expense ? value : 1, note });
    setAmount("");
    setNote("");
  };

  const used = view.budget > 0 ? view.weekTotal / view.budget : 0;
  const left = view.budget - view.weekTotal;

  return (
    <section className="pw-section">
      <h2 className="pw-h">
        <span>{expense ? "Ausgaben diese Woche" : `${view.label} heute`}</span>
      </h2>
      {expense ? (
        <>
          <div className="pw-big">
            <span className={view.over ? "down" : ""}>{formatAmount(view.weekTotal)}</span>
            <small>
              von {formatAmount(view.budget)} {view.currency}
            </small>
          </div>
          <div className={`pw-bar ${view.over ? "over" : used > 0.8 ? "near" : ""}`} role="img" aria-label={`${Math.round(used * 100)} Prozent des Budgets`}>
            <span style={{ transform: `scaleX(${Math.min(1, used)})` }} />
          </div>
          <p className={`pw-note ${view.over ? "error" : ""}`}>
            {view.over
              ? `${formatAmount(-left)} ${view.currency} ueber dem Budget`
              : `Noch ${formatAmount(left)} ${view.currency} uebrig`}
          </p>
        </>
      ) : (
        <div className="pw-big">{view.todayCount}x</div>
      )}

      <form className="pw-form" onSubmit={submit}>
        {expense && (
          <input
            className="amount"
            inputMode="decimal"
            placeholder={`Betrag ${view.currency}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Betrag"
          />
        )}
        <input placeholder="Notiz" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} aria-label="Notiz" />
        <button className="pw-btn" type="submit" disabled={!valid}>
          {expense ? "Eintragen" : "Setzen"}
        </button>
      </form>

      {view.recent.length > 0 && (
        <>
          <ul className="pw-list">
            {view.recent.map((r) => (
              <li key={r.id}>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
          <p className="pw-note">
            <button className="pw-link" onClick={() => send({ id, type: "entry-undo" })}>
              Letzten Eintrag zuruecknehmen
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function FocusCard({ view, send, id }: { view: FocusView; send: Send; id: string }) {
  const block = view.blockMinutes;
  const into = view.elapsedMinutes % block;
  return (
    <section className="pw-section">
      <h2 className="pw-h">
        <span>Fokus</span>
        <span>heute {view.todayMinutes} Min</span>
      </h2>
      {view.running ? (
        <>
          <div className="pw-focus-state">
            <div className="pw-big">
              {view.elapsedMinutes}
              <small>Min laufen</small>
            </div>
          </div>
          <div className="pw-bar" role="img" aria-label={`${into} von ${block} Minuten bis zum naechsten Futter`}>
            <span style={{ transform: `scaleX(${into / block})` }} />
          </div>
          <p className="pw-note">
            Naechstes Futter in {block - into} Min ({block}-Minuten-Takt)
          </p>
        </>
      ) : (
        <p className="pw-note" style={{ marginTop: 0 }}>
          Alle {block} Minuten Fokus gibt es Futter.
        </p>
      )}
      {view.blocked.length > 0 && (
        <div className="pw-chips" aria-label="Gesperrte Programme">
          {view.blocked.map((name) => (
            <span key={name}>{name}</span>
          ))}
          {view.running && view.closedCount > 0 && <span>{view.closedCount} geschlossen</span>}
        </div>
      )}
      <button className={`pw-btn block ${view.running ? "secondary" : ""}`} onClick={() => send({ id, type: "focus-toggle" })}>
        {view.running ? "Fokus beenden" : "Fokus starten"}
      </button>
    </section>
  );
}

function InvestCard({ view, send, id }: { view: InvestView; send: Send; id: string }) {
  const time = view.updatedAt ? new Date(view.updatedAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <section className="pw-section">
      <h2 className="pw-h">
        <span>Depot</span>
        <button className="pw-link" onClick={() => send({ id, type: "invest-refresh" })} disabled={view.loading}>
          {view.loading ? "Lade ..." : "Aktualisieren"}
        </button>
      </h2>
      {view.count === 0 ? (
        <p className="pw-note" style={{ marginTop: 0 }}>
          Keine Positionen. Trage sie in den Einstellungen ein.
        </p>
      ) : (
        <>
          <div className="pw-big">
            {formatMoney(view.value)}
            <small>{view.base}</small>
          </div>
          <p className="pw-note" style={{ marginTop: 2 }}>
            Gewinn{" "}
            <strong className={tone(view.gain)}>
              {view.gain >= 0 ? "+" : "-"}
              {formatMoney(Math.abs(view.gain))} ({formatPercent(view.gainPct)})
            </strong>
            {" · "}Heute <strong className={tone(view.day)}>{formatPercent(view.dayPct)}</strong>
          </p>
          <div className="pw-table">
            <span className="head">Wert</span>
            <span className="head">Heute</span>
            <span className="head">Gesamt</span>
            {view.rows.slice(0, 10).map((r) => (
              <Row key={r.symbol} row={r} />
            ))}
          </div>
          {view.rows.length > 10 && <p className="pw-note">und {view.rows.length - 10} weitere</p>}
          {view.errors.length > 0 && <p className="pw-note error">{view.errors[0]}</p>}
          <p className="pw-note">{time ? `Stand ${time}, leicht verzoegert. Nur Anzeige, keine Anlageberatung.` : "Noch keine Kurse"}</p>
        </>
      )}
    </section>
  );
}

function Row({ row }: { row: InvestView["rows"][number] }) {
  return (
    <>
      <span className="sym" title={row.name}>
        {row.symbol}
      </span>
      <span className={`num ${row.dayPct === null ? "" : tone(row.dayPct)}`}>{row.dayPct === null ? "-" : formatPercent(row.dayPct)}</span>
      <span className={`num ${row.gainPct === null ? "" : tone(row.gainPct)}`}>{row.gainPct === null ? "-" : formatPercent(row.gainPct)}</span>
    </>
  );
}
