import { Accessory } from "./accessories";
import { Point } from "./agents";
import { Species } from "./species";
import { TrackerViews } from "./trackers";

/** Nachrichten zwischen Hub und Agent-Fenstern (Tauri-Events). */

/** Tray-Menue an Hub: Agent ein- oder ausschalten (Nutzlast: Agent-Id). */
export const EVENT_AGENT_TOGGLE = "agent-toggle";
/** Hub an Agent: bitte Position melden und schlafen gehen (Antwort: Befehl "sleep"). */
export const EVENT_AGENT_SLEEP_REQUEST = "agent-sleep-request";
/** Rust (Tray, Hotkey) an Hub: alle Agenten schlafen schicken oder aufwecken. */
export const EVENT_SLEEP_ALL = "sleep-all";
/** Agent an Geisterfenster: so soll die Zielvorschau aussehen. */
export const EVENT_GHOST_LOOK = "ghost-look";

/** Hub an Agent: aktueller Zustand. */
export const EVENT_AGENT_STATE = "agent-state";
/** Hub an Agent: Futter ist eingetroffen (Fressen abspielen, optional Sprechblase). */
export const EVENT_AGENT_FED = "agent-fed";
/** Agent an Hub: Befehle. */
export const EVENT_AGENT_CMD = "agent-cmd";

export const HUB_LABEL = "hub";

export const agentLabel = (id: string) => `agent-${id}`;

/**
 * Schlafphasen eines Agenten:
 * awake = wach, to-nest = laeuft zum Nest, asleep = liegt im Nest, back = laeuft nach dem Aufwecken zurueck.
 */
export type SleepPhase = "awake" | "to-nest" | "asleep" | "back";

export interface AgentStatePayload {
  id: string;
  name: string;
  species: Species;
  accessory: Accessory;
  /** Anzeigename der Rolle, z. B. "Finanzen". */
  roleLabel: string;
  /** 1 = satt, 0 = leer */
  hunger: number;
  /** Anzeige der Tracker im Panel (Wochenbudget, Fokuszeit ...). */
  views: TrackerViews;
  sleep: SleepPhase;
  /** Gespeichertes Nest, oder null (dann gilt der Standard unten am Bildschirmrand). */
  nest: Point | null;
  /** Platz vor dem Schlafengehen (Ziel beim Aufwecken). */
  home: Point | null;
}

export interface AgentFedPayload {
  text: string | null;
}

export type AgentCommand =
  /** Fenster ist geladen und braucht den Zustand. */
  | { id: string; type: "ready" }
  /** Dev: Futter geben (Menge des ersten Trackers). */
  | { id: string; type: "dev-feed" }
  /** Dev: Hunger um delta aendern (negativ = hungriger). */
  | { id: string; type: "dev-hunger"; delta: number }
  /** Dev: Tracker sofort abfragen. */
  | { id: string; type: "poll-now" }
  /** Manueller Eintrag (Ausgabe mit Betrag, oder Haken mit amount 1). */
  | { id: string; type: "entry"; amount: number; note: string }
  /** Letzten Eintrag zuruecknehmen (das Futter bleibt). */
  | { id: string; type: "entry-undo" }
  /** Fokus-Timer starten oder beenden. */
  | { id: string; type: "focus-toggle" }
  /** Schlafen schicken; das Fenster meldet seine Position (home) und das Nest (gespeichertes oder Standard). */
  | { id: string; type: "sleep"; home: Point; nest: Point }
  /** Aufwecken. */
  | { id: string; type: "wake" }
  /** Fenster ist am Ziel angekommen (Nest bzw. Platz vor dem Schlafen). */
  | { id: string; type: "arrived" }
  /** Nest verschieben: Nestfenster zum Ziehen einblenden (nest = Standardposition, falls noch keines gespeichert ist). */
  | { id: string; type: "nest-edit"; nest: Point }
  /** Nest an neuer Position speichern (kommt aus dem Nestfenster). */
  | { id: string; type: "nest-set"; nest: Point };
