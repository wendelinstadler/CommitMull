import { pollGithub } from "./githubTracker";
import { GithubTracker } from "./trackers";

/** Futter-Ereignis eines abfragenden Trackers. amount = Anteil am Hunger (0..1). */
export interface FeedEvent {
  amount: number;
  /** Sprechblase, oder null. */
  text: string | null;
}

/**
 * Vertrag fuer abfragende Tracker: der Hub ruft poll() im Abstand intervalMs auf und fuettert das Tier mit dem Ergebnis.
 * poll() verwaltet seinen gespeicherten Zustand selbst und gibt null zurueck, wenn es nichts Neues gibt.
 */
export interface PollPlugin<T> {
  intervalMs(config: T): number;
  /** Ohne gueltige Konfiguration (z. B. leerer Benutzername) wird nicht abgefragt. */
  ready(config: T): boolean;
  poll(agentId: string, config: T): Promise<FeedEvent | null>;
}

export const githubPlugin: PollPlugin<GithubTracker> = {
  intervalMs: (c) => c.pollMinutes * 60 * 1000,
  ready: (c) => c.user.trim() !== "",
  async poll(agentId, c) {
    const { fresh, today } = await pollGithub(agentId, c);
    if (fresh <= 0) return null;
    return { amount: (fresh * c.foodPercent) / 100, text: `${today} ${today === 1 ? "Commit" : "Commits"} heute!` };
  },
};
