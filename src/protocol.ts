/** Nachrichten zwischen Hub und Agent-Fenstern (Tauri-Events). */

/** Hub an Agent: aktueller Zustand. */
export const EVENT_AGENT_STATE = "agent-state";
/** Hub an Agent: Futter ist eingetroffen (Fressen abspielen, optional Sprechblase). */
export const EVENT_AGENT_FED = "agent-fed";
/** Agent an Hub: Befehle. */
export const EVENT_AGENT_CMD = "agent-cmd";

export const HUB_LABEL = "hub";

export const agentLabel = (id: string) => `agent-${id}`;

export interface AgentStatePayload {
  id: string;
  name: string;
  /** 1 = satt, 0 = leer */
  hunger: number;
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
  | { id: string; type: "poll-now" };
