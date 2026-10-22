/**
 * Aktionen eines Modus: gespeicherte Seiten und Terminal-Befehle (reine Logik, ohne Tauri).
 *
 * Sicherheit: Hier wird nur geprueft und gespeichert. Geoeffnet und ausgefuehrt wird ausschliesslich in Rust
 * (src-tauri/src/actions.rs), das Adresse und Befehl selbst aus dem Speicher liest. Das Frontend schickt dorthin nur IDs.
 */

export interface LinkAction {
  id: string;
  name: string;
  url: string;
}

export interface CommandAction {
  id: string;
  name: string;
  command: string;
  /** Arbeitsordner (vollstaendiger Pfad), leer = Standardordner. */
  cwd: string;
}

export const MAX_LINKS = 30;
export const MAX_COMMANDS = 20;
export const MAX_ACTION_NAME = 40;
export const MAX_URL = 2000;
export const MAX_COMMAND = 2000;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

/** Fehlt das Schema, aber es sieht nach einem Rechnernamen aus (github.com/x), wird https:// ergaenzt. */
function withScheme(raw: string): string {
  const t = raw.trim();
  // "localhost:3000/x" sieht wie ein Schema aus, ist aber Rechner und Port (lokal ohne Verschluesselung)
  if (/^[^/\s:]+:\d+(\/|$)/.test(t)) return `${/^(localhost|127\.|\[::1\])/i.test(t) ? "http" : "https"}://${t}`;
  return /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//") ? t : `https://${t}`;
}

/** Prueft Name und Adresse einer Seite; liefert die bereinigte Seite (ohne id). */
export function checkLink(nameRaw: string, urlRaw: string): Checked<Omit<LinkAction, "id">> {
  const name = cleanName(nameRaw).slice(0, MAX_ACTION_NAME);
  if (!name) return { ok: false, error: "Die Seite braucht einen Namen." };
  const text = withScheme(urlRaw);
  if (!text || text.length > MAX_URL || /[\s\u0000-\u001f]/.test(text)) {
    return { ok: false, error: "Die Adresse ist leer, zu lang oder enthaelt Leerzeichen." };
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: "Das ist keine gueltige Adresse (https://...)." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Nur Adressen mit http:// oder https:// sind erlaubt." };
  }
  if (!parsed.hostname) return { ok: false, error: "Die Adresse nennt keinen Rechner." };
  if (parsed.username || parsed.password) return { ok: false, error: "Adressen mit Benutzername oder Passwort sind nicht erlaubt." };
  return { ok: true, value: { name, url: parsed.href } };
}

/** Sieht der Ordner wie ein vollstaendiger Windows-Pfad aus (C:\\... oder \\\\Server\\...)? Ob er existiert, prueft Rust. */
export const looksAbsolute = (path: string) => /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");

/** Prueft einen Befehl. Der Befehl wird nicht umgeschrieben, nur an den Raendern von Leerraum befreit. */
export function checkCommand(nameRaw: string, commandRaw: string, cwdRaw: string): Checked<Omit<CommandAction, "id">> {
  const name = cleanName(nameRaw).slice(0, MAX_ACTION_NAME);
  if (!name) return { ok: false, error: "Der Befehl braucht einen Namen." };
  const command = commandRaw.replace(/\r\n/g, "\n").trim();
  if (!command) return { ok: false, error: "Der Befehl ist leer." };
  if (command.length > MAX_COMMAND) return { ok: false, error: `Der Befehl ist zu lang (hoechstens ${MAX_COMMAND} Zeichen).` };
  if (command.includes("\u0000")) return { ok: false, error: "Der Befehl enthaelt ein ungueltiges Zeichen." };
  const cwd = cwdRaw.trim();
  if (cwd && !looksAbsolute(cwd)) return { ok: false, error: "Der Ordner muss ein vollstaendiger Pfad sein, z. B. C:\\Projekte\\app." };
  return { ok: true, value: { name, command, cwd } };
}

/** Rechnername einer Adresse fuer die Anzeige (ohne www.). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const newActionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Fuegt eine Aktion hinzu oder ersetzt die mit gleicher id. Mehr als max Eintraege werden abgelehnt (null). */
export function upsert<T extends { id: string }>(list: T[], item: T, max: number): T[] | null {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) return list.map((x) => (x.id === item.id ? item : x));
  return list.length >= max ? null : [...list, item];
}
