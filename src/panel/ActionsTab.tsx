import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { checkCommand, checkLink, hostOf, LinkAction, MAX_COMMAND, MAX_COMMANDS, MAX_LINKS } from "../actions";
import { AgentCommand, AgentStatePayload } from "../protocol";

interface Props {
  info: AgentStatePayload;
  send: (cmd: AgentCommand) => void;
}

/** Antwort von run_command: gestartet, oder die Fassung muss erst bestaetigt werden. */
type RunOutcome =
  | { status: "started" }
  | { status: "needs-approval"; name: string; command: string; cwd: string; fingerprint: string };

interface Approval {
  id: string;
  name: string;
  command: string;
  cwd: string;
  fingerprint: string;
}

type Form =
  | { kind: "link"; id?: string; name: string; url: string }
  | { kind: "command"; id?: string; name: string; command: string; cwd: string };

/**
 * Reiter "Aktionen": gespeicherte Seiten (ein Klick, Standardbrowser) und Terminal-Befehle (neues PowerShell-Fenster) des aktiven Modus.
 * Dieses Fenster schickt nur IDs. Adresse und Befehl liest Rust selbst aus dem Speicher; neue oder geaenderte Befehle
 * muessen vor dem ersten Start im vollen Wortlaut bestaetigt werden.
 */
