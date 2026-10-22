import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./panel.css";
import { moodOf } from "../behavior";
import { Pet } from "../Pet";
import {
  AgentCommand,
  agentLabel,
  AgentStatePayload,
  EVENT_AGENT_CMD,
  EVENT_AGENT_NEST_REQUEST,
  EVENT_AGENT_SLEEP_REQUEST,
  EVENT_AGENT_STATE,
  HUB_LABEL,
} from "../protocol";
import { MoreTab } from "./MoreTab";
import { TodayTab } from "./TodayTab";
import { TodoTab } from "./TodoTab";

type Tab = "today" | "todo" | "more";

const MOOD_LABEL = { happy: "Froehlich", ok: "Geht so", sad: "Hungrig" } as const;

/** Merkt sich den zuletzt benutzten Reiter je Tier (nur Komfort, darf fehlschlagen). */
const tabKey = (id: string) => `panelTab:${id}`;
function savedTab(id: string): Tab {
  try {
    const t = localStorage.getItem(tabKey(id));
    if (t === "today" || t === "todo" || t === "more") return t;
  } catch {
    /* kein Speicher: egal */
  }
  return "today";
}

/**
 * Panel eines Tiers: eigenes Fenster neben dem Tier. Zeigt den Zustand des Hubs und schickt Eingaben an ihn.
 * Schliesst sich beim Wegklicken und mit Esc.
 */
export function PanelWindow({ id }: { id: string }) {
  const [info, setInfo] = useState<AgentStatePayload | null>(null);
  const [tab, setTab] = useState<Tab>(() => savedTab(id));
  const [paused, setPaused] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const hadFocus = useRef(false);

  const send = (cmd: AgentCommand) => emitTo(HUB_LABEL, EVENT_AGENT_CMD, cmd).catch(() => {});
  const close = () => invoke("close_panel_window", { id }).catch(() => {});

  useEffect(() => {
    let alive = true;
    const unlisteners = Promise.all([
      listen<AgentStatePayload>(EVENT_AGENT_STATE, (e) => {
        if (e.payload.id === id) setInfo(e.payload);
      }),
      listen<boolean>("pause-changed", (e) => setPaused(e.payload)),
    ]);
    unlisteners.then(() => {
      if (alive) send({ id, type: "ready" });
    });
    invoke<boolean>("get_paused").then(setPaused);
    invoke<boolean>("get_autostart").then(setAutostart);
    return () => {
      alive = false;
      unlisteners.then((list) => list.forEach((f) => f()));
    };
  }, [id]);

  // Schliessen: Esc oder Fokus verloren (erst, wenn das Fenster den Fokus wirklich hatte).
  useEffect(() => {
    hadFocus.current = document.hasFocus();
    const onFocus = () => (hadFocus.current = true);
    const onBlur = () => hadFocus.current && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    const native = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) hadFocus.current = true;
      else if (hadFocus.current) close();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      native.then((un) => un());
    };
  }, [id]);

  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(tabKey(id), t);
    } catch {
      /* egal */
    }
  };

  if (!info) return <div className="pw" />;

  const mood = moodOf(info.hunger);
  const open = info.todos.filter((t) => !t.done).length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "today", label: "Heute" },
    { id: "todo", label: "Aufgaben", count: open },
    { id: "more", label: "Mehr" },
  ];

  return (
    <div className="pw">
      <section className="pw-card" aria-label={`Panel von ${info.name}`}>
        <header className="pw-head">
          <Pet species={info.species} accessory={info.accessory} board={info.views.entries?.over ? "over" : "ok"} state={info.sleep === "asleep" ? "sleep" : mood === "sad" ? "sad" : "idle"} facing="right" size={64} />
          <div className="pw-who">
            <h1 className="pw-name">{info.name}</h1>
            <p className="pw-sub">
              {info.sleep === "asleep" || info.sleep === "to-nest" ? "Schlaeft" : MOOD_LABEL[mood]} im Modus {info.roleLabel}
            </p>
            <div className="pw-hunger">
              <div className={`pw-meter ${mood === "ok" ? "ok" : mood === "sad" ? "sad" : ""}`} role="img" aria-label={`Sattheit ${Math.round(info.hunger * 100)} Prozent`}>
                <span style={{ transform: `scaleX(${info.hunger})` }} />
              </div>
              <span className="pw-hunger-label">{Math.round(info.hunger * 100)} % satt</span>
            </div>
          </div>
          <button className="pw-close" aria-label="Panel schliessen" onClick={close}>
            x
          </button>
        </header>

        {info.modes.length > 1 && (
          <nav className="pw-modes" aria-label="Modus">
            {info.modes.map((m) => (
              <button key={m.id} className="pw-mode" aria-pressed={m.id === info.activeMode} onClick={() => send({ id, type: "mode-set", mode: m.id })}>
                {m.label}
              </button>
            ))}
          </nav>
        )}

        <nav className="pw-tabs" role="tablist" aria-label="Bereiche">
          {tabs.map((t) => (
            <button key={t.id} className="pw-tab" role="tab" aria-selected={tab === t.id} onClick={() => choose(t.id)}>
              {t.label}
              {t.count ? <span className="pw-count">{t.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="pw-body" role="tabpanel">
          {tab === "today" && <TodayTab info={info} send={send} />}
          {tab === "todo" && <TodoTab info={info} send={send} />}
          {tab === "more" && (
            <MoreTab
              info={info}
              send={send}
              paused={paused}
              autostart={autostart}
              onSleep={() => emitTo(agentLabel(id), EVENT_AGENT_SLEEP_REQUEST, null).then(close)}
              onNest={() => emitTo(agentLabel(id), EVENT_AGENT_NEST_REQUEST, null).then(close)}
              onPause={() => invoke("set_paused", { paused: !paused })}
              onAutostart={() => invoke<boolean>("set_autostart", { enabled: !autostart }).then(setAutostart)}
              onHome={() => invoke("open_home").then(close)}
              onSettings={() => invoke("open_settings").then(close)}
              onQuit={() => invoke("quit_app")}
            />
          )}
        </div>
      </section>
    </div>
  );
}
