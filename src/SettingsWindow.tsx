import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEFAULT_SETTINGS,
  FOOD_OPTIONS,
  HUNGER_OPTIONS,
  loadSettings,
  POLL_OPTIONS,
  saveSettings,
  Settings as SettingsData,
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

/** Inhalt des Einstellungsfensters. */
export function SettingsWindow() {
  const [form, setForm] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Beim Oeffnen (Fenster wird nur versteckt) immer den gespeicherten Stand zeigen.
  useEffect(() => {
    const reload = () => {
      loadSettings().then(setForm);
      setMessage(null);
    };
    reload();
    const unlisten = listen("settings-opened", reload);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const update = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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
    update("hotkey", [...modifiers, key].join("+"));
  };

  const save = async () => {
    const user = form.githubUser.trim();
    if (!user) {
      setMessage({ text: "Der GitHub-Benutzername darf nicht leer sein.", error: true });
      return;
    }
    setBusy(true);
    try {
      await invoke("set_hotkey", { hotkey: form.hotkey });
      await saveSettings({ ...form, githubUser: user, githubToken: form.githubToken.trim() });
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

      <label>
        <span>GitHub-Benutzername</span>
        <input value={form.githubUser} onChange={(e) => update("githubUser", e.target.value)} spellCheck={false} />
      </label>

      <label>
        <span>GitHub-Token (optional)</span>
        <input
          type="password"
          value={form.githubToken}
          onChange={(e) => update("githubToken", e.target.value)}
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
        <select value={form.pollMinutes} onChange={(e) => update("pollMinutes", Number(e.target.value))}>
          {POLL_OPTIONS.map((m) => (
            <option key={m} value={m}>
              alle {m} {m === 1 ? "Minute" : "Minuten"}
            </option>
          ))}
        </select>
        {form.pollMinutes === 1 && !form.githubToken && (
          <small>Ohne Token kann das Limit von 60 Anfragen pro Stunde knapp werden.</small>
        )}
      </label>

      <label>
        <span>Futter pro Commit</span>
        <select value={form.foodPercent} onChange={(e) => update("foodPercent", Number(e.target.value))}>
          {FOOD_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p} %
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Hunger: Dauer von satt bis leer</span>
        <select value={form.hungerHours} onChange={(e) => update("hungerHours", Number(e.target.value))}>
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
          value={form.hotkey}
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
