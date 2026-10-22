import { useEffect, useRef } from "react";
import { countCommits, fetchPushes } from "./github";
import { getStore, saveValue } from "./store";

const POLL_MS = 10 * 60 * 1000;
const MAX_SEEN = 500;

interface DayCount {
  day: string;
  n: number;
}

/** Lokales Datum als YYYY-MM-DD. */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Fragt alle 10 Minuten neue Pushes ab und meldet die Zahl neuer Commits.
 * Beim allerersten Lauf werden bestehende Pushes nur als gesehen markiert (kein Futter).
 * onCommits(neu, heute): neue Commits seit der letzten Abfrage und alle heutigen Commits.
 */
export function useCommits(onCommits: (fresh: number, today: number) => void) {
  const callback = useRef(onCommits);
  callback.current = onCommits;
  const pollNow = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    let busy = false;

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const store = await getStore();
        const token = (await store.get<string>("githubToken")) || undefined;
        const savedSeen = await store.get<string[]>("seenEvents");
        const first = savedSeen === undefined;
        const seen = new Set(savedSeen ?? []);
        const counts = (await store.get<Record<string, DayCount>>("commitCounts")) ?? {};

        const today = localDay(new Date());
        let fresh = 0;
        for (const push of await fetchPushes(token)) {
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

        await saveValue("seenEvents", [...seen].slice(-MAX_SEEN));
        await saveValue("commitCounts", counts);
        if (alive && fresh > 0) callback.current(fresh, todayTotal);
      } catch (e) {
        console.warn("GitHub-Abfrage fehlgeschlagen:", e);
      } finally {
        busy = false;
      }
    };

    pollNow.current = poll;
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return { pollNow: () => pollNow.current() };
}