export function ActionsTab({ info, send }: Props) {
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<string | null>(null);
  const agentId = info.id;
  const modeId = info.activeMode;
  const commandsKey = JSON.stringify(info.commands);

  /** Welche Befehle sind in ihrer jetzigen Fassung bestaetigt? Rust weiss es (Pruefsumme), nicht das Webview. */
  const refreshStatus = () =>
    invoke<{ id: string; approved: boolean }[]>("command_status", { agentId, modeId })
      .then((list) => setApproved(Object.fromEntries(list.map((s) => [s.id, s.approved]))))
      .catch(() => setApproved({}));

  useEffect(() => {
    refreshStatus();
  }, [commandsKey, modeId]);

  const open = async (link: LinkAction) => {
    setMessage(null);
    try {
      await invoke("open_link", { agentId, modeId, linkId: link.id });
    } catch (e) {
      setMessage({ text: String(e), error: true });
    }
  };

  const run = async (commandId: string, name: string, approve?: string) => {
    setMessage(null);
    try {
      const outcome = await invoke<RunOutcome>("run_command", { agentId, modeId, commandId, approve });
      if (outcome.status === "needs-approval") {
        setApproval({ id: commandId, name: outcome.name, command: outcome.command, cwd: outcome.cwd, fingerprint: outcome.fingerprint });
      } else {
        setApproval(null);
        setMessage({ text: `"${name}" laeuft in einem neuen Terminalfenster.`, error: false });
        refreshStatus();
      }
    } catch (e) {
      setApproval(null);
      setMessage({ text: String(e), error: true });
      refreshStatus();
    }
  };

  const saveForm = () => {
    if (!form) return;
    if (form.kind === "link") {
      const checked = checkLink(form.name, form.url);
      if (!checked.ok) return setFormError(checked.error);
      send({ id: agentId, type: "action-link-save", link: { id: form.id, ...checked.value } });
    } else {
      const checked = checkCommand(form.name, form.command, form.cwd);
      if (!checked.ok) return setFormError(checked.error);
      send({ id: agentId, type: "action-command-save", command: { id: form.id, ...checked.value } });
    }
    setForm(null);
    setFormError(null);
  };

  if (approval) {
    return (
      <section className="pw-section pw-approval" role="alertdialog" aria-labelledby="approve-title">
        <h2 id="approve-title" className="pw-approval-title">
          Diesen Befehl ausfuehren?
        </h2>
        <p className="pw-note" style={{ marginTop: 0 }}>
          "{approval.name}" laeuft in einem neuen PowerShell-Fenster mit deinen Rechten. Lies den Befehl genau:
        </p>
        <pre className="pw-code" tabIndex={0}>
          {approval.command}
        </pre>
        <p className="pw-note">{approval.cwd ? `Ordner: ${approval.cwd}` : "Ordner: Standard"}</p>
        <p className="pw-note">
          Die Bestaetigung gilt nur fuer genau diesen Befehl in diesem Ordner. Aenderst du etwas, fragt die App wieder.
        </p>
        <div className="pw-proposal-actions">
          <button className="pw-btn" onClick={() => run(approval.id, approval.name, approval.fingerprint)}>
            Ausfuehren
          </button>
          <button className="pw-link" onClick={() => setApproval(null)}>
            Abbrechen
          </button>
        </div>
      </section>
    );
  }

  if (form) {
    return (
      <section className="pw-section">
        <h2 className="pw-h">
          <span>{form.kind === "link" ? (form.id ? "Seite bearbeiten" : "Neue Seite") : form.id ? "Befehl bearbeiten" : "Neuer Befehl"}</span>
        </h2>
        <div className="pw-fields">
          <label>
            <span>Name</span>
            <input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </label>
          {form.kind === "link" ? (
            <label>
              <span>Adresse</span>
              <input value={form.url} placeholder="https://github.com/..." spellCheck={false} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </label>
          ) : (
            <>
              <label>
                <span>Befehl (PowerShell)</span>
                <textarea
                  value={form.command}
                  maxLength={MAX_COMMAND}
                  rows={3}
                  placeholder="npm run dev"
                  spellCheck={false}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                />
              </label>
              <label>
                <span>Ordner (optional)</span>
                <input value={form.cwd} placeholder="C:\Projekte\meine-app" spellCheck={false} onChange={(e) => setForm({ ...form, cwd: e.target.value })} />
              </label>
              <p className="pw-note" style={{ marginTop: 0 }}>
                Der Befehl laeuft mit deinen Rechten. Speichere nur Befehle, die du verstehst. Vor dem ersten Start musst du ihn bestaetigen.
              </p>
            </>
          )}
        </div>
        {formError && (
          <p className="pw-note error" role="alert">
            {formError}
          </p>
        )}
        <div className="pw-proposal-actions" style={{ marginTop: 10 }}>
          <button className="pw-btn" onClick={saveForm}>
            Speichern
          </button>
          <button
            className="pw-link"
            onClick={() => {
              setForm(null);
              setFormError(null);
            }}
          >
            Abbrechen
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      {message && (
        <p className={`pw-note ${message.error ? "error" : ""}`} role={message.error ? "alert" : "status"} style={{ marginTop: 0, marginBottom: 10 }}>
          {message.text}
        </p>
      )}

      <section className="pw-section">
        <h2 className="pw-h">
          <span>Seiten</span>
          <button className="pw-link" disabled={info.links.length >= MAX_LINKS} onClick={() => setForm({ kind: "link", name: "", url: "" })}>
            + Seite
          </button>
        </h2>
        {info.links.length === 0 ? (
          <p className="pw-note" style={{ marginTop: 0 }}>
            Speichere Seiten, die du in diesem Modus oft brauchst, und oeffne sie mit einem Klick im Standardbrowser.
          </p>
        ) : (
          <ul className="pw-actions-list">
            {info.links.map((l) => (
              <li key={l.id}>
                <button className="pw-action-main" onClick={() => open(l)} title={l.url}>
                  <strong>{l.name}</strong>
                  <small>{hostOf(l.url)}</small>
                </button>
                <button className="pw-x pw-edit" aria-label={`${l.name} bearbeiten`} onClick={() => setForm({ kind: "link", id: l.id, name: l.name, url: l.url })}>
                  Bearbeiten
                </button>
                <button className="pw-x" aria-label={`${l.name} loeschen`} onClick={() => send({ id: agentId, type: "action-link-remove", link: l.id })}>
                  x
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pw-section">
        <h2 className="pw-h">
          <span>Befehle</span>
          <button className="pw-link" disabled={info.commands.length >= MAX_COMMANDS} onClick={() => setForm({ kind: "command", name: "", command: "", cwd: "" })}>
            + Befehl
          </button>
        </h2>
        {info.commands.length === 0 ? (
          <p className="pw-note" style={{ marginTop: 0 }}>
            Speichere Terminal-Befehle wie "npm run dev". Sie starten in einem neuen PowerShell-Fenster, nachdem du sie einmal bestaetigt hast.
          </p>
        ) : (
          <ul className="pw-actions-list">
            {info.commands.map((c) => (
              <li key={c.id} className="command">
                <div className="pw-command-row">
                  <button className="pw-btn small" onClick={() => run(c.id, c.name)} aria-label={`${c.name} ausfuehren`}>
                    Ausfuehren
                  </button>
                  <button className="pw-action-main" onClick={() => setShown(shown === c.id ? null : c.id)} aria-expanded={shown === c.id}>
                    <strong>{c.name}</strong>
                    <small>{approved[c.id] ? "bestaetigt" : "noch nicht bestaetigt"}</small>
                  </button>
                  <button className="pw-x pw-edit" aria-label={`${c.name} bearbeiten`} onClick={() => setForm({ kind: "command", id: c.id, name: c.name, command: c.command, cwd: c.cwd })}>
                    Bearbeiten
                  </button>
                  <button className="pw-x" aria-label={`${c.name} loeschen`} onClick={() => send({ id: agentId, type: "action-command-remove", command: c.id })}>
                    x
                  </button>
                </div>
                {shown === c.id && (
                  <>
                    <pre className="pw-code">{c.command}</pre>
                    {c.cwd && <p className="pw-note" style={{ marginTop: 2 }}>Ordner: {c.cwd}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="pw-note">Befehle laufen mit deinen Rechten, nie als Administrator. Sie stammen nur aus deiner eigenen Liste.</p>
      </section>
    </>
  );
}
