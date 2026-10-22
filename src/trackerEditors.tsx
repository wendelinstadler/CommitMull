import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RawQuote } from "./investTracker";
import { INVEST_REFRESH_OPTIONS, InvestTracker, Position, prettyApp } from "./trackers";

interface RunningApp {
  exe: string;
  title: string;
}

/** Sperrliste fuer den Fokus-Timer: Programme per Name eintragen oder aus den laufenden auswaehlen. */
export function BlockListEditor({ blocked, onChange }: { blocked: string[]; onChange: (list: string[]) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<RunningApp[] | null>(null);

  const add = async (raw: string) => {
    if (!raw.trim()) return;
    try {
      const exe = await invoke<string>("check_app_name", { name: raw });
      if (!blocked.includes(exe)) onChange([...blocked, exe]);
      setName("");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const showRunning = async () => {
    try {
      setRunning(await invoke<RunningApp[]>("list_running_apps"));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="editor">
      <span className="editor-title">Gesperrte Programme</span>
      <small>
        Waehrend der Fokus laeuft, warnt das Tier, wenn eines davon aufgeht, und schliesst es nach der Frist sanft (wie ein
        Klick auf X, Programme fragen bei ungespeicherter Arbeit nach).
      </small>
      {blocked.length > 0 && (
        <ul className="chips">
          {blocked.map((exe) => (
            <li key={exe}>
              {prettyApp(exe)}
              <button aria-label={`${prettyApp(exe)} entfernen`} onClick={() => onChange(blocked.filter((b) => b !== exe))}>
                x
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="editor-row">
        <input
          value={name}
          placeholder="Programmname, z. B. discord.exe"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add(name))}
          spellCheck={false}
        />
        <button type="button" onClick={() => add(name)}>
          Hinzufuegen
        </button>
      </div>
      <button type="button" className="editor-link" onClick={showRunning}>
        Aus laufenden Programmen waehlen
      </button>
      {running && (
        <ul className="running">
          {running.length === 0 && <li className="muted">Keine Programme mit Fenster gefunden.</li>}
          {running.map((app) => (
            <li key={app.exe}>
              <button type="button" onClick={() => add(app.exe)} disabled={blocked.includes(app.exe)}>
                <strong>{prettyApp(app.exe)}</strong> <span>{app.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <small className="editor-error">{error}</small>}
    </div>
  );
}

const SYMBOL = /^[A-Za-z0-9.\-=^_]{1,24}$/;

/** Pruefung fuer das Speichern: liefert eine Fehlermeldung oder null. */
export function validateInvest(t: InvestTracker): string | null {
  if (!/^[A-Za-z]{3}$/.test(t.baseCurrency.trim())) return "Die Waehrung der Anzeige braucht drei Buchstaben, z. B. CHF.";
  for (const p of t.positions) {
    if (!SYMBOL.test(p.symbol.trim())) return `Ungueltiges Kuerzel: "${p.symbol}". Erlaubt sind Buchstaben, Ziffern und . - = ^ _`;
    if (!(p.qty > 0) || !Number.isFinite(p.qty)) return `${p.symbol}: Die Stueckzahl muss groesser als 0 sein.`;
    if (!(p.buyPrice >= 0) || !Number.isFinite(p.buyPrice)) return `${p.symbol}: Der Kaufkurs darf nicht negativ sein.`;
  }
  return null;
}

/** Depot: Positionen mit Kuerzel, Stueckzahl und Kaufkurs. Nur Anzeige, keine Anlageberatung. */
export function InvestEditor({ tracker, onChange }: { tracker: InvestTracker; onChange: (patch: Partial<InvestTracker>) => void }) {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<string[] | null>(null);

  const setPosition = (id: string, patch: Partial<Position>) =>
    onChange({ positions: tracker.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const addPosition = () =>
    onChange({
      positions: [...tracker.positions, { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, symbol: "", qty: 1, buyPrice: 0 }],
    });

  const check = async () => {
    setChecking(true);
    const lines: string[] = [];
    for (const p of tracker.positions) {
      const symbol = p.symbol.trim().toUpperCase();
      if (!SYMBOL.test(symbol)) {
        lines.push(`${p.symbol || "(leer)"}: ungueltiges Kuerzel`);
        continue;
      }
      try {
        const q = await invoke<RawQuote>("fetch_quote", { symbol });
        lines.push(`${symbol}: ${q.name} (${q.price} ${q.currency})`);
      } catch (e) {
        lines.push(String(e));
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    setResults(lines);
    setChecking(false);
  };

  return (
    <div className="editor">
      <div className="manage-two">
        <label>
          <span>Anzeigewaehrung</span>
          <input value={tracker.baseCurrency} maxLength={3} onChange={(e) => onChange({ baseCurrency: e.target.value.toUpperCase() })} />
        </label>
        <label>
          <span>Kurse laden</span>
          <select value={tracker.refreshMinutes} onChange={(e) => onChange({ refreshMinutes: Number(e.target.value) })}>
            {INVEST_REFRESH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                alle {m} Min
              </option>
            ))}
          </select>
        </label>
      </div>

      {tracker.positions.length > 0 && (
        <div className="positions">
          <span className="head">Kuerzel</span>
          <span className="head">Stueck</span>
          <span className="head">Kaufkurs</span>
          <span />
          {tracker.positions.map((p) => (
            <PositionFields key={p.id} p={p} onChange={(patch) => setPosition(p.id, patch)} onRemove={() => onChange({ positions: tracker.positions.filter((x) => x.id !== p.id) })} />
          ))}
        </div>
      )}
      <div className="editor-row">
        <button type="button" onClick={addPosition}>
          Position hinzufuegen
        </button>
        {tracker.positions.length > 0 && (
          <button type="button" onClick={check} disabled={checking}>
            {checking ? "Pruefe ..." : "Kuerzel pruefen"}
          </button>
        )}
      </div>
      <small>
        Kuerzel wie bei Yahoo Finance: AAPL, SAP.DE, VWRL.L, BTC-USD. Der Kaufkurs steht in der Waehrung des Kurses (London in Pfund).
        Wert und Gewinn werden zum aktuellen Umrechnungskurs in {tracker.baseCurrency || "die Anzeigewaehrung"} umgerechnet. Die Kurse sind
        leicht verzoegert und nur zur Anzeige, keine Anlageberatung.
      </small>
      {results && (
        <ul className="running">
          {results.map((line) => (
            <li key={line} className="muted">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PositionFields({ p, onChange, onRemove }: { p: Position; onChange: (patch: Partial<Position>) => void; onRemove: () => void }) {
  return (
    <>
      <input value={p.symbol} placeholder="AAPL" spellCheck={false} aria-label="Kuerzel" onChange={(e) => onChange({ symbol: e.target.value.toUpperCase() })} />
      <input type="number" min={0} step="any" value={p.qty} aria-label="Stueckzahl" onChange={(e) => onChange({ qty: Number(e.target.value) })} />
      <input type="number" min={0} step="any" value={p.buyPrice} aria-label="Kaufkurs" onChange={(e) => onChange({ buyPrice: Number(e.target.value) })} />
      <button type="button" className="icon" aria-label={`${p.symbol || "Position"} entfernen`} onClick={onRemove}>
        x
      </button>
    </>
  );
}
