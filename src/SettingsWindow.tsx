import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Agent, GithubTracker, readAgents, saveAgents } from "./agents";
import {
  DEFAULT_SETTINGS,
  FOOD_OPTIONS,
  GlobalSettings,
  HUNGER_OPTIONS,
  loadSettings,
  POLL_OPTIONS,
  saveSettings,
} from "./settings";

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
 * Inhalt des Einstellungsfensters. Uebergang zur Agenten-Verwaltung: bearbeitet die globalen
 * Werte und die GitHub-Angaben des ersten Agenten.
 */
export function SettingsWindow() {
  const [globals, setGlobals] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Beim Oeffnen (Fenster wird nur versteckt) immer den gespeicherten Stand zeigen.
  useEffect(() => {
    const reload = () => {
      loadSettings().then(setGlobals);
      readAgents().then(setAgents);
      setMessage(null);
    };
    reload();
    const unlisten = listen("settings-opened", reload);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const agent = agents[0];
  const github = agent?.trackers.find((t): t is GithubTracker => t.type === "github");

  const updateGlobal = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) =>
    setGlobals((g) => ({ ...g, [key]: value }));

  const updateGithub = <K extends keyof GithubTracker>(key: K, value: GithubTracker[K]) =>
    setAgents((list) =>
      list.map((a, i) =>
        i === 0 ? { ...a, trackers: a.trackers.map((t) => (t.type === "github" ? { ...t, [key]: value } : t)) } : a,
      ),
    );

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
    if (github && !github.user.trim()) {
      setMessage({ text: "Der GitHub-Benutzername darf nicht leer sein.", error: true });
      return;
    }
    setBusy(true);
    try {
      await invoke("set_hotkey", { hotkey: globals.hotkey });
      await saveSettings(globals);
      if (github) {
        await saveAgents(
          agents.map((a, i) =>
            i === 0
              ? {
                  ...a,
                  trackers: a.trackers.map((t) =>
                    t.type === "github" ? { ...t, user: t.user.trim(), token: t.token.trim() } : t,
                  ),
                }
              : a,
          ),
        );
      }
      await getCurrentWindow().hide();
    } catch (e) {
      setMessage({ text: String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <h1>Einstellungen</h1>

      {agent && github && (
        <>
          <h2>{agent.name}: GitHub</h2>

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
              Mit Token zaehlen auch private Repos und das Abfrage-Limit steigt. Es reicht ein Token mit Lese-Rechten.
              Er wird unverschluesselt in state.json gespeichert.
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
        </>
      )}

      <h2>Allgemein</h2>

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
  );
}
