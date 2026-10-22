import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  activeModeOf,
  Agent,
  AgentState,
  AGENTS_CHANGED,
  deleteAgentData,
  deleteModeData,
  ensureAgents,
  loadAgentState,
  Mode,
  modeAccessory,
  modeLabel,
  Point,
  readAgents,
  saveAgents,
  saveAgentState,
} from "./agents";
import { checkCommand, checkLink, MAX_COMMANDS, MAX_LINKS, newActionId, upsert } from "./actions";
import { fetchSnapshot, investView, Snapshot } from "./investTracker";
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
  panelLabel,
  SleepPhase,
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
  prettyApp,
  quotesKey,
  startOfDay,
  trackerOf,
  TrackerViews,
} from "./trackers";
import {
  Alert,
  alertsKey,
  freshAlerts,
  investAlerts,
  makeAlert,
  makeTodo,
  MAX_ALERTS,
  MAX_TODOS,
  Todo,
  todosKey,
  toggleTodo,
} from "./workday";

const TICK_MS = 30_000;
/** Futter fuer eine erledigte Aufgabe (Anteil am Hunger); jede Aufgabe fuettert nur einmal. */
const TODO_FOOD = 0.1;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Prueft eine vom Fenster gemeldete Position (nur endliche, vernuenftig grosse Zahlen). */
const validPoint = (p: unknown): Point | null => {
  const q = p as Point | null | undefined;
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100_000;
  return q && ok(q.x) && ok(q.y) ? { x: Math.round(q.x), y: Math.round(q.y) } : null;
};

/** Ein Modus samt seinem Tier. */
interface Unit {
  agent: Agent;
  mode: Mode;
}

/** Futter pro Ereignis des ersten fuetternden Trackers des Modus (fuer die Dev-Taste F), sonst 25 %. Investments fuettern nicht. */
const defaultFood = (mode: Mode) => {
  const feeder = mode.trackers.find((t) => t.type !== "invest");
  return (feeder ? feeder.foodPercent : 25) / 100;
};

/**
 * Die zentrale Logik: Hunger, Schlaf, Aufgaben, Tracker und die Tierfenster. Die Fenster zeigen nur an und melden
 * Eingaben. Nur der Hub schreibt den Zustand, damit sich Fenster nicht in die Quere kommen.
 *
 * Zwei Ebenen: Am Tier (agent.id) haengen Hunger, Schlaf, Nest, Aufgaben und Hinweise. Am Modus (mode.id) haengen die
 * Daten der Tracker (Eintraege, Kurse, Fokus, GitHub). Befehle aus den Fenstern gelten fuer den aktiven Modus.
 * Gibt eine Funktion zum Beenden zurueck.
 */
