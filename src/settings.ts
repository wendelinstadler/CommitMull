import { emit } from "@tauri-apps/api/event";
import { getStore, saveValue } from "./store";

/** Globale Einstellungen; alles andere gehoert zum jeweiligen Agenten (agents.ts). */
export interface GlobalSettings {
  /** Dauer von satt bis leer in Stunden aktiver Zeit. */
  hungerHours: number;
  /** Tastenkombination zum Ein-/Ausblenden, z. B. "Ctrl+Shift+P". */
  hotkey: string;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  hungerHours: 8,
  hotkey: "Ctrl+Shift+P",
};

export const POLL_OPTIONS = [1, 5, 10, 30, 60];
export const HUNGER_OPTIONS = [2, 4, 8, 12, 24];
export const FOOD_OPTIONS = [10, 25, 50, 100];

export const SETTINGS_CHANGED = "settings-changed";

export async function loadSettings(): Promise<GlobalSettings> {
  const store = await getStore();
  const saved = await store.get<Partial<GlobalSettings>>("settings");
  return {
    hungerHours: saved?.hungerHours ?? DEFAULT_SETTINGS.hungerHours,
    hotkey: saved?.hotkey ?? DEFAULT_SETTINGS.hotkey,
  };
}

/** Speichert und meldet allen Fenstern, dass sich die Einstellungen geaendert haben. */
export async function saveSettings(settings: GlobalSettings) {
  const store = await getStore();
  // Unbekannte (aeltere) Schluessel bleiben erhalten, die Migration liest sie.
  const existing = (await store.get<Record<string, unknown>>("settings")) ?? {};
  await saveValue("settings", { ...existing, ...settings });
  await emit(SETTINGS_CHANGED);
}
