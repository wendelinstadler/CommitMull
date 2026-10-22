import { useEffect, useRef } from "react";
import { countCommits, fetchPushes } from "./github";
import { Settings } from "./settings";
import { getStore, saveValue } from "./store";

const MAX_SEEN = 500;

interface DayCount {
  day: string;
  n: number;
}

/** Lokales Datum als YYYY-MM-DD. */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Fragt im eingestellten Intervall neue Pushes ab und meldet die Zahl neuer Commits.
 * Beim allerersten Lauf werden bestehende Pushes nur als gesehen markiert (kein Futter).
 * Wechselt der Benutzername, zaehlt das wieder als erster Lauf.
 * onCommits(neu, heute): neue Commits seit der letzten Abfrage und alle heutigen Commits.
 */
export function useCommits(onCommits: (fresh: number, today: number) => void, settings: Settings | null) {
  const callback = useRef(onCommits);
  callback.current = onCommits;
  const pollNow = useRef<() => Promise<void>>(async () => {});

  const user = settings?.githubUser;
  const token = settings?.githubToken || undefined;
  const pollMinutes = settings?.pollMinutes;

  useEffect(() => {
    if (!user || !pollMinutes) return;
    let alive = true;
    let busy = false;

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const store = await getStore();
        const savedSeen = await store.get<string[]>("seenEvents");
        // Fehlender seenUser: aeltere Version, damals war der Benutzer derselbe.
        const savedUser = (await store.get<string>("seenUser")) ?? user;
        const first = savedSeen === undefined || savedUser !== user;
        const seen = new Set(first ? [] : savedSeen);
        const counts = first ? {} : (await store.get<Record<string, DayCount>>("commitCounts")) ?? {};

        const today = localDay(new Date());
        let fresh = 0;
        for (const push of await fetchPushes(user, token)) {
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

        await saveValue("seenUser", user);
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
    const id = window.setInterval(poll, pollMinutes * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [user, token, pollMinutes]);

  return { pollNow: () => pollNow.current() };
}
