import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  accessoryOf,
  Agent,
  AgentState,
  Point,
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
  EVENT_AGENT_SAY,
  EVENT_AGENT_SLEEP_REQUEST,
  EVENT_AGENT_STATE,
  EVENT_AGENT_TOGGLE,
  EVENT_SLEEP_ALL,
  SleepPhase,
} from "./protocol";
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_CHANGED } from "./settings";
import { getStore, saveValue } from "./store";
import { fetchSnapshot, investView, Snapshot } from "./investTracker";
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
  prettyApp,
  quotesKey,
  startOfDay,
  trackerOf,
  TrackerViews,
} from "./trackers";

const TICK_MS = 30_000;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Prueft eine vom Fenster gemeldete Position (nur endliche, vernuenftig grosse Zahlen). */
const validPoint = (p: unknown): Point | null => {
  const q = p as Point | null | undefined;
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100_000;
  return q && ok(q.x) && ok(q.y) ? { x: Math.round(q.x), y: Math.round(q.y) } : null;
};

const githubOf = (agent: Agent) => trackerOf(agent.trackers, "github");

/** Futter pro Ereignis des ersten fuetternden Trackers (fuer die Dev-Taste F), sonst 25 %. Investments fuettern nicht. */
const defaultFood = (agent: Agent) => {
  const feeder = agent.trackers.find((t) => t.type !== "invest");
  return (feeder ? feeder.foodPercent : 25) / 100;
};

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
  /** Schlafdaten je Agent (Nest, Platz, Futter im Wartestand); der Rest von AgentState neben dem Hunger. */
  const extra = new Map<string, Omit<AgentState, "hunger">>();
  const phase = new Map<string, SleepPhase>();
  const phaseOf = (id: string): SleepPhase => phase.get(id) ?? "awake";
  /** Schlaeft: auf dem Weg ins Nest oder im Nest. Dann steht der Hunger still und Futter wartet. */
  const isAsleep = (id: string) => phaseOf(id) === "to-nest" || phaseOf(id) === "asleep";
  const pollTimers = new Map<string, { timer: number; config: string }>();
  const polling = new Set<string>();
  /** Manuelle Eintraege und Fokus-Sitzungen je Agent (der Hub ist der einzige Schreiber). */
  const entryLogs = new Map<string, Entry[]>();
  const focusLogs = new Map<string, FocusSession[]>();
  /** Laufende Fokus-Timer: Startzeit und wie viele volle Zeitspannen schon Futter gaben. */
  const focusRuns = new Map<string, { startedAt: number; credited: number }>();
  /** Gesperrte Programme, die gerade offen sind: seit wann, und ob schon versucht wurde, sie zu schliessen. */
  const blockWatch = new Map<string, { since: number; attempted: boolean }>();
  /** In der laufenden Fokus-Sitzung geschlossene Programme je Agent. */
  const focusClosed = new Map<string, number>();
  let blockTimer: number | undefined;
  let blockChecking = false;
  /** Zuletzt geladene Kurse der Depots, Aktualisierungs-Timer und laufende Abfragen. */
  const investSnaps = new Map<string, Snapshot>();
  const investTimers = new Map<string, { timer: number; config: string }>();
  const investLoading = new Set<string>();
  const unlisteners: UnlistenFn[] = [];
  let lastTick = Date.now();

  const find = (id: string) => agents.find((a) => a.id === id);

  const buildViews = (agent: Agent): TrackerViews => {
    const now = Date.now();
    const views: TrackerViews = {};
    const entries = trackerOf(agent.trackers, "entries");
    if (entries) views.entries = entriesView(entries, entryLogs.get(agent.id) ?? [], now);
    const focus = trackerOf(agent.trackers, "focus");
    if (focus) {
      views.focus = focusView(focus, focusLogs.get(agent.id) ?? [], focusRuns.get(agent.id), now, focusClosed.get(agent.id) ?? 0);
    }
    const invest = trackerOf(agent.trackers, "invest");
    if (invest) views.invest = investView(invest, investSnaps.get(agent.id), investLoading.has(agent.id));
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
      sleep: phaseOf(agent.id),
      nest: extra.get(agent.id)?.nest ?? null,
      home: extra.get(agent.id)?.home ?? null,
    };
    emitTo(agentLabel(agent.id), EVENT_AGENT_STATE, payload).catch(() => {});
  };

  const persist = (id: string) =>
    saveAgentState(id, { hunger: hunger.get(id) ?? 1, ...extra.get(id) }).catch((e) =>
      console.warn("Speichern fehlgeschlagen:", e),
    );

  const setHunger = (id: string, value: number) => {
    hunger.set(id, clamp(value));
    persist(id);
    const agent = find(id);
    if (agent) sendState(agent);
  };

  const feed = (id: string, amount: number, text: string | null) => {
    if (isAsleep(id)) {
      // Futter geht nicht verloren: es wartet und wird beim Aufwecken gutgeschrieben.
      const data = extra.get(id) ?? {};
      extra.set(id, { ...data, pendingFood: (data.pendingFood ?? 0) + amount });
      persist(id);
      const agent = find(id);
      if (agent) sendState(agent);
      return;
    }
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
  const say = (id: string, text: string) => {
    emitTo(agentLabel(id), EVENT_AGENT_SAY, { text }).catch(() => {});
  };

  /**
   * Programm-Sperre: Solange ein Fokus-Timer mit Sperrliste laeuft, wird alle paar Sekunden geprueft, ob ein gesperrtes
   * Programm ein sichtbares Fenster hat. Dann warnt das Tier, nach der Frist werden die Fenster sanft geschlossen
   * (wie ein Klick auf X, Programme fragen bei ungespeicherter Arbeit nach) und es wird weiter geprueft.
   * Die Programmnamen stammen nur aus der selbst gespeicherten Sperrliste des Benutzers.
   */
  const checkBlocked = async () => {
    if (blockChecking) return;
    blockChecking = true;
    try {
      let watching = false;
      for (const agent of agents) {
        const tracker = trackerOf(agent.trackers, "focus");
        const list = tracker?.blocked ?? [];
        if (!tracker || !focusRuns.has(agent.id) || list.length === 0) continue;
        watching = true;
        let open: string[] = [];
        try {
          open = await invoke<string[]>("find_blocked_apps", { exes: list });
        } catch (e) {
          console.warn("Programmsuche fehlgeschlagen:", e);
          continue;
        }
        const graceMs = (tracker.graceSeconds ?? 10) * 1000;
        const now = Date.now();
        for (const exe of list) {
          const key = `${agent.id}|${exe}`;
          const watch = blockWatch.get(key);
          if (!open.includes(exe)) {
            if (watch?.attempted) {
              focusClosed.set(agent.id, (focusClosed.get(agent.id) ?? 0) + 1);
              say(agent.id, `${prettyApp(exe)} ist zu. Weiter so!`);
              sendState(agent);
            }
            blockWatch.delete(key);
          } else if (!watch) {
            blockWatch.set(key, { since: now, attempted: false });
            say(agent.id, `${prettyApp(exe)} ist waehrend des Fokus gesperrt. Ich schliesse es in ${graceMs / 1000} s.`);
          } else if (now - watch.since >= graceMs) {
            await invoke("close_app_windows", { exe }).catch((e) => console.warn("Schliessen fehlgeschlagen:", e));
            blockWatch.set(key, { since: now, attempted: true });
          }
        }
      }
      if (!watching && blockTimer !== undefined) {
        window.clearInterval(blockTimer);
        blockTimer = undefined;
      }
    } finally {
      blockChecking = false;
    }
  };

  const startBlockWatch = () => {
    if (blockTimer === undefined) blockTimer = window.setInterval(checkBlocked, 3000);
    checkBlocked();
  };

  /** Laedt die Kurse eines Depots neu und zeigt sie an. */
  const refreshInvest = async (id: string) => {
    const agent = find(id);
    const tracker = agent && trackerOf(agent.trackers, "invest");
    if (!agent || !tracker || tracker.positions.length === 0 || investLoading.has(id)) return;
    investLoading.add(id);
    sendState(agent);
    try {
      const snap = await fetchSnapshot(tracker, investSnaps.get(id));
      if (!alive) return;
      investSnaps.set(id, snap);
      await saveValue(quotesKey(id), snap);
    } catch (e) {
      console.warn("Kursabfrage fehlgeschlagen:", e);
    } finally {
      investLoading.delete(id);
      const current = find(id);
      if (current) sendState(current);
    }
  };

  /** Kurs-Timer pro Depot: nur neu starten, wenn sich Depot oder Intervall aendern; nur fuer aktive Agenten. */
  const syncInvest = () => {
    for (const [id, entry] of [...investTimers]) {
      const agent = find(id);
      const tracker = agent && trackerOf(agent.trackers, "invest");
      if (!agent?.visible || !tracker || tracker.positions.length === 0 || JSON.stringify(tracker) !== entry.config) {
        window.clearInterval(entry.timer);
        investTimers.delete(id);
      }
    }
    for (const agent of agents) {
      const tracker = trackerOf(agent.trackers, "invest");
      if (!agent.visible || !tracker || tracker.positions.length === 0 || investTimers.has(agent.id)) continue;
      refreshInvest(agent.id);
      investTimers.set(agent.id, {
        timer: window.setInterval(() => refreshInvest(agent.id), Math.max(5, tracker.refreshMinutes) * 60_000),
        config: JSON.stringify(tracker),
      });
    }
  };

  const stopFocus = (id: string) => {
    for (const key of [...blockWatch.keys()]) if (key.startsWith(`${id}|`)) blockWatch.delete(key);
    focusClosed.delete(id);
    const run = focusRuns.get(id);
    if (!run) return;
    focusRuns.delete(id);
    const minutes = Math.floor((Date.now() - run.startedAt) / 60_000);
    if (minutes < 1) return;
    const sessions = [...(focusLogs.get(id) ?? []), { ts: run.startedAt, minutes }].slice(-MAX_LOG);
    focusLogs.set(id, sessions);
    saveValue(focusKey(id), sessions).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
  };

  const openNest = (agent: Agent, edit: boolean) => {
    const nest = extra.get(agent.id)?.nest;
    if (!nest) return;
    invoke("open_nest_window", { id: agent.id, x: nest.x, y: nest.y, edit }).catch((e) =>
      console.warn("Nest fehlgeschlagen:", e),
    );
  };

  /** Alle sichtbaren Agenten schlafen schicken; schlafen schon alle, werden alle aufgeweckt. */
  const sleepAll = () => {
    const live = agents.filter((a) => a.visible);
    const anyAwake = live.some((a) => phaseOf(a.id) === "awake");
    for (const a of live) {
      if (anyAwake && phaseOf(a.id) === "awake") {
        emitTo(agentLabel(a.id), EVENT_AGENT_SLEEP_REQUEST, null).catch(() => {});
      } else if (!anyAwake && isAsleep(a.id)) {
        onCommand({ id: a.id, type: "wake" });
      }
    }
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
      if (!hunger.has(agent.id)) {
        const { hunger: h, ...rest } = await loadAgentState(agent.id);
        hunger.set(agent.id, h);
        extra.set(agent.id, rest);
        phase.set(agent.id, rest.sleeping && rest.nest ? "asleep" : "awake");
      }
      if (!entryLogs.has(agent.id)) {
        const store = await getStore();
        entryLogs.set(agent.id, (await store.get<Entry[]>(entriesKey(agent.id))) ?? []);
        const snap = await store.get<Snapshot>(quotesKey(agent.id));
        if (snap) investSnaps.set(agent.id, snap);
        focusLogs.set(agent.id, (await store.get<FocusSession[]>(focusKey(agent.id))) ?? []);
      }
    }
    if (!alive) return;
    for (const agent of removed) {
      invoke("close_agent_window", { id: agent.id }).catch(() => {});
      hunger.delete(agent.id);
      extra.delete(agent.id);
      phase.delete(agent.id);
      invoke("close_nest_window", { id: agent.id }).catch(() => {});
      entryLogs.delete(agent.id);
      investSnaps.delete(agent.id);
      focusLogs.delete(agent.id);
      focusRuns.delete(agent.id);
      deleteAgentData(agent.id).catch((e) => console.warn("Aufraeumen fehlgeschlagen:", e));
    }
    for (const agent of list) {
      if (agent.visible) {
        invoke("open_agent_window", { id: agent.id }).catch((e) => console.warn("Fenster fehlgeschlagen:", e));
        if (phaseOf(agent.id) === "asleep") openNest(agent, false);
        sendState(agent);
      } else {
        invoke("close_agent_window", { id: agent.id }).catch(() => {});
        invoke("close_nest_window", { id: agent.id }).catch(() => {});
        stopFocus(agent.id);
      }
    }
    syncPolling();
    syncInvest();
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
      case "sleep": {
        if (phaseOf(agent.id) !== "awake") break;
        const data = extra.get(agent.id) ?? {};
        const nest = data.nest ?? validPoint(cmd.nest);
        const home = validPoint(cmd.home);
        if (!nest || !home) break;
        extra.set(agent.id, { ...data, nest, home, sleeping: true });
        phase.set(agent.id, "to-nest");
        persist(agent.id);
        openNest(agent, false);
        sendState(agent);
        break;
      }
      case "wake": {
        if (!isAsleep(agent.id)) break;
        const data = extra.get(agent.id) ?? {};
        const pending = data.pendingFood ?? 0;
        extra.set(agent.id, { ...data, sleeping: false, pendingFood: 0 });
        phase.set(agent.id, "back");
        invoke("close_nest_window", { id: agent.id }).catch(() => {});
        persist(agent.id);
        // Beim Aufwachen wird das Futter aus der Schlafzeit gutgeschrieben.
        if (pending > 0) feed(agent.id, pending, "Das Futter von vorhin!");
        else sendState(agent);
        break;
      }
      case "arrived":
        if (phaseOf(agent.id) === "to-nest") phase.set(agent.id, "asleep");
        else if (phaseOf(agent.id) === "back") phase.set(agent.id, "awake");
        else break;
        sendState(agent);
        break;
      case "nest-edit": {
        if (phaseOf(agent.id) !== "awake") break;
        const data = extra.get(agent.id) ?? {};
        const nest = data.nest ?? validPoint(cmd.nest);
        if (!nest) break;
        extra.set(agent.id, { ...data, nest });
        openNest(agent, true);
        break;
      }
      case "nest-set": {
        const nest = validPoint(cmd.nest);
        invoke("close_nest_window", { id: agent.id }).catch(() => {});
        if (!nest || phaseOf(agent.id) !== "awake") break;
        extra.set(agent.id, { ...(extra.get(agent.id) ?? {}), nest });
        persist(agent.id);
        sendState(agent);
        break;
      }
      case "focus-toggle":
        if (focusRuns.has(agent.id)) stopFocus(agent.id);
        else if (trackerOf(agent.trackers, "focus")) {
          focusRuns.set(agent.id, { startedAt: Date.now(), credited: 0 });
          focusClosed.set(agent.id, 0);
          if ((trackerOf(agent.trackers, "focus")?.blocked ?? []).length > 0) startBlockWatch();
        }
        sendState(agent);
        break;
      case "invest-refresh":
        refreshInvest(agent.id);
        break;
    }
  };

  const subscribe = <T>(event: string, handler: (payload: T) => void) => {
    listen<T>(event, (e) => handler(e.payload)).then((un) => (alive ? unlisteners.push(un) : un()));
  };

  subscribe<null>(EVENT_SLEEP_ALL, sleepAll);
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
      if (!agent.visible || phaseOf(agent.id) !== "awake") continue;
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
    investTimers.forEach((entry) => window.clearInterval(entry.timer));
    window.clearInterval(blockTimer);
    unlisteners.forEach((un) => un());
  };
}
