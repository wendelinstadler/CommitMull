import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Ghost } from "./Ghost";
import { SettingsWindow } from "./SettingsWindow";
import "./styles.css";

/** Dieselbe Seite dient allen Fenstern; der Query-Parameter waehlt die Ansicht. */
function view() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("ghost")) return <Ghost />;
  if (params.has("settings")) return <SettingsWindow />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view()}
  </React.StrictMode>,
);
