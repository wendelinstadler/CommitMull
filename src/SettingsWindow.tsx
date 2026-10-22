import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./manage.css";
import { ACCESSORIES, Accessory } from "./accessories";
import {
  accessoryOf,
  Agent,
  AGENTS_CHANGED,
  createAgent,
  GithubTracker,
  readAgents,
  Role,
  saveAgents,
} from "./agents";
import { Pet } from "./Pet";
import { ROLES, roleInfo } from "./roles";
import {
  DEFAULT_SETTINGS,
  FOOD_OPTIONS,
  GlobalSettings,
  HUNGER_OPTIONS,
  loadSettings,
  POLL_OPTIONS,
  saveSettings,
} from "./settings";
import { Species, SPECIES_LIST } from "./species";

const GENERAL = "general";

/** Taste aus KeyboardEvent.code, wie sie der Hotkey-Parser versteht; null, wenn nicht erlaubt. */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return null;
}

const githubOf = (agent: Agent) => agent.trackers.find((t): t is GithubTracker => t.type === "github");

/**
 * Agenten-Verwaltung: links die Liste, rechts das Formular des gewaehlten Agenten oder die globalen
 * Einstellungen. Alles wird als Entwurf bearbeitet und erst mit "Speichern" uebernommen.
 */
export function SettingsWindow() {
  const [globals, setGlobals] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string>(GENERAL);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Beim Oeffnen (Fenster wird nur versteckt) immer den gespeicherten Stand zeigen.
  useEffect(() => {
    const reload = () => {
      loadSettings().then(setGlobals);
      readAgents().then((list) => {
        setAgents(list);
        setSelected(list[0]?.id ?? GENERAL);
      });
      setConfirmDelete(false);
      setMessage(null);
    };
    reload();
    const unlistenOpen = listen("settings-opened", reload);
    // Schaltet jemand einen Agenten im Tray-Menue um, folgt der Entwurf, damit Speichern es nicht rueckgaengig macht.
    const unlistenChanged = listen(AGENTS_CHANGED, () => {
      readAgents().then((stored) =>
        setAgents((draft) => draft.map((a) => ({ ...a, visible: stored.find((s) => s.id === a.id)?.visible ?? a.visible }))),
      );
    });
    return () => {
      unlistenOpen.then((f) => f());
      unlistenChanged.then((f) => f());
    };
  }, []);

  const agent = agents.find((a) => a.id === selected);
  const github = agent && githubOf(agent);

  const updateGlobal = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) =>
    setGlobals((g) => ({ ...g, [key]: value }));

  const updateAgent = (patch: Partial<Agent>) =>
    setAgents((list) => list.map((a) => (a.id === selected ? { ...a, ...patch } : a)));

  const updateGithub = <K extends keyof GithubTracker>(key: K, value: GithubTracker[K]) =>
    setAgents((list) =>
      list.map((a) =>
        a.id === selected
          ? { ...a, trackers: a.trackers.map((t) => (t.type === "github" ? { ...t, [key]: value } : t)) }
          : a,
      ),
    );

  const setRole = (role: Role) => {
    const wantsGithub = roleInfo(role).github && !agent?.trackers.some((t) => t.type === "github");
    const template = createAgent("", "cat", role);
    updateAgent({
      role,
      accessory: role === "custom" ? agent?.accessory ?? "none" : undefined,
      trackers: wantsGithub ? [...(agent?.trackers ?? []), ...template.trackers] : agent?.trackers,
    });
  };

  const toggleGithub = (on: boolean) => {
    if (!agent) return;
    const without = agent.trackers.filter((t) => t.type !== "github");
    updateAgent({ trackers: on ? [...without, createAgent("", "cat", "dev").trackers[0]] : without });
  };

  const addAgent = () => {
    const fresh = createAgent("Neuer Agent", "cat", "custom");
    setAgents((list) => [...list, fresh]);
    setSelected(fresh.id);
    setConfirmDelete(false);
    setMessage(null);
  };

  const deleteAgent = () => {
    if (!agent) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const rest = agents.filter((a) => a.id !== agent.id);
    setAgents(rest);
    setSelected(rest[0]?.id ?? GENERAL);
    setConfirmDelete(false);
  };

  const onHotkeyKey = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const modifiers = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
      Boolean,
    );
    const key = keyName(e.code);
    if (!key || modifiers.length === 0) {
      setMessage({ text: "Bitte Strg, Alt, Umschalt oder Windows-Taste plus Buchstabe, Ziffer oder F-Taste.", error: true });
      return;
    }
    setMessage(null);
    updateGlobal("hotkey", [...modifiers, key].join("+"));
  };

  const save = async () => {
    for (const a of agents) {
      if (!a.name.trim()) {
        setSelected(a.id);
        setMessage({ text: "Jeder Agent braucht einen Namen.", error: true });
        return;
      }
      const gh = githubOf(a);
      if (gh && !gh.user.trim()) {
        setSelected(a.id);
        setMessage({ text: `${a.name}: Der GitHub-Benutzername darf nicht leer sein.`, error: true });
        return;
      }
    }
    setBusy(true);
    try {
      await invoke("set_hotkey", { hotkey: globals.hotkey });
      await saveSettings(globals);
      await saveAgents(
        agents.map((a) => ({
          ...a,
          name: a.name.trim(),
          trackers: a.trackers.map((t) => (t.type === "github" ? { ...t, user: t.user.trim(), token: t.token.trim() } : t)),
        })),
      );
      await getCurrentWindow().hide();
    } catch (e) {
      setMessage({ text: String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manage">
      <aside className="manage-side">
        <h1>Agenten</h1>
        <div className="manage-list">
          {agents.map((a) => (
            <button
              key={a.id}
              className={`manage-item ${a.id === selected ? "selected" : ""} ${a.visible ? "" : "off"}`}
              onClick={() => {
                setSelected(a.id);
                setConfirmDelete(false);
              }}
            >
              <Pet species={a.species} accessory={accessoryOf(a)} state="idle" facing="right" size={64} />
              <span className="manage-item-text">
                <strong>{a.name || "(ohne Namen)"}</strong>
                <small>{a.visible ? roleInfo(a.role).label : `${roleInfo(a.role).label}, aus`}</small>
              </span>
            </button>
          ))}
          {agents.length === 0 && <p className="manage-empty">Noch keine Agenten.</p>}
        </div>
        <button className="manage-add" onClick={addAgent}>
          Neuer Agent
        </button>
        <button
          className={`manage-general ${selected === GENERAL ? "selected" : ""}`}
          onClick={() => setSelected(GENERAL)}
        >
          Allgemein
        </button>
      </aside>

      <main className="manage-main">
        <div className="manage-scroll settings">
          {agent && (
            <>
              <div className="manage-head">
                <Pet species={agent.species} accessory={accessoryOf(agent)} state="idle" facing="right" size={128} />
                <div className="manage-head-fields">
                  <label>
                    <span>Name</span>
                    <input value={agent.name} onChange={(e) => updateAgent({ name: e.target.value })} maxLength={30} />
                  </label>
                  <div className="manage-head-buttons">
                    <button onClick={() => updateAgent({ visible: !agent.visible })}>
                      {agent.visible ? "Deaktivieren" : "Aktivieren"}
                    </button>
                    <button className={confirmDelete ? "danger armed" : "danger"} onClick={deleteAgent}>
                      {confirmDelete ? "Wirklich loeschen?" : "Loeschen"}
                    </button>
                  </div>
                  {!agent.visible && (
                    <small>Deaktiviert: kein Fenster, Hunger steht still. Im Tray-Menue unter "Agenten" wieder einschaltbar.</small>
                  )}
                </div>
              </div>

              <h2>Tierart</h2>
              <div className="manage-species">
                {SPECIES_LIST.map((s) => (
                  <button
                    key={s.id}
                    className={s.id === agent.species ? "selected" : ""}
                    onClick={() => updateAgent({ species: s.id as Species })}
                  >
                    <Pet species={s.id} accessory="none" state="idle" facing="right" size={64} />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>

              <h2>Rolle</h2>
              <label>
                <span>Vorlage</span>
                <select value={agent.role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <small>{roleInfo(agent.role).hint}</small>
              </label>

              {agent.role === "custom" && (
                <label>
                  <span>Accessoire</span>
                  <select
                    value={agent.accessory ?? "none"}
                    onChange={(e) => updateAgent({ accessory: e.target.value as Accessory })}
                  >
                    {ACCESSORIES.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <h2>Futterquelle</h2>
              <label className="manage-check">
                <input type="checkbox" checked={!!github} onChange={(e) => toggleGithub(e.target.checked)} />
                <span>GitHub-Commits</span>
              </label>

              {github && (
                <div className="manage-indent">
                  <label>
                    <span>GitHub-Benutzername</span>
                    <input value={github.user} onChange={(e) => updateGithub("user", e.target.value)} spellCheck={false} />
                  </label>

                  <label>
                    <span>GitHub-Token (optional)</span>
                    <input
                      type="password"
                      value={github.token}
                      onChange={(e) => updateGithub("token", e.target.value)}
                      placeholder="Leer lassen fuer oeffentliche Commits"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <small>
                      Mit Token zaehlen auch private Repos und das Abfrage-Limit steigt. Es reicht ein Token mit
                      Lese-Rechten. Er wird unverschluesselt in state.json gespeichert.
                    </small>
                  </label>

                  <label>
                    <span>Abfrage-Intervall</span>
                    <select value={github.pollMinutes} onChange={(e) => updateGithub("pollMinutes", Number(e.target.value))}>
                      {POLL_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          alle {m} {m === 1 ? "Minute" : "Minuten"}
                        </option>
                      ))}
                    </select>
                    {github.pollMinutes === 1 && !github.token && (
                      <small>Ohne Token kann das Limit von 60 Anfragen pro Stunde knapp werden.</small>
                    )}
                  </label>

                  <label>
                    <span>Futter pro Commit</span>
                    <select value={github.foodPercent} onChange={(e) => updateGithub("foodPercent", Number(e.target.value))}>
                      {FOOD_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p} %
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {!github && <small>Weitere Futterquellen (manuelle Eintraege, Fokus-Timer) folgen.</small>}
            </>
          )}

          {!agent && (
            <>
              <h2 className="manage-first">Allgemein</h2>

              <label>
                <span>Hunger: Dauer von satt bis leer</span>
                <select value={globals.hungerHours} onChange={(e) => updateGlobal("hungerHours", Number(e.target.value))}>
                  {HUNGER_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {h} Stunden aktiver Zeit
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Hotkey zum Ein- und Ausblenden</span>
                <input
                  className="hotkey"
                  readOnly
                  value={globals.hotkey}
                  onKeyDown={onHotkeyKey}
                  placeholder="Hier klicken, dann Tasten druecken"
                />
              </label>
            </>
          )}
        </div>

        <div className="manage-footer">
          {message && <p className={message.error ? "settings-message error" : "settings-message"}>{message.text}</p>}
          <div className="settings-buttons">
            <button onClick={() => getCurrentWindow().hide()} disabled={busy}>
              Abbrechen
            </button>
            <button className="primary" onClick={save} disabled={busy}>
              Speichern
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
