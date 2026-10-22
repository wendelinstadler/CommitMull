import { GithubTracker, trackerKey } from "./agents";
import { countCommits, fetchPushes } from "./github";
import { getStore, saveValue } from "./store";

const MAX_SEEN = 500;

interface DayCount {
  day: string;
  n: number;
}

/** Gespeicherter Zustand eines GitHub-Trackers. */
interface GithubState {
  user: string;
  seen: string[];
  counts: Record<string, DayCount>;
}

/** Lokales Datum als YYYY-MM-DD. */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Fragt neue Pushes ab. Beim allerersten Lauf (oder nach einem Benutzerwechsel) werden bestehende
 * Pushes nur als gesehen markiert und geben kein Futter.
 * Liefert die neuen Commits seit der letzten Abfrage und alle heutigen Commits.
 */
export async function pollGithub(agentId: string, cfg: GithubTracker): Promise<{ fresh: number; today: number }> {
  const store = await getStore();
  const key = trackerKey(agentId, "github");
  const saved = await store.get<GithubState>(key);
  const first = !saved || saved.user !== cfg.user;
  const seen = new Set(first ? [] : saved.seen);
  const counts = first ? {} : saved.counts;

  const token = cfg.token || undefined;
  const today = localDay(new Date());
  let fresh = 0;
  for (const push of await fetchPushes(cfg.user, token)) {
    const isNew = !seen.has(push.id);
    const isToday = localDay(new Date(push.createdAt)) === today;
    const feed = isNew && !first;
    if (feed || (isToday && !counts[push.id])) {
      const n = await countCommits(push, token);
      if (isToday) counts[push.id] = { day: today, n };
      if (feed) fresh += n;
    }
    seen.add(push.id);
  }

  let todayTotal = 0;
  for (const [id, c] of Object.entries(counts)) {
    if (c.day === today) todayTotal += c.n;
    else delete counts[id];
  }

  const next: GithubState = { user: cfg.user, seen: [...seen].slice(-MAX_SEEN), counts };
  await saveValue(key, next);
  return { fresh, today: todayTotal };
}
