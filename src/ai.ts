/**
 * KI-Assistent: Prompts und Hilfsfunktionen. Die Anfrage selbst laeuft in Rust (src-tauri/src/ai.rs), dort liegt auch der Schluessel.
 *
 * Datenschutz-Grundsatz: Jede Funktion sendet nur, was ihr Knopf im Panel ankuendigt.
 *  - Chat: nur die eigenen Nachrichten (und Name/Modus des Tiers, Datum)
 *  - Tagesplan, Aufgaben aufteilen: dazu die offenen Aufgaben
 *  - Tagesrueckblick: dazu erledigte Aufgaben, Fokuszeit, Ausgaben der Woche
 *  - Depot erklaeren: dazu die Positionen des Depots
 * Antworten werden nur angezeigt (oder als Aufgabentext uebernommen), nie ausgefuehrt.
 */
import { invoke } from "@tauri-apps/api/core";
import { formatMoney, formatPercent } from "./investTracker";
import { AgentStatePayload } from "./protocol";
import { startOfDay } from "./trackers";

export interface AiModelInfo {
  id: string;
  label: string;
  hint: string;
}

export const AI_MODELS: AiModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "am staerksten, rund 1 Rappen pro Antwort" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "schnell, rund 0,7 Rappen pro Antwort" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "am guenstigsten, Bruchteil eines Rappens" },
];

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiReply {
  text: string;
  truncated: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export const MAX_INPUT_CHARS = 4000;
/** So viele der letzten Nachrichten gehen als Verlauf mit. */
export const HISTORY_LIMIT = 12;

/** Schickt eine Anfrage ueber Rust an Claude. Wirft einen Text mit verstaendlicher Fehlermeldung. */
export async function ask(model: string, system: string, messages: ChatMessage[], maxTokens = 1200): Promise<AiReply> {
  try {
    return await invoke<AiReply>("ai_complete", { request: { model, system, messages, maxTokens } });
  } catch (e) {
    throw new Error(String(e));
  }
}

/** Die letzten Nachrichten, beginnend mit einer Benutzernachricht (die API verlangt das). */
export function trimHistory(messages: ChatMessage[], limit = HISTORY_LIMIT): ChatMessage[] {
  let tail = messages.slice(-limit);
  while (tail.length > 0 && tail[0].role !== "user") tail = tail.slice(1);
  return tail;
}

const PERSONA: Record<string, string> = {
  dev: "Du begleitest eine Person beim Programmieren: Fehler eingrenzen, kleine Schritte planen, Code kurz erklaeren.",
  finance: "Du begleitest eine Person bei ihren Finanzen: Ausgaben im Blick behalten, Zahlen einordnen. Du gibst keine Anlageberatung und keine Kaufen-oder-Verkaufen-Empfehlungen, nennst bei Unsicherheit die Grenzen und verweist auf eigene Recherche oder Fachleute.",
  learning: "Du begleitest eine Person beim Lernen: Stoff in kleine Einheiten teilen, Fragen stellen, Wichtiges wiederholen.",
  fitness: "Du begleitest eine Person beim Training: Motivation, einfache Plaene, Regeneration. Bei Schmerzen oder Beschwerden verweist du auf Aerzte.",
  habits: "Du begleitest eine Person bei Gewohnheiten: kleine Schritte, Dranbleiben, freundlich ohne Druck.",
  custom: "Du hilfst der Person im Arbeitsalltag mit dem, was sie gerade braucht.",
};

/** Rolle des aktiven Modus (fuer die Persona); der Hub liefert nur den Anzeigenamen, daher aus dem Modus-Label geraten, sonst "custom". */
export function personaKey(label: string): keyof typeof PERSONA {
  const l = label.toLowerCase();
  if (l.includes("informatik") || l.includes("dev") || l.includes("code")) return "dev";
  if (l.includes("finanz")) return "finance";
  if (l.includes("lern")) return "learning";
  if (l.includes("fitness") || l.includes("training")) return "fitness";
  if (l.includes("gewohn")) return "habits";
  return "custom";
}

const dateLine = (now = new Date()) =>
  `Heute ist ${now.toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;

/** Basis-Anweisung: Persona, Tonfall, Format. Kein Markdown, weil das Panel reinen Text zeigt. */
export function baseSystem(info: Pick<AgentStatePayload, "name" | "roleLabel">, now = new Date()): string {
  return [
    `Du bist ${info.name}, ein kleines Pixel-Haustier auf dem Desktop der Person und ihr Begleiter im Arbeitsalltag. Aktueller Modus: ${info.roleLabel}.`,
    PERSONA[personaKey(info.roleLabel)],
    "Antworte auf Deutsch (Schweizer Rechtschreibung ohne scharfes s ist in Ordnung), freundlich, knapp und konkret, meist in zwei bis fuenf Saetzen.",
    "Schreibe reinen Text ohne Markdown-Formatierung. Fuer Listen nimmst du pro Zeile einen Bindestrich.",
    "Du hast keinen Zugriff auf das Internet, auf Dateien oder auf den Computer der Person und kannst nichts ausfuehren. Erfinde keine aktuellen Nachrichten oder Kurse.",
    dateLine(now),
  ].join("\n");
}

const listLines = (items: string[]) => (items.length ? items.map((t) => `- ${t}`).join("\n") : "(keine)");

/** Offene Aufgaben als Zeilen. */
export function openTodoLines(info: Pick<AgentStatePayload, "todos">): string[] {
  return info.todos.filter((t) => !t.done).map((t) => t.text);
}

/** Zusatz fuer den Tagesplan: offene Aufgaben. */
export function planContext(info: Pick<AgentStatePayload, "todos">): string {
  return `Die offenen Aufgaben der Person (neueste zuerst):\n${listLines(openTodoLines(info))}\nMach daraus einen realistischen Tagesplan: sinnvolle Reihenfolge, grobe Zeitangaben, wenn passend kleine Pausen. Aufgaben, die nicht in den Tag passen, nennst du am Ende als "spaeter".`;
}

/** Zusatz fuer den Rueckblick: Zahlen von heute. */
export function reviewContext(info: AgentStatePayload, now = Date.now()): string {
  const day = startOfDay(now);
  const done = info.todos.filter((t) => t.done && (t.doneTs ?? 0) >= day).map((t) => t.text);
  const open = openTodoLines(info);
  const lines = [`Heutiger Stand fuer den Rueckblick:`, `Erledigte Aufgaben heute (${done.length}):\n${listLines(done)}`, `Noch offen (${open.length}):\n${listLines(open.slice(0, 15))}`];
  const v = info.views;
  if (v.focus) lines.push(`Fokuszeit heute: ${v.focus.todayMinutes} Minuten.`);
  if (v.entries) {
    lines.push(
      v.entries.kind === "expense"
        ? `Ausgaben diese Woche: ${v.entries.weekTotal} von ${v.entries.budget} ${v.entries.currency}.`
        : `${v.entries.label} heute: ${v.entries.todayCount}x.`,
    );
  }
  lines.push("Schreibe einen kurzen, freundlichen Tagesrueckblick: was gut lief, was offen blieb, ein konkreter Vorschlag fuer morgen. Keine Vorwuerfe.");
  return lines.join("\n");
}

/** Zusatz fuer die Depot-Erklaerung: Positionen und Bewegungen. Nur auf Klick gesendet. */
export function depotContext(info: AgentStatePayload): string {
  const inv = info.views.invest;
  if (!inv || inv.count === 0) return "Das Depot ist leer.";
  const rows = inv.rows.map((r) => `${r.symbol} (${r.name}): heute ${r.dayPct === null ? "unbekannt" : formatPercent(r.dayPct)}, gesamt ${r.gainPct === null ? "unbekannt" : formatPercent(r.gainPct)}`);
  const alerts = info.alerts.map((a) => a.text);
  return [
    `Das Depot der Person (nur zur Anzeige, ${inv.base}): Wert ${formatMoney(inv.value)}, Gewinn ${formatPercent(inv.gainPct)}, heute ${formatPercent(inv.dayPct)}.`,
    `Positionen:\n${listLines(rows)}`,
    alerts.length ? `Aktuelle Hinweise:\n${listLines(alerts)}` : "",
    "Erklaere in einfachen Worten, was heute bei diesen Bewegungen eine Rolle gespielt haben koennte. Du hast keine aktuellen Nachrichten: sage ehrlich, dass das allgemeine Moeglichkeiten sind und keine bestaetigten Ursachen, und nenne, wo die Person selbst nachschauen kann. Gib keine Kauf- oder Verkaufsempfehlung und keine Anlageberatung.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Anweisung zum Aufteilen einer Aufgabe in Schritte. */
export function splitSystem(info: Pick<AgentStatePayload, "name" | "roleLabel">): string {
  return `${baseSystem(info)}\nDeine Aufgabe jetzt: Teile die genannte Aufgabe in 3 bis 6 kleine, konkrete Schritte, die jeweils in 5 bis 45 Minuten machbar sind. Antworte NUR mit einem JSON-Array von Strings, ohne Text davor oder danach, zum Beispiel ["Schritt eins","Schritt zwei"]. Jeder Schritt ist kurz (unter 80 Zeichen) und beginnt mit einem Verb.`;
}

/**
 * Liest die Schritte aus der Antwort: bevorzugt ein JSON-Array, sonst Zeilen mit Aufzaehlungszeichen oder Nummern.
 * Gibt hoechstens `max` Schritte zurueck, jeweils gekuerzt.
 */
export function parseSteps(text: string, max = 8): string[] {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const steps = parsed.filter((s): s is string => typeof s === "string").map(clean).filter(Boolean);
        if (steps.length > 0) return steps.slice(0, max);
      }
    } catch {
      /* weiter mit Zeilen */
    }
  }
  const marker = /^\s*(?:[-*]|\d+[.)])\s+/;
  return text
    .split(/\r?\n/)
    .filter((line) => marker.test(line))
    .map((line) => clean(line.replace(marker, "")))
    .filter(Boolean)
    .slice(0, max);
}
