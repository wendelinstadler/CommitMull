import { useState } from "react";
import { AgentCommand, AgentStatePayload } from "../protocol";
import { sortedTodos, TODO_MAX_LENGTH } from "../workday";

interface Props {
  info: AgentStatePayload;
  send: (cmd: AgentCommand) => void;
}

/** Reiter "Aufgaben": einfache Liste. Erledigen fuettert das Tier (einmal je Aufgabe). */
export function TodoTab({ info, send }: Props) {
  const [text, setText] = useState("");
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

      {list.length === 0 && (
        <div className="pw-empty">
          <strong>Noch nichts zu tun.</strong>
          Schreib deine erste Aufgabe oben hin. Jede erledigte Aufgabe fuettert dein Tier.
        </div>
      )}

      {open.length > 0 && (
        <ul className="pw-todos" aria-label="Offene Aufgaben">
          {open.map((t) => (
            <TodoRow key={t.id} todo={t} id={id} send={send} />
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
              <TodoRow key={t.id} todo={t} id={id} send={send} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function TodoRow({ todo, id, send }: { todo: AgentStatePayload["todos"][number]; id: string; send: Props["send"] }) {
  return (
    <li className={`pw-todo ${todo.done ? "done" : ""}`}>
      <button
        className="pw-check"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={`${todo.text}: ${todo.done ? "wieder oeffnen" : "erledigt"}`}
        onClick={() => send({ id, type: "todo-toggle", todo: todo.id })}
      />
      <span className="pw-todo-text">{todo.text}</span>
      <button className="pw-x" aria-label={`${todo.text} loeschen`} onClick={() => send({ id, type: "todo-remove", todo: todo.id })}>
        x
      </button>
    </li>
  );
}
