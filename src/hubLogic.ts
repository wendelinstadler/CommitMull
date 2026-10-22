import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  accessoryOf,
  Agent,
  AGENTS_CHANGED,
  deleteAgentData,
  ensureAgents,
  loadAgentState,
  readAgents,
  saveAgents,
  saveAgentState,
} from "./agents";
import { roleInfo } from "./roles";
import {
  AgentCommand,
  agentLabel,
  AgentFedPayload,
  AgentStatePayload,
  EVENT_AGENT_CMD,
  EVENT_AGENT_FED,
  EVENT_AGENT_STATE,
  EVENT_AGENT_TOGGLE,
} from "./protocol";
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_CHANGED } from "./settings";
import { getStore, saveValue } from "./store";
import { githubPlugin } from "./trackerPlugins";
import {
  Entry,
  entriesKey,
  entriesView,
  focusKey,
  FocusSession,
  focusView,
  formatAmount,
  MAX_LOG,
  startOfDay,
  trackerOf,
  TrackerViews,
} from "./trackers";

const TICK_MS = 30_000;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

const githubOf = (agent: Agent) => trackerOf(agent.trackers, "github");

/** Futter pro Ereignis des ersten Trackers (fuer die Dev-Taste F), sonst 25 %. */
const defaultFood = (agent: Agent) => (agent.trackers[0]?.foodPercent ?? 25) / 100;

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
  const pollTimers = new Map<string, { timer: number; config: string }>();
  const polling = new Set<string>();
  /** Manuelle Eintraege und Fokus-Sitzungen je Agent (der Hub ist der einzige Schreiber). */
  const entryLogs = new Map<string, Entry[]>();
  const focusLogs = new Map<string, FocusSession[]>();
  /** Laufende Fokus-Timer: Startzeit und wie viele volle Zeitspannen schon Futter gaben. */
  const focusRuns = new Map<string, { startedAt: number; credited: number }>();
  const unlisteners: UnlistenFn[] = [];
  let lastTick = Date.now();

  const find = (id: string) => agents.find((a) => a.id === id);

  const buildViews = (agent: Agent): TrackerViews => {
    const now = Date.now();
    const views: TrackerViews = {};
    const entries = trackerOf(agent.trackers, "entries");
    if (entries) views.entries = entriesView(entries, entryLogs.get(agent.id) ?? [], now);
    const focus = trackerOf(agent.trackers, "focus");
    if (focus) views.focus = focusView(focus, focusLogs.get(agent.id) ?? [], focusRuns.get(agent.id), now);
    return views;
  };

  const sendState = (agent: Agent) => {
    const payload: AgentStatePayload = {
      id: agent.id,
      name: agent.name,
      species: agent.species,
      accessory: accessoryOf(agent),
      roleLabel: roleInfo(agent.role).label,
      hunger: hunger.get(agent.id) ?? 1,
      views: buildViews(agent),
    };
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
    if (!agent || !tracker || !githubPlugin.ready(tracker) || polling.has(id)) return;
    polling.add(id);
    try {
      const event = await githubPlugin.poll(id, tracker);
      if (alive && event) feed(id, event.amount, event.text);
    } catch (e) {
      console.warn("GitHub-Abfrage fehlgeschlagen:", e);
    } finally {
      polling.delete(id);
    }
  };

  /** Startet Abfragen nur neu, wenn sich die Tracker-Angaben eines Agenten geaendert haben (spart Anfragen). */
  const syncPolling = () => {
    for (const [id, entry] of [...pollTimers]) {
      const tracker = find(id) && githubOf(find(id)!);
      if (!tracker || JSON.stringify(tracker) !== entry.config) {
        window.clearInterval(entry.timer);
        pollTimers.delete(id);
      }
    }
    for (const agent of agents) {
      const tracker = githubOf(agent);
      if (!tracker || pollTimers.has(agent.id)) continue;
      poll(agent.id);
      pollTimers.set(agent.id, {
        timer: window.setInterval(() => poll(agent.id), githubPlugin.intervalMs(tracker)),
        config: JSON.stringify(tracker),
      });
    }
  };

  /** Tray-Menue: alle Agenten mit Haken, auch die deaktivierten. */
  const syncMenu = (attempt = 0) => {
    const entries = agents.map((a) => ({ id: a.id, name: a.name, visible: a.visible }));
    invoke("set_agent_menu", { agents: entries }).catch((e) => {
      // Beim Start ist das Menue eventuell noch nicht gebaut.
      if (attempt < 5 && alive) window.setTimeout(() => syncMenu(attempt + 1), 1000);
      else console.warn("Menue fehlgeschlagen:", e);
    });
  };

  /** Beendet einen laufenden Fokus-Timer und speichert die Sitzung, wenn mindestens eine Minute zusammenkam. */
  const stopFocus = (id: string) => {
    const run = focusRuns.get(id);
    if (!run) return;
    focusRuns.delete(id);
    const minutes = Math.floor((Date.now() - run.startedAt) / 60_000);
    if (minutes < 1) return;
    const sessions = [...(focusLogs.get(id) ?? []), { ts: run.startedAt, minutes }].slice(-MAX_LOG);
    focusLogs.set(id, sessions);
    saveValue(focusKey(id), sessions).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
  };

  const addEntry = (agent: Agent, amount: number, note: string) => {
    const tracker = trackerOf(agent.trackers, "entries");
    if (!tracker) return;
    const value = tracker.kind === "check" ? 1 : amount;
    if (!Number.isFinite(value) || value <= 0 || value > 1e9) return;
    const entry: Entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      amount: value,
      note: String(note ?? "").trim().slice(0, 60),
    };
    const list = [...(entryLogs.get(agent.id) ?? []), entry].slice(-MAX_LOG);
    entryLogs.set(agent.id, list);
    saveValue(entriesKey(agent.id), list).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
    const today = list.filter((e) => e.ts >= startOfDay(entry.ts)).length;
    feed(
      agent.id,
      tracker.foodPercent / 100,
      tracker.kind === "expense" ? `${formatAmount(value)} ${tracker.currency} eingetragen` : `${tracker.label}: heute ${today}x`,
    );
  };

  const applyAgents = async (list: Agent[]) => {
    const removed = agents.filter((old) => !list.some((a) => a.id === old.id));
    agents = list;
    for (const agent of list) {
      if (!hunger.has(agent.id)) hunger.set(agent.id, (await loadAgentState(agent.id)).hunger);
      if (!entryLogs.has(agent.id)) {
        const store = await getStore();
        entryLogs.set(agent.id, (await store.get<Entry[]>(entriesKey(agent.id))) ?? []);
        focusLogs.set(agent.id, (await store.get<FocusSession[]>(focusKey(agent.id))) ?? []);
      }
    }
    if (!alive) return;
    for (const agent of removed) {
      invoke("close_agent_window", { id: agent.id }).catch(() => {});
      hunger.delete(agent.id);
      entryLogs.delete(agent.id);
      focusLogs.delete(agent.id);
      focusRuns.delete(agent.id);
      deleteAgentData(agent.id).catch((e) => console.warn("Aufraeumen fehlgeschlagen:", e));
    }
    for (const agent of list) {
      if (agent.visible) {
        invoke("open_agent_window", { id: agent.id }).catch((e) => console.warn("Fenster fehlgeschlagen:", e));
        sendState(agent);
      } else {
        invoke("close_agent_window", { id: agent.id }).catch(() => {});
        stopFocus(agent.id);
      }
    }
    syncPolling();
    syncMenu();
  };

  const onCommand = (cmd: AgentCommand) => {
    const agent = find(cmd.id);
    if (!agent) return;
    switch (cmd.type) {
      case "ready":
        sendState(agent);
        break;
      case "dev-feed":
        feed(agent.id, defaultFood(agent), null);
        break;
      case "dev-hunger":
        setHunger(agent.id, (hunger.get(agent.id) ?? 1) + cmd.delta);
        break;
      case "poll-now":
        poll(agent.id);
        break;
      case "entry":
        addEntry(agent, cmd.amount, cmd.note);
        break;
      case "entry-undo": {
        const list = (entryLogs.get(agent.id) ?? []).slice(0, -1);
        entryLogs.set(agent.id, list);
        saveValue(entriesKey(agent.id), list).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
        sendState(agent);
        break;
      }
      case "focus-toggle":
        if (focusRuns.has(agent.id)) stopFocus(agent.id);
        else if (trackerOf(agent.trackers, "focus")) focusRuns.set(agent.id, { startedAt: Date.now(), credited: 0 });
        sendState(agent);
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
  subscribe<string>(EVENT_AGENT_TOGGLE, (id) => {
    const agent = find(id);
    if (agent) saveAgents(agents.map((a) => (a.id === id ? { ...a, visible: !a.visible } : a)));
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

    // Fokus-Timer: pro volle Zeitspanne Futter (auch waehrend der Pause, sonst geht Fokuszeit verloren).
    for (const agent of agents) {
      const run = focusRuns.get(agent.id);
      const tracker = trackerOf(agent.trackers, "focus");
      if (!run || !tracker) continue;
      const blocks = Math.floor((now - run.startedAt) / (tracker.blockMinutes * 60_000));
      if (blocks > run.credited) {
        feed(agent.id, ((blocks - run.credited) * tracker.foodPercent) / 100, `${blocks * tracker.blockMinutes} Min Fokus!`);
        run.credited = blocks;
      } else {
        sendState(agent);
      }
    }

    if (paused) return;
    for (const agent of agents) {
      // Deaktivierte Agenten bleiben satt, bis sie wieder eingeschaltet werden.
      if (!agent.visible) continue;
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
    pollTimers.forEach((entry) => window.clearInterval(entry.timer));
    unlisteners.forEach((un) => un());
  };
}
