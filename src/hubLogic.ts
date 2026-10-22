import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Agent,
  AGENTS_CHANGED,
  ensureAgents,
  GithubTracker,
  loadAgentState,
  readAgents,
  saveAgentState,
} from "./agents";
import { pollGithub } from "./githubTracker";
import {
  AgentCommand,
  agentLabel,
  AgentFedPayload,
  AgentStatePayload,
  EVENT_AGENT_CMD,
  EVENT_AGENT_FED,
  EVENT_AGENT_STATE,
} from "./protocol";
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_CHANGED } from "./settings";

const TICK_MS = 30_000;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

const githubOf = (agent: Agent) => agent.trackers.find((t): t is GithubTracker => t.type === "github");

/**
 * Die zentrale Logik: Hunger, Tracker und die Agent-Fenster. Die Fenster zeigen nur an und melden
 * Eingaben. Nur der Hub schreibt Agentenzustand, damit sich Fenster nicht in die Quere kommen.
 * Gibt eine Funktion zum Beenden zurueck.
 */
export function startHub(): () => void {
  let alive = true;
  let paused = false;
  let hungerHours = DEFAULT_SETTINGS.hungerHours;
  let agents: Agent[] = [];
  const hunger = new Map<string, number>();
  const pollTimers = new Map<string, number>();
  const polling = new Set<string>();
  const unlisteners: UnlistenFn[] = [];
  let lastTick = Date.now();

  const find = (id: string) => agents.find((a) => a.id === id);

  const sendState = (agent: Agent) => {
    const payload: AgentStatePayload = { id: agent.id, name: agent.name, hunger: hunger.get(agent.id) ?? 1 };
    emitTo(agentLabel(agent.id), EVENT_AGENT_STATE, payload).catch(() => {});
  };

  const setHunger = (id: string, value: number) => {
    hunger.set(id, clamp(value));
    saveAgentState(id, { hunger: hunger.get(id) ?? 1 }).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
    const agent = find(id);
    if (agent) sendState(agent);
  };

  const feed = (id: string, amount: number, text: string | null) => {
    setHunger(id, (hunger.get(id) ?? 1) + amount);
    const payload: AgentFedPayload = { text };
    emitTo(agentLabel(id), EVENT_AGENT_FED, payload).catch(() => {});
  };

  const poll = async (id: string) => {
    const agent = find(id);
    const tracker = agent && githubOf(agent);
    if (!agent || !tracker || polling.has(id)) return;
    polling.add(id);
    try {
      const { fresh, today } = await pollGithub(id, tracker);
      if (alive && fresh > 0) {
        feed(id, (fresh * tracker.foodPercent) / 100, `${today} ${today === 1 ? "Commit" : "Commits"} heute!`);
      }
    } catch (e) {
      console.warn("GitHub-Abfrage fehlgeschlagen:", e);
    } finally {
      polling.delete(id);
    }
  };

  const restartPolling = () => {
    pollTimers.forEach((t) => window.clearInterval(t));
    pollTimers.clear();
    for (const agent of agents) {
      const tracker = githubOf(agent);
      if (!tracker) continue;
      poll(agent.id);
      pollTimers.set(agent.id, window.setInterval(() => poll(agent.id), tracker.pollMinutes * 60 * 1000));
    }
  };

  const applyAgents = async (list: Agent[]) => {
    const removed = agents.filter((old) => !list.some((a) => a.id === old.id));
    agents = list;
    for (const agent of list) {
      if (!hunger.has(agent.id)) hunger.set(agent.id, (await loadAgentState(agent.id)).hunger);
    }
    if (!alive) return;
    for (const agent of removed) invoke("close_agent_window", { id: agent.id }).catch(() => {});
    for (const agent of list) {
      if (agent.visible) {
        invoke("open_agent_window", { id: agent.id }).catch((e) => console.warn("Fenster fehlgeschlagen:", e));
        sendState(agent);
      } else {
        invoke("close_agent_window", { id: agent.id }).catch(() => {});
      }
    }
    restartPolling();
  };

  const onCommand = (cmd: AgentCommand) => {
    const agent = find(cmd.id);
    if (!agent) return;
    switch (cmd.type) {
      case "ready":
        sendState(agent);
        break;
      case "dev-feed":
        feed(agent.id, (githubOf(agent)?.foodPercent ?? 25) / 100, null);
        break;
      case "dev-hunger":
        setHunger(agent.id, (hunger.get(agent.id) ?? 1) + cmd.delta);
        break;
      case "poll-now":
        poll(agent.id);
        break;
    }
  };

  const subscribe = <T>(event: string, handler: (payload: T) => void) => {
    listen<T>(event, (e) => handler(e.payload)).then((un) => (alive ? unlisteners.push(un) : un()));
  };

  subscribe<boolean>("pause-changed", (value) => (paused = value));
  subscribe<AgentCommand>(EVENT_AGENT_CMD, onCommand);
  subscribe<null>(SETTINGS_CHANGED, () => {
    loadSettings().then((s) => (hungerHours = s.hungerHours));
  });
  subscribe<null>(AGENTS_CHANGED, () => {
    readAgents().then((list) => {
      if (alive) applyAgents(list);
    });
  });

  // Hunger sinkt nur, solange nicht pausiert ist.
  const tickTimer = window.setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (paused) return;
    for (const agent of agents) {
      setHunger(agent.id, (hunger.get(agent.id) ?? 1) - elapsed / (hungerHours * 60 * 60 * 1000));
    }
  }, TICK_MS);

  (async () => {
    paused = await invoke<boolean>("get_paused");
    hungerHours = (await loadSettings()).hungerHours;
    const list = await ensureAgents();
    if (alive) await applyAgents(list);
  })().catch((e) => console.error("Hub-Start fehlgeschlagen:", e));

  return () => {
    alive = false;
    window.clearInterval(tickTimer);
    pollTimers.forEach((t) => window.clearInterval(t));
    unlisteners.forEach((un) => un());
  };
}
