import { useState } from "react";
import { ask, parseSteps, splitSystem } from "../ai";
import { AgentCommand, AgentStatePayload } from "../protocol";
import { sortedTodos, Todo, TODO_MAX_LENGTH } from "../workday";

interface Props {
  info: AgentStatePayload;
  send: (cmd: AgentCommand) => void;
  /** Meldet, ob gerade eine KI-Anfrage laeuft (dann bleibt das Panel beim Wegklicken offen). */
  onBusy: (busy: boolean) => void;
}

/** Vorschlag der KI: die Aufgabe in Schritte teilen. Wird erst mit "Uebernehmen" zu Aufgaben. */
interface Proposal {
  todo: string;
  steps: string[];
}

/** Reiter "Aufgaben": einfache Liste. Erledigen fuettert das Tier (einmal je Aufgabe). Mit KI: Aufgabe in Schritte teilen. */
export function TodoTab({ info, send, onBusy }: Props) {
  const [text, setText] = useState("");
  const [splitting, setSplitting] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const id = info.id;
  const list = sortedTodos(info.todos);
  const open = list.filter((t) => !t.done);
  const done = list.filter((t) => t.done);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send({ id, type: "todo-add", text });
    setText("");
  };

  const split = async (todo: Todo) => {
    setSplitting(todo.id);
    setSplitError(null);
    setProposal(null);
    onBusy(true);
    try {
      const reply = await ask(info.ai.model, splitSystem(info), [{ role: "user", content: `Aufgabe: ${todo.text}` }], 600);
      const steps = parseSteps(reply.text);
      if (steps.length === 0) throw new Error("Die Antwort war nicht lesbar. Versuche es nochmal.");
      setProposal({ todo: todo.id, steps });
    } catch (e) {
      setSplitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSplitting(null);
      onBusy(false);
    }
  };

  const accept = () => {
    if (!proposal) return;
    // Neueste zuerst: in umgekehrter Reihenfolge hinzufuegen, damit die Schritte oben in der richtigen Reihenfolge stehen.
    for (const step of [...proposal.steps].reverse()) send({ id, type: "todo-add", text: step });
    setProposal(null);
  };

  return (
    <>
      <form className="pw-todo-form" onSubmit={add}>
        <input
          value={text}
          maxLength={TODO_MAX_LENGTH}
          placeholder="Neue Aufgabe, Enter zum Hinzufuegen"
          aria-label="Neue Aufgabe"
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button className="pw-btn" type="submit" disabled={!text.trim()}>
          Neu
        </button>
      </form>

      {splitError && (
        <p className="pw-note error" role="alert">
          {splitError}
        </p>
      )}

      {list.length === 0 && (
        <div className="pw-empty">
          <strong>Noch nichts zu tun.</strong>
          Schreib deine erste Aufgabe oben hin. Jede erledigte Aufgabe fuettert dein Tier.
        </div>
      )}

      {open.length > 0 && (
        <ul className="pw-todos" aria-label="Offene Aufgaben">
          {open.map((t) => (
            <li key={t.id} className="pw-todo-item">
              <TodoRow todo={t} id={id} send={send} canSplit={info.ai.ready} busy={splitting !== null} splitting={splitting === t.id} onSplit={() => split(t)} />
              {proposal?.todo === t.id && (
                <div className="pw-proposal" role="group" aria-label="Vorschlag der KI">
                  <strong>Vorschlag</strong>
                  <ol>
                    {proposal.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <div className="pw-proposal-actions">
                    <button className="pw-btn" onClick={accept}>
                      Als Aufgaben uebernehmen
                    </button>
                    <button className="pw-link" onClick={() => setProposal(null)}>
                      Verwerfen
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <div className="pw-subhead">
            <span>Erledigt ({done.length})</span>
            <button className="pw-link" onClick={() => send({ id, type: "todo-clear-done" })}>
              Aufraeumen
            </button>
          </div>
          <ul className="pw-todos" aria-label="Erledigte Aufgaben">
            {done.slice(0, 20).map((t) => (
              <li key={t.id} className="pw-todo-item">
                <TodoRow todo={t} id={id} send={send} canSplit={false} busy={false} splitting={false} onSplit={() => undefined} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function TodoRow({
  todo,
  id,
  send,
  canSplit,
  busy,
  splitting,
  onSplit,
}: {
  todo: Todo;
  id: string;
  send: Props["send"];
  canSplit: boolean;
  busy: boolean;
  splitting: boolean;
  onSplit: () => void;
}) {
  return (
    <div className={`pw-todo ${todo.done ? "done" : ""}`}>
      <button
        className="pw-check"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={`${todo.text}: ${todo.done ? "wieder oeffnen" : "erledigt"}`}
        onClick={() => send({ id, type: "todo-toggle", todo: todo.id })}
      />
      <span className="pw-todo-text">{todo.text}</span>
      {canSplit && (
        <button className="pw-x pw-split" aria-label={`${todo.text} mit KI aufteilen`} disabled={busy} onClick={onSplit}>
          {splitting ? "..." : "Aufteilen"}
        </button>
      )}
      <button className="pw-x" aria-label={`${todo.text} loeschen`} onClick={() => send({ id, type: "todo-remove", todo: todo.id })}>
        x
      </button>
    </div>
  );
}
