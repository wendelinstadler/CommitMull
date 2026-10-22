import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  AI_MODELS,
  ask,
  baseSystem,
  ChatMessage,
  depotContext,
  MAX_INPUT_CHARS,
  planContext,
  reviewContext,
  trimHistory,
} from "../ai";
import { AgentStatePayload } from "../protocol";

const STORE_LIMIT = 40;
const chatKey = (info: AgentStatePayload) => `chat:${info.id}:${info.activeMode}`;

function loadChat(key: string): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((m): m is ChatMessage => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string").slice(-STORE_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function saveChat(key: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(key, JSON.stringify(messages.slice(-STORE_LIMIT)));
  } catch {
    /* Verlauf ist Komfort, darf fehlschlagen */
  }
}

type Action = "plan" | "review" | "depot";

const ACTIONS: { id: Action; label: string; prompt: string; sends: string }[] = [
  { id: "plan", label: "Tagesplan", prompt: "Erstelle mir einen Tagesplan.", sends: "sendet deine offenen Aufgaben" },
  { id: "review", label: "Rueckblick", prompt: "Mach mir einen Rueckblick auf heute.", sends: "sendet Aufgaben und Tageszahlen" },
  { id: "depot", label: "Depot erklaeren", prompt: "Erklaere mir die heutigen Bewegungen in meinem Depot.", sends: "sendet die Positionen deines Depots" },
];

interface Props {
  info: AgentStatePayload;
  /** Meldet, ob gerade eine Anfrage laeuft (dann bleibt das Panel beim Wegklicken offen, damit die Antwort ankommt). */
  onBusy: (busy: boolean) => void;
}

/** Reiter "Assistent": Chat im aktuellen Modus mit Schnellaktionen. Laeuft nur mit eigenem Schluessel und nach Einschalten in den Einstellungen. */
export function AssistantTab({ info, onBusy }: Props) {
  const key = chatKey(info);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(key));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const loadedFor = useRef(key);

  // Beim Moduswechsel den Verlauf des anderen Modus laden.
  useEffect(() => {
    if (loadedFor.current !== key) {
      loadedFor.current = key;
      setMessages(loadChat(key));
      setError(null);
      setMeta(null);
    }
  }, [key]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, error]);

  const setBusyBoth = (b: boolean) => {
    setBusy(b);
    onBusy(b);
  };

  /** Stellt eine Frage; extra ist zusaetzlicher Kontext fuer diese eine Anfrage (z. B. Aufgaben), der nicht im Verlauf landet. */
  const run = async (question: string, extra?: string) => {
    const user: ChatMessage = { role: "user", content: question };
    const history = [...messages, user];
    setMessages(history);
    saveChat(key, history);
    setText("");
    setError(null);
    setBusyBoth(true);
    try {
      const system = extra ? `${baseSystem(info)}\n\n${extra}` : baseSystem(info);
      const reply = await ask(info.ai.model, system, trimHistory(history));
      const answer: ChatMessage = { role: "assistant", content: reply.truncated ? `${reply.text} ...` : reply.text };
      const next = [...history, answer];
      setMessages(next);
      saveChat(key, next);
      setMeta(`${AI_MODELS.find((m) => m.id === reply.model)?.label ?? reply.model}, ${reply.inputTokens + reply.outputTokens} Tokens`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBoth(false);
    }
  };

  const runAction = (action: Action) => {
    const a = ACTIONS.find((x) => x.id === action)!;
    const extra = action === "plan" ? planContext(info) : action === "review" ? reviewContext(info) : depotContext(info);
    run(a.prompt, extra);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q && !busy) run(q);
  };

  const clear = () => {
    setMessages([]);
    saveChat(key, []);
    setError(null);
    setMeta(null);
  };

  if (!info.ai.ready) {
    return (
      <div className="pw-setup">
        <h2>Assistent einrichten</h2>
        <p>
          {info.name} kann mit Claude chatten, Aufgaben aufteilen, einen Tagesplan und Rueckblick schreiben und Bewegungen im Depot erklaeren.
        </p>
        <ul>
          <li>Du brauchst einen eigenen API-Schluessel von console.anthropic.com. Eine Anmeldung mit dem Claude-Abo ist in fremden Apps nicht moeglich.</li>
          <li>Der Schluessel liegt sicher im Windows-Anmeldeinformationsspeicher, nicht in einer Datei.</li>
          <li>Abgerechnet wird nach Verbrauch, rund 1 Rappen pro Antwort mit Opus, weniger mit Sonnet oder Haiku.</li>
          <li>Es geht nichts an Anthropic, solange der Assistent aus ist.</li>
        </ul>
        <button
          className="pw-btn block"
          onClick={() => emitTo("settings", "settings-select", "general").catch(() => {}).then(() => invoke("open_settings"))}
        >
          {info.ai.hasKey ? "In den Einstellungen einschalten" : "In den Einstellungen einrichten"}
        </button>
      </div>
    );
  }

  const depot = !!info.views.invest && info.views.invest.count > 0;
  return (
    <div className="pw-chat">
      <div className="pw-chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="pw-empty">
            <strong>Frag {info.name} etwas.</strong>
            Der Chat sendet nur deine Nachrichten. Die Schnellaktionen unten senden dazu, was dabeisteht.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`pw-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="pw-msg assistant pending">{info.name} denkt nach ...</div>}
        {error && (
          <div className="pw-msg error" role="alert">
            {error}
          </div>
        )}
        {meta && !busy && !error && <div className="pw-meta">{meta}</div>}
        <div ref={endRef} />
      </div>

      <div className="pw-actions">
        {ACTIONS.filter((a) => a.id !== "depot" || depot).map((a) => (
          <button key={a.id} className="pw-chip" disabled={busy} title={a.sends} onClick={() => runAction(a.id)}>
            {a.label}
          </button>
        ))}
        {messages.length > 0 && (
          <button className="pw-link" onClick={clear} disabled={busy}>
            Verlauf loeschen
          </button>
        )}
      </div>

      <form className="pw-form" onSubmit={submit}>
        <input
          value={text}
          maxLength={MAX_INPUT_CHARS}
          placeholder={`Nachricht an ${info.name}`}
          aria-label="Nachricht"
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <button className="pw-btn" type="submit" disabled={busy || !text.trim()}>
          Senden
        </button>
      </form>
    </div>
  );
}
