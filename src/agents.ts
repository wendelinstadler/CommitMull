import { emit } from "@tauri-apps/api/event";
import { Accessory } from "./accessories";
import { Role, roleInfo } from "./roles";
import { Species } from "./species";
import { getStore, saveValue } from "./store";

export type { Role } from "./roles";
export type { Species } from "./species";

export interface GithubTracker {
  type: "github";
  user: string;
  /** Optional; mit Token zaehlen auch private Repos und das Abfrage-Limit steigt. */
  token: string;
  pollMinutes: number;
  /** Futter pro Commit in Prozent. */
  foodPercent: number;
}

/** Futterquelle eines Agenten; weitere Typen kommen mit dem Tracker-System dazu. */
export type Tracker = GithubTracker;

export interface Agent {
  /** Nur Buchstaben, Ziffern, - und _ (wird Teil des Fensternamens). */
  id: string;
  name: string;
  species: Species;
  role: Role;
  /** Nur bei der Rolle "custom": frei gewaehltes Accessoire. */
  accessory?: Accessory;
  trackers: Tracker[];
  /** false = deaktiviert: kein Fenster, Hunger steht still; bleibt im Menue zum Wiedereinschalten. */
  visible: boolean;
}

/** Accessoire, das ein Agent traegt: das der Rolle, bei "Eigene" das gewaehlte. */
export const accessoryOf = (agent: Agent): Accessory =>
  agent.role === "custom" ? agent.accessory ?? "none" : roleInfo(agent.role).accessory;

/** Neuer Agent mit den Vorgaben seiner Rolle. */
export function createAgent(name: string, species: Species, role: Role): Agent {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
  const github: GithubTracker = { type: "github", user: "", token: "", pollMinutes: 10, foodPercent: 25 };
  return {
    id: `${slug}-${Date.now().toString(36)}`,
    name,
    species,
    role,
    trackers: roleInfo(role).github ? [github] : [],
    visible: true,
  };
}

export interface AgentState {
  /** 1 = satt, 0 = leer */
  hunger: number;
}

export const AGENTS_CHANGED = "agents-changed";

const stateKey = (id: string) => `agentState:${id}`;
export const trackerKey = (agentId: string, type: Tracker["type"]) => `tracker:${agentId}:${type}`;

export async function readAgents(): Promise<Agent[]> {
  const store = await getStore();
  return (await store.get<Agent[]>("agents")) ?? [];
}

/** Speichert die Agentenliste und meldet allen Fenstern die Aenderung. */
export async function saveAgents(agents: Agent[]) {
  await saveValue("agents", agents);
  await emit(AGENTS_CHANGED);
}

export async function loadAgentState(id: string): Promise<AgentState> {
  const store = await getStore();
  return (await store.get<AgentState>(stateKey(id))) ?? { hunger: 1 };
}

export async function saveAgentState(id: string, state: AgentState) {
  await saveValue(stateKey(id), state);
}

/** Loescht den gespeicherten Zustand eines Agenten (nach dem Loeschen des Agenten; nur der Hub ruft das auf). */
export async function deleteAgentData(id: string) {
  const store = await getStore();
  await store.delete(stateKey(id));
  await store.delete(trackerKey(id, "github"));
  await store.save();
}

interface LegacySettings {
  githubUser?: string;
  githubToken?: string;
  pollMinutes?: number;
  foodPercent?: number;
}

let ensured: Promise<Agent[]> | undefined;

/**
 * Liefert die Agenten. Fehlen sie (erster Start nach dem Umbau), wird der bisherige Mull als
 * Agent "Informatiker" angelegt: Hunger und GitHub-Zustand werden uebernommen, die alten
 * Schluessel bleiben unveraendert stehen.
 */
export function ensureAgents(): Promise<Agent[]> {
  ensured ??= migrate();
  return ensured;
}

async function migrate(): Promise<Agent[]> {
  const store = await getStore();
  const existing = await store.get<Agent[]>("agents");
  if (existing) return existing;

  const legacy = (await store.get<LegacySettings>("settings")) ?? {};
  const github: GithubTracker = {
    type: "github",
    user: legacy.githubUser ?? "wendelinstadler",
    token: legacy.githubToken ?? "",
    pollMinutes: legacy.pollMinutes ?? 10,
    foodPercent: legacy.foodPercent ?? 25,
  };
  const agent: Agent = {
    id: "informatiker",
    name: "Informatiker",
    species: "naked-mole-rat",
    role: "dev",
    visible: true,
    trackers: [github],
  };

  const hunger = await store.get<number>("hunger");
  await store.set(stateKey(agent.id), { hunger: typeof hunger === "number" ? hunger : 1 });

  const seen = await store.get<string[]>("seenEvents");
  if (seen) {
    await store.set(trackerKey(agent.id, "github"), {
      user: (await store.get<string>("seenUser")) ?? github.user,
      seen,
      counts: (await store.get("commitCounts")) ?? {},
    });
  }

  await store.set("agents", [agent]);
  await store.save();
  return [agent];
}