export function startHub(): () => void {
  let alive = true;
  let paused = false;
  let hungerHours = DEFAULT_SETTINGS.hungerHours;
  let aiEnabled = DEFAULT_SETTINGS.aiEnabled;
  let aiModel = DEFAULT_SETTINGS.aiModel;
  let aiHasKey = false;
  let agents: Agent[] = [];

  // --- Ebene Tier
  const hunger = new Map<string, number>();
  /** Schlafdaten und aktiver Modus je Tier; der Rest von AgentState neben dem Hunger. */
  const extra = new Map<string, Omit<AgentState, "hunger">>();
  const phase = new Map<string, SleepPhase>();
  const todos = new Map<string, Todo[]>();
  const alerts = new Map<string, Alert[]>();
  const phaseOf = (id: string): SleepPhase => phase.get(id) ?? "awake";
  /** Schlaeft: auf dem Weg ins Nest oder im Nest. Dann steht der Hunger still und Futter wartet. */
  const isAsleep = (id: string) => phaseOf(id) === "to-nest" || phaseOf(id) === "asleep";

  // --- Ebene Modus
  const pollTimers = new Map<string, { timer: number; config: string }>();
  const polling = new Set<string>();
  /** Manuelle Eintraege und Fokus-Sitzungen je Modus (der Hub ist der einzige Schreiber). */
  const entryLogs = new Map<string, Entry[]>();
  const focusLogs = new Map<string, FocusSession[]>();
  /** Laufende Fokus-Timer: Startzeit und wie viele volle Zeitspannen schon Futter gaben. */
  const focusRuns = new Map<string, { startedAt: number; credited: number }>();
  /** Gesperrte Programme, die gerade offen sind: seit wann, und ob schon versucht wurde, sie zu schliessen. */
  const blockWatch = new Map<string, { since: number; attempted: boolean }>();
  /** In der laufenden Fokus-Sitzung geschlossene Programme je Modus. */
  const focusClosed = new Map<string, number>();
  let blockTimer: number | undefined;
  let blockChecking = false;
  /** Zuletzt geladene Kurse der Depots, Aktualisierungs-Timer und laufende Abfragen je Modus. */
  const investSnaps = new Map<string, Snapshot>();
  const investTimers = new Map<string, { timer: number; config: string }>();
  const investLoading = new Set<string>();

  const unlisteners: UnlistenFn[] = [];
  let lastTick = Date.now();

  const find = (id: string) => agents.find((a) => a.id === id);
  const units = (): Unit[] => agents.flatMap((agent) => agent.modes.map((mode) => ({ agent, mode })));
  const unitOf = (modeId: string) => units().find((u) => u.mode.id === modeId);
  const activeOf = (agent: Agent): Mode => activeModeOf(agent, extra.get(agent.id)?.mode);

  const buildViews = (mode: Mode): TrackerViews => {
    const now = Date.now();
    const views: TrackerViews = {};
    const github = trackerOf(mode.trackers, "github");
    if (github) views.github = { user: github.user };
    const entries = trackerOf(mode.trackers, "entries");
    if (entries) views.entries = entriesView(entries, entryLogs.get(mode.id) ?? [], now);
    const focus = trackerOf(mode.trackers, "focus");
    if (focus) {
      views.focus = focusView(focus, focusLogs.get(mode.id) ?? [], focusRuns.get(mode.id), now, focusClosed.get(mode.id) ?? 0);
    }
    const invest = trackerOf(mode.trackers, "invest");
    if (invest) views.invest = investView(invest, investSnaps.get(mode.id), investLoading.has(mode.id));
    return views;
  };

  const sendState = (agent: Agent) => {
    const mode = activeOf(agent);
    const payload: AgentStatePayload = {
      id: agent.id,
      name: agent.name,
      species: agent.species,
      accessory: modeAccessory(mode),
      roleLabel: modeLabel(mode),
      modes: agent.modes.map((m) => ({ id: m.id, label: modeLabel(m), accessory: modeAccessory(m) })),
      activeMode: mode.id,
      todos: todos.get(agent.id) ?? [],
      alerts: alerts.get(agent.id) ?? [],
      links: mode.links ?? [],
      commands: mode.commands ?? [],
      ai: { ready: aiEnabled && aiHasKey, enabled: aiEnabled, hasKey: aiHasKey, model: aiModel },
      hunger: hunger.get(agent.id) ?? 1,
      views: buildViews(mode),
      sleep: phaseOf(agent.id),
      nest: extra.get(agent.id)?.nest ?? null,
      home: extra.get(agent.id)?.home ?? null,
    };
    // Das Tierfenster und (falls offen) das Panel bekommen denselben Zustand.
    emitTo(agentLabel(agent.id), EVENT_AGENT_STATE, payload).catch(() => {});
    emitTo(panelLabel(agent.id), EVENT_AGENT_STATE, payload).catch(() => {});
  };

  const persist = (id: string) =>
    saveAgentState(id, { hunger: hunger.get(id) ?? 1, ...extra.get(id) }).catch((e) =>
      console.warn("Speichern fehlgeschlagen:", e),
    );

  const save = (key: string, value: unknown) => saveValue(key, value).catch((e) => console.warn("Speichern fehlgeschlagen:", e));

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

  const say = (id: string, text: string) => {
    emitTo(agentLabel(id), EVENT_AGENT_SAY, { text }).catch(() => {});
  };

  /** Fragt GitHub fuer einen Modus ab (nur wenn er einen GitHub-Tracker hat). */
  const poll = async (modeId: string) => {
    const unit = unitOf(modeId);
    const tracker = unit && trackerOf(unit.mode.trackers, "github");
    if (!unit || !tracker || !githubPlugin.ready(tracker) || polling.has(modeId)) return;
    polling.add(modeId);
    try {
      const event = await githubPlugin.poll(modeId, tracker);
      if (alive && event) feed(unit.agent.id, event.amount, event.text);
    } catch (e) {
      console.warn("GitHub-Abfrage fehlgeschlagen:", e);
    } finally {
      polling.delete(modeId);
    }
  };

  /** Startet Abfragen nur neu, wenn sich die Tracker-Angaben eines Modus geaendert haben (spart Anfragen). */
  const syncPolling = () => {
    for (const [modeId, entry] of [...pollTimers]) {
      const unit = unitOf(modeId);
      const tracker = unit && trackerOf(unit.mode.trackers, "github");
      if (!tracker || JSON.stringify(tracker) !== entry.config) {
        window.clearInterval(entry.timer);
        pollTimers.delete(modeId);
      }
    }
    for (const { mode } of units()) {
      const tracker = trackerOf(mode.trackers, "github");
      if (!tracker || pollTimers.has(mode.id)) continue;
      poll(mode.id);
      pollTimers.set(mode.id, {
        timer: window.setInterval(() => poll(mode.id), githubPlugin.intervalMs(tracker)),
        config: JSON.stringify(tracker),
      });
    }
  };

  /** Tray-Menue: alle Tiere mit Haken, auch die deaktivierten. */
  const syncMenu = (attempt = 0) => {
    const entries = agents.map((a) => ({ id: a.id, name: a.name, visible: a.visible }));
    invoke("set_agent_menu", { agents: entries }).catch((e) => {
      // Beim Start ist das Menue eventuell noch nicht gebaut.
      if (attempt < 5 && alive) window.setTimeout(() => syncMenu(attempt + 1), 1000);
      else console.warn("Menue fehlgeschlagen:", e);
    });
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
      for (const { agent, mode } of units()) {
        const tracker = trackerOf(mode.trackers, "focus");
        const list = tracker?.blocked ?? [];
        if (!tracker || !focusRuns.has(mode.id) || list.length === 0) continue;
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
          const key = `${mode.id}|${exe}`;
          const watch = blockWatch.get(key);
          if (!open.includes(exe)) {
            if (watch?.attempted) {
              focusClosed.set(mode.id, (focusClosed.get(mode.id) ?? 0) + 1);
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

  /** Grosse Kursbewegungen: Hinweis in der Liste und als Sprechblase (nicht zweimal in kurzer Zeit zum selben Ausloeser). */
  const raiseInvestAlerts = (unit: Unit) => {
    const tracker = trackerOf(unit.mode.trackers, "invest");
    if (!tracker) return;
    const view = investView(tracker, investSnaps.get(unit.mode.id));
    const existing = alerts.get(unit.agent.id) ?? [];
    const fresh = freshAlerts(investAlerts(view, tracker), existing.filter((a) => a.modeId === unit.mode.id));
    if (fresh.length === 0) return;
    const created = fresh.map((f) => makeAlert(f.key, f.text, unit.mode.id));
    alerts.set(unit.agent.id, [...created, ...existing].slice(0, MAX_ALERTS));
    save(alertsKey(unit.agent.id), alerts.get(unit.agent.id));
    if (!isAsleep(unit.agent.id)) say(unit.agent.id, created.slice(0, 2).map((a) => a.text).join(" "));
  };

  /** Laedt die Kurse eines Depots neu und zeigt sie an. */
  const refreshInvest = async (modeId: string) => {
    const unit = unitOf(modeId);
    const tracker = unit && trackerOf(unit.mode.trackers, "invest");
    if (!unit || !tracker || tracker.positions.length === 0 || investLoading.has(modeId)) return;
    investLoading.add(modeId);
    sendState(unit.agent);
    try {
      const snap = await fetchSnapshot(tracker, investSnaps.get(modeId));
      if (!alive) return;
      investSnaps.set(modeId, snap);
      await saveValue(quotesKey(modeId), snap);
      raiseInvestAlerts(unit);
    } catch (e) {
      console.warn("Kursabfrage fehlgeschlagen:", e);
    } finally {
      investLoading.delete(modeId);
      const current = find(unit.agent.id);
      if (current) sendState(current);
    }
  };

  /** Kurs-Timer pro Depot: nur neu starten, wenn sich Depot oder Intervall aendern; nur fuer aktive Tiere (auch im anderen Modus). */
  const syncInvest = () => {
    for (const [modeId, entry] of [...investTimers]) {
      const unit = unitOf(modeId);
      const tracker = unit && trackerOf(unit.mode.trackers, "invest");
      if (!unit?.agent.visible || !tracker || tracker.positions.length === 0 || JSON.stringify(tracker) !== entry.config) {
        window.clearInterval(entry.timer);
        investTimers.delete(modeId);
      }
    }
    for (const { agent, mode } of units()) {
      const tracker = trackerOf(mode.trackers, "invest");
      if (!agent.visible || !tracker || tracker.positions.length === 0 || investTimers.has(mode.id)) continue;
      refreshInvest(mode.id);
      investTimers.set(mode.id, {
        timer: window.setInterval(() => refreshInvest(mode.id), Math.max(5, tracker.refreshMinutes) * 60_000),
        config: JSON.stringify(tracker),
      });
    }
  };

  /** Beendet einen laufenden Fokus-Timer und speichert die Sitzung, wenn mindestens eine Minute zusammenkam. */
  const stopFocus = (modeId: string) => {
    for (const key of [...blockWatch.keys()]) if (key.startsWith(`${modeId}|`)) blockWatch.delete(key);
    focusClosed.delete(modeId);
    const run = focusRuns.get(modeId);
    if (!run) return;
    focusRuns.delete(modeId);
    const minutes = Math.floor((Date.now() - run.startedAt) / 60_000);
    if (minutes < 1) return;
    const sessions = [...(focusLogs.get(modeId) ?? []), { ts: run.startedAt, minutes }].slice(-MAX_LOG);
    focusLogs.set(modeId, sessions);
    save(focusKey(modeId), sessions);
  };

  const openNest = (agent: Agent, edit: boolean) => {
    const nest = extra.get(agent.id)?.nest;
    if (!nest) return;
    invoke("open_nest_window", { id: agent.id, x: nest.x, y: nest.y, edit }).catch((e) =>
      console.warn("Nest fehlgeschlagen:", e),
    );
  };

  /** Alle sichtbaren Tiere schlafen schicken; schlafen schon alle, werden alle aufgeweckt. */
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

  const addEntry = (agent: Agent, mode: Mode, amount: number, note: string) => {
    const tracker = trackerOf(mode.trackers, "entries");
    if (!tracker) return;
    const value = tracker.kind === "check" ? 1 : amount;
    if (!Number.isFinite(value) || value <= 0 || value > 1e9) return;
    const entry: Entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      amount: value,
      note: String(note ?? "").trim().slice(0, 60),
    };
    const list = [...(entryLogs.get(mode.id) ?? []), entry].slice(-MAX_LOG);
    entryLogs.set(mode.id, list);
    save(entriesKey(mode.id), list);
    const today = list.filter((e) => e.ts >= startOfDay(entry.ts)).length;
    feed(
      agent.id,
      tracker.foodPercent / 100,
      tracker.kind === "expense" ? `${formatAmount(value)} ${tracker.currency} eingetragen` : `${tracker.label}: heute ${today}x`,
    );
  };

  /** Aendert die Aufgabenliste eines Tiers, speichert und zeigt sie an. */
  const changeTodos = (agent: Agent, change: (list: Todo[]) => Todo[]) => {
    const list = change(todos.get(agent.id) ?? []).slice(0, MAX_TODOS);
    todos.set(agent.id, list);
    save(todosKey(agent.id), list);
    sendState(agent);
  };

  /**
   * Aendert den aktiven Modus eines Tiers im gespeicherten Stand (lesen, aendern, schreiben) und meldet es allen Fenstern.
   * Gelesen wird frisch aus dem Speicher, damit gleichzeitige Aenderungen aus der Verwaltung nicht ueberschrieben werden.
   */
  const changeMode = async (agentId: string, modeId: string, change: (mode: Mode) => Mode | null) => {
    const stored = await readAgents();
    let changed = false;
    const next = stored.map((a) =>
      a.id !== agentId
        ? a
        : {
            ...a,
            modes: a.modes.map((m) => {
              if (m.id !== modeId) return m;
              const result = change(m);
              if (!result) return m;
              changed = true;
              return result;
            }),
          },
    );
    if (changed) await saveAgents(next);
  };

  const loadModeData = async (mode: Mode) => {
    if (entryLogs.has(mode.id)) return;
    const store = await getStore();
    entryLogs.set(mode.id, (await store.get<Entry[]>(entriesKey(mode.id))) ?? []);
    focusLogs.set(mode.id, (await store.get<FocusSession[]>(focusKey(mode.id))) ?? []);
    const snap = await store.get<Snapshot>(quotesKey(mode.id));
    if (snap) investSnaps.set(mode.id, snap);
  };

  const forgetMode = (modeId: string) => {
    stopFocus(modeId);
    entryLogs.delete(modeId);
    focusLogs.delete(modeId);
    investSnaps.delete(modeId);
    focusRuns.delete(modeId);
    deleteModeData(modeId).catch((e) => console.warn("Aufraeumen fehlgeschlagen:", e));
  };

  const applyAgents = async (list: Agent[]) => {
    const previous = agents;
    const removed = previous.filter((old) => !list.some((a) => a.id === old.id));
    agents = list;
    const store = await getStore();
    for (const agent of list) {
      if (!hunger.has(agent.id)) {
        const { hunger: h, ...rest } = await loadAgentState(agent.id);
        hunger.set(agent.id, h);
        extra.set(agent.id, rest);
        phase.set(agent.id, rest.sleeping && rest.nest ? "asleep" : "awake");
        todos.set(agent.id, (await store.get<Todo[]>(todosKey(agent.id))) ?? []);
        alerts.set(agent.id, (await store.get<Alert[]>(alertsKey(agent.id))) ?? []);
      }
      for (const mode of agent.modes) await loadModeData(mode);
    }
    if (!alive) return;

    // Entfernte Modi bestehender Tiere
    for (const agent of list) {
      const old = previous.find((a) => a.id === agent.id);
      for (const mode of old?.modes ?? []) {
        if (!agent.modes.some((m) => m.id === mode.id)) forgetMode(mode.id);
      }
      // Der aktive Modus darf nicht auf einen geloeschten zeigen.
      const active = extra.get(agent.id)?.mode;
      if (active && !agent.modes.some((m) => m.id === active)) {
        extra.set(agent.id, { ...(extra.get(agent.id) ?? {}), mode: undefined });
        persist(agent.id);
      }
    }

    for (const agent of removed) {
      invoke("close_agent_window", { id: agent.id }).catch(() => {});
      invoke("close_panel_window", { id: agent.id }).catch(() => {});
      invoke("close_nest_window", { id: agent.id }).catch(() => {});
      for (const mode of agent.modes) {
        stopFocus(mode.id);
        entryLogs.delete(mode.id);
        focusLogs.delete(mode.id);
        investSnaps.delete(mode.id);
      }
      hunger.delete(agent.id);
      extra.delete(agent.id);
      phase.delete(agent.id);
      todos.delete(agent.id);
      alerts.delete(agent.id);
      deleteAgentData(agent).catch((e) => console.warn("Aufraeumen fehlgeschlagen:", e));
      // Der Chatverlauf liegt im lokalen Browserspeicher des Panels (gleicher Ursprung wie der Hub).
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith(`chat:${agent.id}:`) || key === `panelTab:${agent.id}`) localStorage.removeItem(key);
      } catch {
        /* kein Speicher: egal */
      }
    }
    for (const agent of list) {
      if (agent.visible) {
        invoke("open_agent_window", { id: agent.id }).catch((e) => console.warn("Fenster fehlgeschlagen:", e));
        if (phaseOf(agent.id) === "asleep") openNest(agent, false);
        sendState(agent);
      } else {
        invoke("close_agent_window", { id: agent.id }).catch(() => {});
        invoke("close_panel_window", { id: agent.id }).catch(() => {});
        invoke("close_nest_window", { id: agent.id }).catch(() => {});
        for (const mode of agent.modes) stopFocus(mode.id);
      }
    }
    syncPolling();
    syncInvest();
    syncMenu();
  };

  const onCommand = (cmd: AgentCommand) => {
    const agent = find(cmd.id);
    if (!agent) return;
    const mode = activeOf(agent);
    switch (cmd.type) {
      case "ready":
        sendState(agent);
        break;
      case "dev-feed":
        feed(agent.id, defaultFood(mode), null);
        break;
      case "dev-hunger":
        setHunger(agent.id, (hunger.get(agent.id) ?? 1) + cmd.delta);
        break;
      case "poll-now":
        poll(mode.id);
        break;
      case "mode-set": {
        if (!agent.modes.some((m) => m.id === cmd.mode) || mode.id === cmd.mode) break;
        extra.set(agent.id, { ...(extra.get(agent.id) ?? {}), mode: cmd.mode });
        persist(agent.id);
        sendState(agent);
        break;
      }
      case "entry":
        addEntry(agent, mode, cmd.amount, cmd.note);
        break;
      case "entry-undo": {
        const list = (entryLogs.get(mode.id) ?? []).slice(0, -1);
        entryLogs.set(mode.id, list);
        save(entriesKey(mode.id), list);
        sendState(agent);
        break;
      }
      case "todo-add": {
        const todo = makeTodo(cmd.text);
        if (todo) changeTodos(agent, (list) => [todo, ...list]);
        break;
      }
      case "todo-toggle": {
        const before = (todos.get(agent.id) ?? []).find((t) => t.id === cmd.todo);
        if (!before) break;
        // Erledigen fuettert einmal je Aufgabe (sonst liesse sich Futter durch Abhaken und Zuruecknehmen erschleichen).
        const feedNow = !before.done && !before.fed;
        changeTodos(agent, (list) =>
          toggleTodo(list, cmd.todo).map((t) => (t.id === cmd.todo && t.done ? { ...t, fed: true } : t)),
        );
        if (feedNow) feed(agent.id, TODO_FOOD, `Erledigt: ${before.text.slice(0, 40)}`);
        break;
      }
      case "todo-remove":
        changeTodos(agent, (list) => list.filter((t) => t.id !== cmd.todo));
        break;
      case "todo-clear-done":
        changeTodos(agent, (list) => list.filter((t) => !t.done));
        break;
      case "alert-dismiss": {
        const list = (alerts.get(agent.id) ?? []).filter((a) => a.id !== cmd.alert);
        alerts.set(agent.id, list);
        save(alertsKey(agent.id), list);
        sendState(agent);
        break;
      }
      case "action-link-save": {
        const checked = checkLink(cmd.link.name, cmd.link.url);
        if (!checked.ok) break;
        const link = { id: cmd.link.id ?? newActionId(), ...checked.value };
        changeMode(agent.id, mode.id, (m) => {
          const list = upsert(m.links ?? [], link, MAX_LINKS);
          return list ? { ...m, links: list } : null;
        }).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
        break;
      }
      case "action-link-remove":
        changeMode(agent.id, mode.id, (m) => ({ ...m, links: (m.links ?? []).filter((l) => l.id !== cmd.link) })).catch((e) =>
          console.warn("Speichern fehlgeschlagen:", e),
        );
        break;
      case "action-command-save": {
        const checked = checkCommand(cmd.command.name, cmd.command.command, cmd.command.cwd);
        if (!checked.ok) break;
        const command = { id: cmd.command.id ?? newActionId(), ...checked.value };
        changeMode(agent.id, mode.id, (m) => {
          const list = upsert(m.commands ?? [], command, MAX_COMMANDS);
          return list ? { ...m, commands: list } : null;
        }).catch((e) => console.warn("Speichern fehlgeschlagen:", e));
        break;
      }
      case "action-command-remove":
        changeMode(agent.id, mode.id, (m) => ({ ...m, commands: (m.commands ?? []).filter((c) => c.id !== cmd.command) }))
          .then(() => invoke("forget_command", { commandId: cmd.command }))
          .catch((e) => console.warn("Speichern fehlgeschlagen:", e));
        break;
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
        if (focusRuns.has(mode.id)) stopFocus(mode.id);
        else if (trackerOf(mode.trackers, "focus")) {
          focusRuns.set(mode.id, { startedAt: Date.now(), credited: 0 });
          focusClosed.set(mode.id, 0);
          if ((trackerOf(mode.trackers, "focus")?.blocked ?? []).length > 0) startBlockWatch();
        }
        sendState(agent);
        break;
      case "invest-refresh":
        refreshInvest(mode.id);
        break;
    }
  };

  const subscribe = <T>(event: string, handler: (payload: T) => void) => {
    listen<T>(event, (e) => handler(e.payload)).then((un) => (alive ? unlisteners.push(un) : un()));
  };

  subscribe<null>(EVENT_SLEEP_ALL, sleepAll);
  subscribe<boolean>("pause-changed", (value) => (paused = value));
  subscribe<AgentCommand>(EVENT_AGENT_CMD, onCommand);
  /** Liest Einstellungen und Schluesselstatus neu und gibt sie allen Fenstern weiter. */
  const refreshSettings = async () => {
    const s = await loadSettings();
    hungerHours = s.hungerHours;
    aiEnabled = s.aiEnabled;
    aiModel = s.aiModel;
    aiHasKey = await invoke<boolean>("ai_key_status").catch(() => false);
    for (const agent of agents) sendState(agent);
  };
  subscribe<null>(SETTINGS_CHANGED, () => {
    refreshSettings().catch((e) => console.warn("Einstellungen lesen fehlgeschlagen:", e));
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
    for (const { agent, mode } of units()) {
      const run = focusRuns.get(mode.id);
      const tracker = trackerOf(mode.trackers, "focus");
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
      // Deaktivierte Tiere bleiben satt, bis sie wieder eingeschaltet werden.
      if (!agent.visible || phaseOf(agent.id) !== "awake") continue;
      setHunger(agent.id, (hunger.get(agent.id) ?? 1) - elapsed / (hungerHours * 60 * 60 * 1000));
    }
  }, TICK_MS);

  (async () => {
    paused = await invoke<boolean>("get_paused");
    const first = await loadSettings();
    hungerHours = first.hungerHours;
    aiEnabled = first.aiEnabled;
    aiModel = first.aiModel;
    aiHasKey = await invoke<boolean>("ai_key_status").catch(() => false);
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
