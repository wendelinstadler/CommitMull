import React from "react";
import ReactDOM from "react-dom/client";
import { AgentWindow } from "./AgentWindow";
import { Hub } from "./Hub";
import { Ghost } from "./Ghost";
import { SettingsWindow } from "./SettingsWindow";
import "./styles.css";

/** Dieselbe Seite dient allen Fenstern; der Query-Parameter waehlt die Ansicht. */
function view() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("ghost")) return <Ghost />;
  if (params.has("settings")) return <SettingsWindow />;
  if (params.has("hub")) return <Hub />;
  const agent = params.get("agent");
  return agent ? <AgentWindow id={agent} /> : null;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view()}
  </React.StrictMode>,
);
