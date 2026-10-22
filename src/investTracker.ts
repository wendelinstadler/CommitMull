import { invoke } from "@tauri-apps/api/core";
import { InvestRow, InvestTracker, InvestView } from "./trackers";

/** Kurs, wie ihn der Befehl fetch_quote liefert (Yahoo Finance). */
export interface RawQuote {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  previousClose: number;
}

/** Zuletzt geladene Kurse eines Depots (wird gespeichert, damit nach einem Start sofort Zahlen da sind). */
export interface Snapshot {
  ts: number;
  quotes: Record<string, RawQuote>;
  /** Umrechnungskurse in die Anzeigewaehrung: fx["USD"] = Wert von 1 USD in der Anzeigewaehrung. */
  fx: Record<string, number>;
  /** Fehlermeldungen je Kuerzel (oder "FX USD"). */
  errors: Record<string, string>;
}

/** Londoner Kurse kommen in Pence (GBp): in Pfund umrechnen. */
export function normalizeQuote(q: RawQuote): RawQuote {
  if (q.currency === "GBp" || q.currency === "GBX") {
    return { ...q, currency: "GBP", price: q.price / 100, previousClose: q.previousClose / 100 };
  }
  return q;
}

export const symbolsOf = (cfg: InvestTracker) => [...new Set(cfg.positions.map((p) => p.symbol.trim().toUpperCase()))].filter(Boolean);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type QuoteFetcher = (symbol: string) => Promise<RawQuote>;

const viaRust: QuoteFetcher = (symbol) => invoke<RawQuote>("fetch_quote", { symbol });

/**
 * Laedt alle Kurse des Depots und die Umrechnungskurse in die Anzeigewaehrung. Die Abfragen laufen nacheinander mit
 * kleiner Pause (Yahoo bremst bei vielen Anfragen gleichzeitig). Einzelne Fehler stoppen nichts: Sie landen in errors,
 * ein frueherer Kurs bleibt dann stehen (prev).
 */
export async function fetchSnapshot(cfg: InvestTracker, prev?: Snapshot, fetchQuote: QuoteFetcher = viaRust, delayMs = 250): Promise<Snapshot> {
  const base = cfg.baseCurrency.trim().toUpperCase();
  const quotes: Record<string, RawQuote> = {};
  const errors: Record<string, string> = {};
  const fx: Record<string, number> = {};

  const load = async (symbol: string) => {
    try {
      return await fetchQuote(symbol);
    } catch (e) {
      errors[symbol] = String(e);
      return null;
    } finally {
      await pause(delayMs);
    }
  };

  for (const symbol of symbolsOf(cfg)) {
    const raw = await load(symbol);
    if (raw) quotes[symbol] = normalizeQuote(raw);
    else if (prev?.quotes[symbol]) quotes[symbol] = prev.quotes[symbol];
  }

  const currencies = new Set(Object.values(quotes).map((q) => q.currency.toUpperCase()).filter((c) => c && c !== base));
  for (const currency of currencies) {
    const raw = await load(`${currency}${base}=X`);
    if (raw && raw.price > 0) fx[currency] = raw.price;
    else if (prev?.fx[currency]) fx[currency] = prev.fx[currency];
  }

  return { ts: Date.now(), quotes, fx, errors };
}

/** Berechnet die Anzeige aus Depot und gespeicherten Kursen (reine Funktion). */
export function investView(cfg: InvestTracker, snap: Snapshot | undefined, loading = false): InvestView {
  const base = cfg.baseCurrency.trim().toUpperCase();
  const rate = (currency: string) => (currency.toUpperCase() === base ? 1 : snap?.fx[currency.toUpperCase()] ?? null);

  let value = 0;
  let cost = 0;
  let day = 0;
  const rows: InvestRow[] = cfg.positions.map((p) => {
    const symbol = p.symbol.trim().toUpperCase();
    const q = snap?.quotes[symbol];
    if (!q) return { symbol, name: symbol, price: null, currency: "", dayPct: null, gainPct: null, value: null };
    const fx = rate(q.currency);
    const positionValue = fx === null ? null : p.qty * q.price * fx;
    if (fx !== null) {
      value += p.qty * q.price * fx;
      cost += p.qty * p.buyPrice * fx;
      day += p.qty * (q.price - q.previousClose) * fx;
    }
    return {
      symbol,
      name: q.name,
      price: q.price,
      currency: q.currency,
      dayPct: q.previousClose > 0 ? (q.price - q.previousClose) / q.previousClose : null,
      gainPct: p.buyPrice > 0 ? (q.price - p.buyPrice) / p.buyPrice : null,
      value: positionValue,
    };
  });

  const gain = value - cost;
  const yesterday = value - day;
  return {
    base,
    count: cfg.positions.length,
    value,
    cost,
    gain,
    gainPct: cost > 0 ? gain / cost : 0,
    day,
    dayPct: yesterday > 0 ? day / yesterday : 0,
    updatedAt: snap?.ts ?? null,
    rows,
    errors: Object.values(snap?.errors ?? {}),
    loading,
  };
}

/** Geldbetrag fuer die Anzeige: 12'345 bzw. 12'345.50 bei kleinen Betraegen. */
export const formatMoney = (n: number) =>
  n.toLocaleString("de-CH", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 });

/** Prozent mit Vorzeichen: +1.2 % (aus 0.012). */
export const formatPercent = (fraction: number) => `${fraction >= 0 ? "+" : "-"}${Math.abs(fraction * 100).toFixed(1)} %`;
