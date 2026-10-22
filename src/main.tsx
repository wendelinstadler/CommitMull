import React from "react";
import ReactDOM from "react-dom/client";
import { AgentWindow } from "./AgentWindow";
import { Home } from "./Home";
import { Hub } from "./Hub";
import { Ghost } from "./Ghost";
import { Sheet } from "./Sheet";
import { SettingsWindow } from "./SettingsWindow";
import "./styles.css";

/** Dieselbe Seite dient allen Fenstern; der Query-Parameter waehlt die Ansicht. */
function view() {
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV && params.has("sheet")) return <Sheet />;
  if (params.has("ghost")) return <Ghost />;
  if (params.has("home")) return <Home />;
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
