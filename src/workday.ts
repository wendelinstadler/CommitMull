/**
 * Arbeitsalltag: Aufgaben und Hinweise eines Tiers. Alles Reine (ohne Tauri), damit es sich testen laesst.
 * Gespeichert wird vom Hub unter todos:<tierId> und alerts:<tierId>.
 */
import { formatMoney, formatPercent } from "./investTracker";
import { InvestTracker, InvestView } from "./trackers";

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  ts: number;
  doneTs?: number;
  /** Hat beim Erledigen schon gefuettert (jede Aufgabe fuettert hoechstens einmal). */
  fed?: boolean;
}

/** Ein Hinweis des Tiers, z. B. eine grosse Kursbewegung. */
export interface Alert {
  id: string;
  ts: number;
  /** Wer ihn ausgeloest hat: "depot" oder das Kuerzel einer Position (fuer die Pause zwischen gleichen Hinweisen). */
  key: string;
  text: string;
  /** Modus, in dem der Hinweis entstand (zum Anzeigen und fuer "Erklaeren"). */
  modeId: string;
}

export const MAX_TODOS = 200;
export const MAX_ALERTS = 20;
export const TODO_MAX_LENGTH = 200;
/** So lange gibt es zum selben Ausloeser (Depot oder Kuerzel) keinen zweiten Hinweis. */
export const ALERT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export const todosKey = (agentId: string) => `todos:${agentId}`;
export const alertsKey = (agentId: string) => `alerts:${agentId}`;

export const DEFAULT_ALERT_DAY_PCT = 3;
export const DEFAULT_ALERT_POSITION_PCT = 5;
export const ALERT_OPTIONS = [0, 2, 3, 5, 10];

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Neue Aufgabe aus Text, oder null, wenn der Text leer ist. */
export function makeTodo(text: string, now = Date.now()): Todo | null {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, TODO_MAX_LENGTH);
  return clean ? { id: newId(), text: clean, done: false, ts: now } : null;
}

/** Haken setzen oder entfernen. */
export function toggleTodo(list: Todo[], id: string, now = Date.now()): Todo[] {
  return list.map((t) => (t.id === id ? { ...t, done: !t.done, doneTs: t.done ? undefined : now } : t));
}

/** Offene Aufgaben zuerst (neueste oben), dann erledigte (zuletzt erledigte oben). */
export function sortedTodos(list: Todo[]): Todo[] {
  const open = list.filter((t) => !t.done).sort((a, b) => b.ts - a.ts);
  const done = list.filter((t) => t.done).sort((a, b) => (b.doneTs ?? 0) - (a.doneTs ?? 0));
  return [...open, ...done];
}

/**
 * Erkennt grosse Bewegungen im Depot: Tagesveraenderung des Depots oder einer Position ueber den Schwellen.
 * Schwelle 0 = aus. Gibt Hinweise ohne Zeit/Id zurueck; der Hub entscheidet mit alreadyAlerted ueber die Pause.
 */
export function investAlerts(
  view: InvestView,
  tracker: Pick<InvestTracker, "alertDayPct" | "alertPositionPct">,
): { key: string; text: string }[] {
  const dayLimit = (tracker.alertDayPct ?? DEFAULT_ALERT_DAY_PCT) / 100;
  const positionLimit = (tracker.alertPositionPct ?? DEFAULT_ALERT_POSITION_PCT) / 100;
  const out: { key: string; text: string }[] = [];
  if (view.updatedAt === null) return out;
  if (dayLimit > 0 && view.count > 0 && Math.abs(view.dayPct) >= dayLimit) {
    const sign = view.day >= 0 ? "+" : "-";
    out.push({
      key: "depot",
      text: `Dein Depot ist heute ${formatPercent(view.dayPct)} (${sign}${formatMoney(Math.abs(view.day))} ${view.base}).`,
    });
  }
  if (positionLimit > 0) {
    for (const row of view.rows) {
      if (row.dayPct !== null && Math.abs(row.dayPct) >= positionLimit) {
        out.push({ key: row.symbol, text: `${row.symbol} ist heute ${formatPercent(row.dayPct)}.` });
      }
    }
  }
  return out;
}

/** Filtert Hinweise, zu denen es gerade erst einen gab (gleicher Ausloeser innerhalb der Pause). */
export function freshAlerts(
  candidates: { key: string; text: string }[],
  existing: Alert[],
  now = Date.now(),
  cooldownMs = ALERT_COOLDOWN_MS,
): { key: string; text: string }[] {
  return candidates.filter((c) => !existing.some((a) => a.key === c.key && now - a.ts < cooldownMs));
}

export function makeAlert(key: string, text: string, modeId: string, now = Date.now()): Alert {
  return { id: newId(), ts: now, key, text, modeId };
}
