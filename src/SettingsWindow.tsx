import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./manage.css";
import { ACCESSORIES, Accessory } from "./accessories";
import {
  Agent,
  AGENTS_CHANGED,
  createAgent,
  createMode,
  Mode,
  modeAccessory,
  modeLabel,
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
import { BlockListEditor, InvestEditor, validateInvest } from "./trackerEditors";
import {
  defaultTracker,
  EntriesTracker,
  FocusTracker,
  FOCUS_BLOCK_OPTIONS,
  GRACE_OPTIONS,
  GithubTracker,
  InvestTracker,
  Tracker,
  TrackerType,
  TRACKER_LABELS,
  trackerOf,
} from "./trackers";

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


/**
 * Agenten-Verwaltung: links die Liste, rechts das Formular des gewaehlten Agenten oder die globalen
 * Einstellungen. Alles wird als Entwurf bearbeitet und erst mit "Speichern" uebernommen.
 */
export function SettingsWindow() {
  const [globals, setGlobals] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string>(GENERAL);
  /** Gewaehlter Modus des gewaehlten Tiers; null = erster. */
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Vom Hauptfenster gewuenscht: Agent-Id oder "new" (neuen Agenten anlegen), gilt fuer das naechste Laden. */
  const pending = useRef<string | null>(null);

  // Beim Oeffnen (Fenster wird nur versteckt) immer den gespeicherten Stand zeigen.
  useEffect(() => {
    const reload = () => {
      loadSettings().then(setGlobals);
      readAgents().then((list) => {
        const want = pending.current;
        pending.current = null;
        if (want === "new") {
          const fresh = createAgent("Neues Tier", "cat", "custom");
          setAgents([...list, fresh]);
          setSelected(fresh.id);
        } else {
          setAgents(list);
          setSelected(list.find((a) => a.id === want)?.id ?? list[0]?.id ?? GENERAL);
        }
      });
      setSelectedMode(null);
      setConfirmDelete(false);
      setMessage(null);
    };
    reload();
    const unlistenOpen = listen("settings-opened", reload);
    const unlistenSelect = listen<string>("settings-select", (e) => (pending.current = e.payload));
    // Schaltet jemand einen Agenten im Tray-Menue um, folgt der Entwurf, damit Speichern es nicht rueckgaengig macht.
    const unlistenChanged = listen(AGENTS_CHANGED, () => {
      readAgents().then((stored) =>
        setAgents((draft) => draft.map((a) => ({ ...a, visible: stored.find((s) => s.id === a.id)?.visible ?? a.visible }))),
      );
    });
    return () => {
      unlistenOpen.then((f) => f());
      unlistenSelect.then((f) => f());
      unlistenChanged.then((f) => f());
    };
  }, []);

  const agent = agents.find((a) => a.id === selected);
  const mode: Mode | undefined = agent && (agent.modes.find((m) => m.id === selectedMode) ?? agent.modes[0]);
  const github = mode && trackerOf(mode.trackers, "github");
  const entries = mode && trackerOf(mode.trackers, "entries");
  const focus = mode && trackerOf(mode.trackers, "focus");
  const invest = mode && trackerOf(mode.trackers, "invest");

  const updateGlobal = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) =>
    setGlobals((g) => ({ ...g, [key]: value }));

  const updateAgent = (patch: Partial<Agent>) =>
    setAgents((list) => list.map((a) => (a.id === selected ? { ...a, ...patch } : a)));

  /** Aendert den gewaehlten Modus des gewaehlten Tiers. */
  const updateMode = (patch: Partial<Mode>) => {
    if (!mode) return;
    setAgents((list) =>
      list.map((a) =>
        a.id === selected ? { ...a, modes: a.modes.map((m) => (m.id === mode.id ? { ...m, ...patch } : m)) } : a,
      ),
    );
  };

  const updateTracker = <T extends Tracker>(type: T["type"], patch: Partial<T>) => {
    if (!mode) return;
    updateMode({ trackers: mode.trackers.map((t) => (t.type === type ? ({ ...t, ...patch } as Tracker) : t)) });
  };

  const updateGithub = (patch: Partial<GithubTracker>) => updateTracker<GithubTracker>("github", patch);
  const updateEntries = (patch: Partial<EntriesTracker>) => updateTracker<EntriesTracker>("entries", patch);
  const updateFocus = (patch: Partial<FocusTracker>) => updateTracker<FocusTracker>("focus", patch);
  const updateInvest = (patch: Partial<InvestTracker>) => updateTracker<InvestTracker>("invest", patch);

  /** Wechselt die Art der Eintraege; ein unveraenderter Standardname wird mitgewechselt. */
  const setEntriesKind = (kind: EntriesTracker["kind"]) => {
    if (!entries) return;
    const isDefault = entries.label === "Ausgabe" || entries.label === "Haken";
    updateEntries({ kind, label: isDefault ? defaultTracker("entries", kind).label : entries.label });
  };

  /** Rollenwechsel: vorhandene Futterquellen bleiben, die der Vorlage fehlenden kommen dazu. */
  const setRole = (role: Role) => {
    if (!mode) return;
    const add = roleInfo(role).trackers().filter((t) => !mode.trackers.some((h) => h.type === t.type));
    updateMode({
      role,
      accessory: role === "custom" ? mode.accessory ?? "none" : undefined,
      trackers: [...mode.trackers, ...add],
    });
  };

  const toggleTracker = (type: TrackerType, on: boolean) => {
    if (!mode) return;
    const without = mode.trackers.filter((t) => t.type !== type);
    updateMode({ trackers: on ? [...without, defaultTracker(type as "github")] : without });
  };

  /** Neuer Modus: die erste Rolle, die das Tier noch nicht hat, sonst "Eigene". */
  const addMode = () => {
    if (!agent) return;
    const role = (["dev", "finance", "learning", "fitness", "habits"] as Role[]).find((r) => !agent.modes.some((m) => m.role === r)) ?? "custom";
    const fresh = createMode(agent.id, role);
    updateAgent({ modes: [...agent.modes, fresh] });
    setSelectedMode(fresh.id);
  };

  const removeMode = () => {
    if (!agent || !mode || agent.modes.length < 2) return;
    updateAgent({ modes: agent.modes.filter((m) => m.id !== mode.id) });
    setSelectedMode(null);
  };

  const addAgent = () => {
    const fresh = createAgent("Neues Tier", "cat", "custom");
    setAgents((list) => [...list, fresh]);
    setSelected(fresh.id);
    setSelectedMode(null);
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

  const onHotkeyKey = (field: "hotkey" | "sleepHotkey") => (e: React.KeyboardEvent) => {
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
    updateGlobal(field, [...modifiers, key].join("+"));
  };

  const save = async () => {
    for (const a of agents) {
      if (!a.name.trim()) {
        setSelected(a.id);
        setMessage({ text: "Jedes Tier braucht einen Namen.", error: true });
        return;
      }
      for (const m of a.modes) {
        const where = a.modes.length > 1 ? `${a.name} (${modeLabel(m)})` : a.name;
        const fail = (text: string) => {
          setSelected(a.id);
          setSelectedMode(m.id);
          setMessage({ text: `${where}: ${text}`, error: true });
        };
        const gh = trackerOf(m.trackers, "github");
        if (gh && !gh.user.trim()) return fail("Der GitHub-Benutzername darf nicht leer sein.");
        const inv = trackerOf(m.trackers, "invest");
        const invError = inv && validateInvest(inv);
        if (invError) return fail(invError);
        const en = trackerOf(m.trackers, "entries");
        if (en && (!en.label.trim() || (en.kind === "expense" && (!(en.budget > 0) || !en.currency.trim())))) {
          return fail("Eintraege brauchen einen Namen, bei Ausgaben auch Budget und Waehrung.");
        }
      }
    }
    setBusy(true);
    try {
      if (globals.hotkey === globals.sleepHotkey) throw new Error("Die beiden Hotkeys muessen verschieden sein.");
      await invoke("set_hotkey", { hotkey: globals.hotkey, kind: "toggle" });
      await invoke("set_hotkey", { hotkey: globals.sleepHotkey, kind: "sleep" });
      await saveSettings(globals);
      await saveAgents(
        agents.map((a) => ({
          ...a,
          name: a.name.trim(),
          modes: a.modes.map((m) => ({
            ...m,
            label: m.label?.trim() || undefined,
            trackers: m.trackers.map((t) => {
              if (t.type === "github") return { ...t, user: t.user.trim(), token: t.token.trim() };
              if (t.type === "entries") return { ...t, label: t.label.trim(), currency: t.currency.trim() };
              return t;
            }),
          })),
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
        <h1>Tiere</h1>
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
              <Pet species={a.species} accessory={modeAccessory(a.modes[0])} state="idle" facing="right" size={64} />
              <span className="manage-item-text">
                <strong>{a.name || "(ohne Namen)"}</strong>
                <small>{a.modes.map(modeLabel).join(", ")}{a.visible ? "" : ", aus"}</small>
              </span>
            </button>
          ))}
          {agents.length === 0 && <p className="manage-empty">Noch keine Tiere.</p>}
        </div>
        <button className="manage-add" onClick={addAgent}>
          Neues Tier
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
                <Pet species={agent.species} accessory={mode ? modeAccessory(mode) : "none"} state="idle" facing="right" size={128} />
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

              <h2>Modi</h2>
              <p className="manage-hint">
                Ein Tier kann mehrere Modi haben (Informatiker, Finanzen, Lernen ...). Im Panel wechselst du mit einem Klick, jeder Modus
                hat sein Accessoire, seine Futterquellen und seine Daten.
              </p>
              <div className="manage-modes" role="tablist" aria-label="Modi">
                {agent.modes.map((m) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={m.id === mode?.id}
                    className={m.id === mode?.id ? "selected" : ""}
                    onClick={() => setSelectedMode(m.id)}
                  >
                    {modeLabel(m)}
                  </button>
                ))}
                <button className="add" onClick={addMode}>
                  + Modus
                </button>
              </div>

              {mode && (
                <>
                  <label>
                    <span>Vorlage</span>
                    <select value={mode.role} onChange={(e) => setRole(e.target.value as Role)}>
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <small>{roleInfo(mode.role).hint}</small>
                  </label>

                  <label>
                    <span>Name des Modus (optional)</span>
                    <input
                      value={mode.label ?? ""}
                      placeholder={roleInfo(mode.role).label}
                      maxLength={20}
                      onChange={(e) => updateMode({ label: e.target.value })}
                    />
                  </label>

                  {mode.role === "custom" && (
                    <label>
                      <span>Accessoire</span>
                      <select
                        value={mode.accessory ?? "none"}
                        onChange={(e) => updateMode({ accessory: e.target.value as Accessory })}
                      >
                        {ACCESSORIES.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {agent.modes.length > 1 && (
                    <button className="manage-remove-mode" onClick={removeMode}>
                      Diesen Modus entfernen
                    </button>
                  )}
                </>
              )}

              <h2>Futterquellen</h2>

              <label className="manage-check">
                <input type="checkbox" checked={!!github} onChange={(e) => toggleTracker("github", e.target.checked)} />
                <span>{TRACKER_LABELS.github}</span>
              </label>

              {github && (
                <div className="manage-indent">
                  <label>
                    <span>GitHub-Benutzername</span>
                    <input value={github.user} onChange={(e) => updateGithub({ user: e.target.value })} spellCheck={false} />
                  </label>

                  <label>
                    <span>GitHub-Token (optional)</span>
                    <input
                      type="password"
                      value={github.token}
                      onChange={(e) => updateGithub({ token: e.target.value })}
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
                    <select value={github.pollMinutes} onChange={(e) => updateGithub({ pollMinutes: Number(e.target.value) })}>
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
                    <select value={github.foodPercent} onChange={(e) => updateGithub({ foodPercent: Number(e.target.value) })}>
                      {FOOD_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p} %
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <label className="manage-check">
                <input type="checkbox" checked={!!entries} onChange={(e) => toggleTracker("entries", e.target.checked)} />
                <span>{TRACKER_LABELS.entries}</span>
              </label>

              {entries && (
                <div className="manage-indent">
                  <label>
                    <span>Art</span>
                    <select value={entries.kind} onChange={(e) => setEntriesKind(e.target.value as EntriesTracker["kind"])}>
                      <option value="expense">Ausgaben mit Wochenbudget</option>
                      <option value="check">Haken (zaehlt pro Tag)</option>
                    </select>
                  </label>

                  <label>
                    <span>Name des Eintrags</span>
                    <input value={entries.label} maxLength={20} onChange={(e) => updateEntries({ label: e.target.value })} />
                  </label>

                  {entries.kind === "expense" && (
                    <div className="manage-two">
                      <label>
                        <span>Wochenbudget</span>
                        <input
                          type="number"
                          min={1}
                          value={entries.budget}
                          onChange={(e) => updateEntries({ budget: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Waehrung</span>
                        <input value={entries.currency} maxLength={4} onChange={(e) => updateEntries({ currency: e.target.value })} />
                      </label>
                    </div>
                  )}

                  <label>
                    <span>Futter pro Eintrag</span>
                    <select value={entries.foodPercent} onChange={(e) => updateEntries({ foodPercent: Number(e.target.value) })}>
                      {FOOD_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p} %
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <label className="manage-check">
                <input type="checkbox" checked={!!focus} onChange={(e) => toggleTracker("focus", e.target.checked)} />
                <span>{TRACKER_LABELS.focus}</span>
              </label>

              {focus && (
                <div className="manage-indent">
                  <label>
                    <span>Futter nach jeweils</span>
                    <select value={focus.blockMinutes} onChange={(e) => updateFocus({ blockMinutes: Number(e.target.value) })}>
                      {FOCUS_BLOCK_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m} Minuten Fokus
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Futter pro Zeitspanne</span>
                    <select value={focus.foodPercent} onChange={(e) => updateFocus({ foodPercent: Number(e.target.value) })}>
                      {FOOD_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p} %
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Frist, bevor ein gesperrtes Programm geschlossen wird</span>
                    <select value={focus.graceSeconds ?? 10} onChange={(e) => updateFocus({ graceSeconds: Number(e.target.value) })}>
                      {GRACE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s} Sekunden
                        </option>
                      ))}
                    </select>
                  </label>

                  <BlockListEditor blocked={focus.blocked ?? []} onChange={(list) => updateFocus({ blocked: list })} />
                </div>
              )}

              <label className="manage-check">
                <input type="checkbox" checked={!!invest} onChange={(e) => toggleTracker("invest", e.target.checked)} />
                <span>{TRACKER_LABELS.invest}</span>
              </label>

              {invest && (
                <div className="manage-indent">
                  <InvestEditor tracker={invest} onChange={updateInvest} />
                </div>
              )}
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
                  onKeyDown={onHotkeyKey("hotkey")}
                  placeholder="Hier klicken, dann Tasten druecken"
                />
              </label>

              <label>
                <span>Hotkey: alle schlafen schicken / aufwecken</span>
                <input
                  className="hotkey"
                  readOnly
                  value={globals.sleepHotkey}
                  onKeyDown={onHotkeyKey("sleepHotkey")}
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
