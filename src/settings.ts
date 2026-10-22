import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getStore, saveValue } from "./store";

export interface Settings {
  githubUser: string;
  /** Optional; mit Token zaehlen auch private Repos und das Abfrage-Limit steigt. */
  githubToken: string;
  pollMinutes: number;
  /** Dauer von satt bis leer in Stunden aktiver Zeit. */
  hungerHours: number;
  /** Futter pro Commit in Prozent. */
  foodPercent: number;
  /** Tastenkombination zum Ein-/Ausblenden, z. B. "Ctrl+Shift+P". */
  hotkey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  githubUser: "wendelinstadler",
  githubToken: "",
  pollMinutes: 10,
  hungerHours: 8,
  foodPercent: 25,
  hotkey: "Ctrl+Shift+P",
};

export const POLL_OPTIONS = [1, 5, 10, 30, 60];
export const HUNGER_OPTIONS = [2, 4, 8, 12, 24];
export const FOOD_OPTIONS = [10, 25, 50, 100];

const SETTINGS_CHANGED = "settings-changed";

export async function loadSettings(): Promise<Settings> {
  const store = await getStore();
  const saved = await store.get<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...saved };
}

/** Speichert und meldet allen Fenstern, dass sich die Einstellungen geaendert haben. */
export async function saveSettings(settings: Settings) {
  await saveValue("settings", settings);
  await emit(SETTINGS_CHANGED);
}

/** Aktuelle Einstellungen; null, bis sie geladen sind. Aktualisiert sich nach dem Speichern. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let alive = true;
    const reload = () => {
      loadSettings().then((s) => alive && setSettings(s));
    };
    reload();
    const unlisten = listen(SETTINGS_CHANGED, reload);
    return () => {
      alive = false;
      unlisten.then((f) => f());
    };
  }, []);

  return settings;
}
