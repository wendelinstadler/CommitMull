const API = "https://api.github.com";

export const GITHUB_USER = "wendelinstadler";

export interface Push {
  id: string;
  createdAt: string;
  before: string;
  head: string;
  repo: string;
}

interface RawEvent {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string };
  payload: { before?: string; head?: string };
}

const NULL_SHA = "0".repeat(40);

function headers(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Letzte Pushes des Nutzers. Ohne Token nur oeffentliche, mit Token auch private.
 * cache: "no-cache" laesst den Browser per ETag nachfragen; ein 304 zaehlt nicht gegen das Limit.
 */
export async function fetchPushes(token?: string): Promise<Push[]> {
  const path = token ? "events" : "events/public";
  const res = await fetch(`${API}/users/${GITHUB_USER}/${path}?per_page=100`, {
    headers: headers(token),
    cache: "no-cache",
  });
  if (!res.ok) throw new Error(`GitHub-Events: HTTP ${res.status}`);
  const events: RawEvent[] = await res.json();
  return events
    .filter((e) => e.type === "PushEvent" && e.payload.before && e.payload.head)
    .map((e) => ({
      id: e.id,
      createdAt: e.created_at,
      before: e.payload.before as string,
      head: e.payload.head as string,
      repo: e.repo.name,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Anzahl der Commits eines Pushes. Das PushEvent liefert nur before/head, die Zahl kommt
 * aus dem Vergleich. Bei neuem Branch oder Fehlern (z. B. Force-Push) zaehlt der Push als 1 Commit.
 */
export async function countCommits(push: Push, token?: string): Promise<number> {
  if (push.before === NULL_SHA) return 1;
  try {
    const res = await fetch(`${API}/repos/${push.repo}/compare/${push.before}...${push.head}?per_page=1`, {
      headers: headers(token),
    });
    if (!res.ok) return 1;
    const data: { total_commits?: number } = await res.json();
    return Math.max(1, data.total_commits ?? 1);
  } catch {
    return 1;
  }
}
