import { emit } from "@tauri-apps/api/event";
import { Accessory } from "./accessories";
import { Role, roleInfo } from "./roles";
import { Species } from "./species";
import { getStore, saveValue } from "./store";
import { entriesKey, focusKey, GithubTracker, quotesKey, Tracker } from "./trackers";

export type { Role } from "./roles";
export type { Species } from "./species";
export type { GithubTracker, Tracker } from "./trackers";

/**
 * Ein Modus eines Tiers: Rolle mit Accessoire und Futterquellen. Das Tier wechselt per Klick zwischen seinen Modi
 * (Informatiker, Finanzen, Lernen ...). Die Daten eines Modus (Eintraege, Kurse, Fokus-Sitzungen) liegen unter seiner Id.
 */
export interface Mode {
  /**
   * Schluessel der Daten dieses Modus. Der erste Modus eines Tiers traegt die Id des Tiers (so bleiben die Daten
   * aelterer Versionen erhalten), weitere Modi bekommen eine eigene Id.
   */
  id: string;
  role: Role;
  /** Eigener Name des Modus, sonst der Name der Rolle. */
  label?: string;
  /** Nur bei der Rolle "custom": frei gewaehltes Accessoire. */
  accessory?: Accessory;
  trackers: Tracker[];
}

/** Ein Tier (frueher "Agent"): hat ein Fenster, Hunger, Schlaf und mindestens einen Modus. */
export interface Agent {
  /** Nur Buchstaben, Ziffern, - und _ (wird Teil des Fensternamens). */
  id: string;
  name: string;
  species: Species;
  modes: Mode[];
  /** false = deaktiviert: kein Fenster, Hunger steht still; bleibt im Menue zum Wiedereinschalten. */
  visible: boolean;
}

/** Accessoire eines Modus: das der Rolle, bei "Eigene" das gewaehlte. */
export const modeAccessory = (mode: Mode): Accessory =>
  mode.role === "custom" ? mode.accessory ?? "none" : roleInfo(mode.role).accessory;

export const modeLabel = (mode: Mode) => mode.label?.trim() || roleInfo(mode.role).label;

/** Der Modus, in dem das Tier gerade arbeitet (id aus dem Tierzustand); faellt auf den ersten zurueck. */
export const activeModeOf = (agent: Agent, modeId: string | undefined): Mode =>
  agent.modes.find((m) => m.id === modeId) ?? agent.modes[0];

const randomSuffix = () => Math.random().toString(36).slice(2, 6);

/** Neuer Modus mit den Vorgaben seiner Rolle. Ohne ownerId (erster Modus) traegt er die Id des Tiers. */
export function createMode(agentId: string, role: Role, first = false): Mode {
  return {
    id: first ? agentId : `${agentId}~${Date.now().toString(36)}${randomSuffix()}`,
    role,
    trackers: roleInfo(role).trackers(),
  };
}

/** Neues Tier mit einem Modus der gegebenen Rolle. */
export function createAgent(name: string, species: Species, role: Role): Agent {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
  const id = `${slug}-${Date.now().toString(36)}`;
  return { id, name, species, visible: true, modes: [createMode(id, role, true)] };
}

/** Position in physischen Bildschirmpixeln (obere linke Ecke eines Fensters). */
export interface Point {
  x: number;
  y: number;
}

export interface AgentState {
  /** 1 = satt, 0 = leer */
  hunger: number;
  /** Aktiver Modus (Mode.id); fehlt = erster Modus. */
  mode?: string;
  /** Nest (obere linke Ecke des Nestfensters); fehlt, bis der Agent zum ersten Mal schlafen geht. */
  nest?: Point;
  /** Fensterposition des Tiers vor dem Schlafengehen, dorthin laeuft es beim Aufwecken zurueck. */
  home?: Point;
  /** Schlaeft (auf dem Weg zum Nest oder im Nest). */
  sleeping?: boolean;
  /** Futter, das waehrend des Schlafs eintraf, wird beim Aufwecken gutgeschrieben (Anteil am Hunger). */
  pendingFood?: number;
}

export const AGENTS_CHANGED = "agents-changed";

const stateKey = (id: string) => `agentState:${id}`;
export const trackerKey = (agentId: string, type: Tracker["type"]) => `tracker:${agentId}:${type}`;

/** Gespeicherte Form vor den Modi: ein Agent mit Rolle und Trackern direkt am Tier. */
interface LegacyAgent {
  id: string;
  name: string;
  species: Species;
  role?: Role;
  accessory?: Accessory;
  trackers?: Tracker[];
  visible?: boolean;
  modes?: Mode[];
}

/** Bringt gespeicherte Agenten in die aktuelle Form (Altdaten werden zu einem Tier mit einem Modus). */
export function normalizeAgents(raw: LegacyAgent[]): Agent[] {
  return raw.map((a) => {
    const modes: Mode[] =
      a.modes && a.modes.length > 0
        ? a.modes
        : [{ id: a.id, role: a.role ?? "custom", accessory: a.accessory, trackers: a.trackers ?? [] }];
    return { id: a.id, name: a.name, species: a.species, visible: a.visible ?? true, modes };
  });
}

export async function readAgents(): Promise<Agent[]> {
  const store = await getStore();
  return normalizeAgents((await store.get<LegacyAgent[]>("agents")) ?? []);
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

/** Schluessel der Tier-Daten (Aufgaben, Hinweise, Chat), die mit dem Tier geloescht werden. */
export const animalKeys = (agentId: string) => [`todos:${agentId}`, `alerts:${agentId}`, `chat:${agentId}`];

/** Loescht den gespeicherten Zustand eines Tiers und seiner Modi (nach dem Loeschen; nur der Hub ruft das auf). */
export async function deleteAgentData(agent: Agent) {
  const store = await getStore();
  await store.delete(stateKey(agent.id));
  for (const key of animalKeys(agent.id)) await store.delete(key);
  for (const mode of agent.modes) await deleteModeData(mode.id);
  await store.save();
}

/** Loescht die Daten eines einzelnen Modus (Eintraege, Kurse, Fokus, GitHub-Zustand). */
export async function deleteModeData(modeId: string) {
  const store = await getStore();
  await store.delete(trackerKey(modeId, "github"));
  await store.delete(entriesKey(modeId));
  await store.delete(focusKey(modeId));
  await store.delete(quotesKey(modeId));
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
 * Liefert die Tiere. Fehlen sie (erster Start), wird der bisherige Mull als Tier "Informatiker" angelegt:
 * Hunger und GitHub-Zustand werden uebernommen, die alten Schluessel bleiben unveraendert stehen.
 * Aeltere Speicherstaende ohne Modi werden beim Lesen umgewandelt und mit dem naechsten Speichern abgelegt.
 */
export function ensureAgents(): Promise<Agent[]> {
  ensured ??= migrate();
  return ensured;
}

async function migrate(): Promise<Agent[]> {
  const store = await getStore();
  const existing = await store.get<LegacyAgent[]>("agents");
  if (existing) return normalizeAgents(existing);

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
    visible: true,
    modes: [{ id: "informatiker", role: "dev", trackers: [github] }],
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
