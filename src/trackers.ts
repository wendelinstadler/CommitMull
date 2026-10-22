/**
 * Tracker = Futterquellen eines Agenten. Jeder Tracker erzeugt Futter-Ereignisse; der Hub rechnet sie in Hunger um.
 *
 * Es gibt zwei Arten:
 * - abfragende Tracker (GitHub): der Hub fragt regelmaessig nach, siehe trackerPlugins.ts (PollPlugin)
 * - Eingabe-Tracker: "entries" (manuelle Eintraege, z. B. Ausgabe oder Haken) und "focus" (Fokus-Timer);
 *   die Eingaben kommen aus dem Panel des Tiers beim Hub an (protocol.ts).
 *
 * Ein neuer Tracker braucht: Typ und Standardwerte hier, die Anzeige im Panel, die Konfiguration in der Verwaltung
 * und (wenn er abfragt) einen Eintrag in trackerPlugins.ts.
 */

export interface GithubTracker {
  type: "github";
  user: string;
  /** Optional; mit Token zaehlen auch private Repos und das Abfrage-Limit steigt. */
  token: string;
  pollMinutes: number;
  /** Futter pro Commit in Prozent. */
  foodPercent: number;
}

/** Manuelle Eintraege: Ausgaben mit Wochenbudget oder einfache Haken (Gewohnheit, Training ...). */
export interface EntriesTracker {
  type: "entries";
  kind: "expense" | "check";
  /** Name des Eintrags, z. B. "Ausgabe" oder "Training". */
  label: string;
  /** Futter pro Eintrag in Prozent. */
  foodPercent: number;
  /** Wochenbudget (nur bei Ausgaben). */
  budget: number;
  currency: string;
}

/** Fokus-Timer: pro volle Zeitspanne gibt es Futter. */
export interface FocusTracker {
  type: "focus";
  blockMinutes: number;
  /** Futter pro volle Zeitspanne in Prozent. */
  foodPercent: number;
}

export type Tracker = GithubTracker | EntriesTracker | FocusTracker;
export type TrackerType = Tracker["type"];

export const TRACKER_LABELS: Record<TrackerType, string> = {
  github: "GitHub-Commits",
  entries: "Manuelle Eintraege",
  focus: "Fokus-Timer",
};

export const FOCUS_BLOCK_OPTIONS = [15, 25, 45, 60];

export function defaultTracker(type: "github"): GithubTracker;
export function defaultTracker(type: "entries", kind?: EntriesTracker["kind"], label?: string): EntriesTracker;
export function defaultTracker(type: "focus"): FocusTracker;
export function defaultTracker(type: TrackerType, kind: EntriesTracker["kind"] = "expense", label?: string): Tracker {
  switch (type) {
    case "github":
      return { type, user: "", token: "", pollMinutes: 10, foodPercent: 25 };
    case "entries":
      return {
        type,
        kind,
        label: label ?? (kind === "expense" ? "Ausgabe" : "Haken"),
        foodPercent: 25,
        budget: 150,
        currency: "CHF",
      };
    case "focus":
      return { type, blockMinutes: 25, foodPercent: 25 };
  }
}

export const trackerOf = <T extends TrackerType>(trackers: Tracker[], type: T) =>
  trackers.find((t): t is Extract<Tracker, { type: T }> => t.type === type);

// ---------------------------------------------------------------------------------------------
// Gespeicherte Daten (schreibt nur der Hub)

/** Ein manueller Eintrag. Bei Haken ist amount 1. */
export interface Entry {
  id: string;
  ts: number;
  amount: number;
  note: string;
}

/** Eine abgeschlossene Fokus-Sitzung. */
export interface FocusSession {
  ts: number;
  minutes: number;
}

export const MAX_LOG = 500;
export const entriesKey = (agentId: string) => `entries:${agentId}`;
export const focusKey = (agentId: string) => `focus:${agentId}`;

// ---------------------------------------------------------------------------------------------
// Anzeige im Panel (reine Funktionen, vom Hub berechnet und mit dem Zustand geschickt)

export interface EntriesView {
  kind: EntriesTracker["kind"];
  label: string;
  currency: string;
  budget: number;
  weekTotal: number;
  todayCount: number;
  /** Ausgaben diese Woche ueber dem Budget (nur bei Ausgaben). */
  over: boolean;
  /** Die letzten Eintraege, neueste zuerst. */
  recent: { id: string; text: string }[];
}

export interface FocusView {
  running: boolean;
  elapsedMinutes: number;
  blockMinutes: number;
  todayMinutes: number;
}

export interface TrackerViews {
  entries?: EntriesView;
  focus?: FocusView;
}

export const startOfDay = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Montag 00:00 (lokal) der Woche, in der ts liegt. */
export const startOfWeek = (ts: number) => {
  const d = new Date(startOfDay(ts));
  const weekday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekday).getTime();
};

/** Zahl ohne unnoetige Nachkommastellen: 12 oder 12.5 oder 12.34. */
export const formatAmount = (n: number) => String(Math.round(n * 100) / 100);

const clock = (ts: number) => new Date(ts).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });

export function entriesView(t: EntriesTracker, entries: Entry[], now: number): EntriesView {
  const week = startOfWeek(now);
  const day = startOfDay(now);
  const thisWeek = entries.filter((e) => e.ts >= week);
  const weekTotal = thisWeek.reduce((sum, e) => sum + e.amount, 0);
  return {
    kind: t.kind,
    label: t.label,
    currency: t.currency,
    budget: t.budget,
    weekTotal,
    todayCount: entries.filter((e) => e.ts >= day).length,
    over: t.kind === "expense" && t.budget > 0 && weekTotal > t.budget,
    recent: entries
      .slice(-3)
      .reverse()
      .map((e) => ({
        id: e.id,
        text:
          t.kind === "expense"
            ? `${formatAmount(e.amount)} ${t.currency}${e.note ? ` ${e.note}` : ""}`
            : `${clock(e.ts)}${e.note ? ` ${e.note}` : ""}`,
      })),
  };
}

export function focusView(
  t: FocusTracker,
  sessions: FocusSession[],
  running: { startedAt: number } | undefined,
  now: number,
): FocusView {
  const day = startOfDay(now);
  const elapsedMinutes = running ? Math.floor((now - running.startedAt) / 60_000) : 0;
  const doneToday = sessions.filter((s) => s.ts >= day).reduce((sum, s) => sum + s.minutes, 0);
  return {
    running: !!running,
    elapsedMinutes,
    blockMinutes: t.blockMinutes,
    todayMinutes: doneToday + elapsedMinutes,
  };
}
