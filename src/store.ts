import { load, Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "state.json";

let store: Promise<Store> | undefined;

/** Gemeinsamer Zugriff auf den gespeicherten Zustand (Hunger, gesehene Commits ...). */
export function getStore(): Promise<Store> {
  store ??= load(STORE_FILE, { defaults: {}, autoSave: false });
  return store;
}

export async function saveValue(key: string, value: unknown) {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}
