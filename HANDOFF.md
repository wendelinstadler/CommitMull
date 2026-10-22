# Handoff - CommitMull

Stand: 2026-10-22, Abend. Schritte 5 bis 13 aus PLAN.md sind gebaut und committet, aber noch nicht von Hand in der echten App getestet. Morgen: testen, Rueckmeldungen sammeln, dann Schritt 14 oder 16.

## Wo der Code liegt

- Alles liegt im Worktree `C:\Users\wende\Documents\Projekte\PixCommit\.claude\worktrees\schritt-6-7`, Branch `worktree-schritt-6-7` (9 Commits vor `main`, Stand `a029d9c`).
- Der Branch baut auf `schritt-5-agenten-hub` auf (Schritt 5, im Hauptordner ausgecheckt). `main` ist unveraendert (`174276b`).
- Nichts ist gepusht oder gemergt. Remote: `origin` = github.com/wendelinstadler/CommitMull.
- Zum Zusammenfuehren spaeter: Branch `worktree-schritt-6-7` pruefen und per Pull Request nach `main` bringen (nicht direkt auf `main` pushen).

## Starten

```
cd C:\Users\wende\Documents\Projekte\PixCommit\.claude\worktrees\schritt-6-7
npm run tauri dev
```

- Vor dem Start laufende Instanzen beenden (Tray-Menue "Beenden"), sonst halten sie die Hotkeys und den Port 1420.
- Rust-Aenderungen starten die App neu, Frontend-Aenderungen laden live nach.
- Voraussetzungen siehe README.md (Node, Rust ueber rustup, VS Build Tools, WebView2).
- Zustand liegt in `%APPDATA%\de.wendelinstadler.commitmull\state.json`. Der alte Mull wird beim ersten Start als Tier "Informatiker" uebernommen.

## Was gebaut ist (Kurzform, Details in README.md und PLAN.md)

| Schritt | Inhalt |
| --- | --- |
| 5 | Hub (unsichtbares Fenster mit der ganzen Logik) und ein Fenster pro Tier |
| 6, 7 | Verwaltung (Liste, Tierart, Rolle), 7 Tierarten, 6 Rollen mit Accessoires |
| 8 | Hauptfenster als Startseite (Tierkarten mit Schalter), schliesst ins Tray |
| 9 | Tracker: GitHub, manuelle Eintraege (Ausgaben mit Wochenbudget, Haken), Fokus-Timer |
| 10 | Schlafmodus mit Nest, "Alle schlafen" per Tray und Hotkey `Ctrl+Shift+S` |
| dazu | Programm-Sperre im Fokus (sanftes Schliessen), Investments (Depot, Kurse von Yahoo Finance) |
| 11 | Ein Tier mit mehreren Modi, neues Panel-Fenster (Reiter Heute, Aufgaben, Mehr), Aufgabenliste, Hinweise bei grossen Kursbewegungen |
| 12 | KI-Assistent (Claude, eigener API-Schluessel): Chat, Aufgaben aufteilen, Tagesplan, Rueckblick, Depot erklaeren |
| 13 | Aktionen pro Modus: gespeicherte Seiten und Terminal-Befehle mit Bestaetigung |

## Das sollte morgen von Hand getestet werden

Das Meiste habe ich nur mit Rust-Tests und einem Browser-Simulator geprueft. In der echten App noch nicht bedient wurde:

1. **Panel** (Klick aufs Tier): oeffnet es links oder rechts vom Tier, schliesst es beim Wegklicken, nicht beim Tippen? Passt Aufbau und Aussehen? Mit fuenf Reitern (Heute, Aufgaben, Aktionen, Assistent, Mehr).
2. **Modi**: Einstellungen, Tier waehlen, "+ Modus", im Panel mit den Chips wechseln.
3. **Assistent**: Einstellungen, Allgemein, KI-Assistent: Schluessel von console.anthropic.com eintragen, "Verbindung testen", einschalten. Das ist die wichtigste offene Pruefung: ob die API Anfrageformat und Modellnamen akzeptiert (Kopfzeile `anthropic-version: 2026-10-21`, `output_config.effort: low`, Ausweichroute `fallbacks: "default"`). Schlaegt der Test mit 400 fehl, steht die API-Meldung in der Anzeige; Code in `src-tauri/src/ai.rs`.
4. **Aktionen**: Seite speichern und oeffnen; Befehl speichern, ausfuehren, Bestaetigung pruefen, Befehl aendern (fragt erneut).
5. **Programm-Sperre**: Modus "Lernen", Programm sperren (z. B. aus der Liste der laufenden), Fokus starten, Programm oeffnen.
6. **Depot**: Position eintragen ("Kuerzel pruefen"), Panel, Hinweise bei grossen Bewegungen (Schwellen 3 % Depot, 5 % Position).
7. **Schlafen und Nest** (Panel, Reiter Mehr): Nest verschieben, Aufwecken, mehrere Tiere, Hotkey.
8. **Ob das Tier ueber dem Nest liegt** (Fensterreihenfolge): wird nach dem Oeffnen des Nests nach oben geholt, nie gesehen.

## Bekannte Luecken und offene Punkte

- Hauptfenster zeigt ein schlafendes Tier noch als wach.
- Keine Windows-Benachrichtigungen bei grossen Kursbewegungen (nur Sprechblase und Panel).
- Tagesrueckblick nur auf Klick, nicht automatisch am Abend.
- Ein laufender Fokus-Timer ueberlebt keinen App-Neustart.
- Der GitHub-Token liegt unverschluesselt in `state.json` (der Anthropic-Schluessel dagegen im Windows-Anmeldeinformationsspeicher).
- Befehle werden im Klartext in `state.json` gespeichert und im Bestaetigungsdialog angezeigt: keine Passwoerter darin ablegen.
- Chatverlauf liegt im lokalen Browserspeicher des Panels (je Tier und Modus, loeschbar im Panel).
- Die Rollen-Beschreibungen fuer die KI-Persona werden aus dem Modus-Namen geraten (`personaKey` in `src/ai.ts`); ein selbst umbenannter Modus bekommt die allgemeine Persona.
- Dev-Taste `Tab` (naechstes Tier waehlen) aus dem Plan gibt es nicht; `S` und `Shift+S` (Schlafen) schon.

## Wie es aufgebaut ist

- `src/hubLogic.ts`: die ganze Logik. Zwei Ebenen: am **Tier** (`agent.id`) haengen Hunger, Schlaf, Nest, Aufgaben, Hinweise; am **Modus** (`mode.id`) die Daten der Tracker. Der erste Modus eines Tiers traegt die Id des Tiers, so bleiben aeltere Daten gueltig. Aeltere Speicherstaende (Rolle und Tracker direkt am Tier) werden in `normalizeAgents` umgewandelt.
- Fenster (alle laden dieselbe Seite, die URL waehlt die Ansicht, siehe `src/main.tsx`): `?hub`, `?agent=<id>`, `?panel=<id>`, `?nest=<id>`, `?home`, `?settings`, `?ghost`, `?sheet` (nur Dev, zeigt alle Sprites).
- Tierfenster zeigen und melden nur; Panel und Tierfenster reden mit dem Hub ueber Tauri-Ereignisse (`src/protocol.ts`).
- Rust (`src-tauri/src/`): `lib.rs` (Tray, Fenster, Hotkeys, Befehle), `apps.rs` (Programmfenster), `quotes.rs` (Kurse), `ai.rs` (Claude, Schluesselspeicher), `actions.rs` (Seiten und Befehle).
- Berechtigungen je Fenstertyp in `src-tauri/capabilities/*.json` (agent, hub, home, settings, ghost, nest, panel). Eigene App-Befehle sind fuer alle Fenster aufrufbar.
- Sicherheitsregeln: Frontend schickt fuer Befehle und Seiten nur IDs; Anthropic-Schluessel verlaesst Rust nie; Antworten der KI werden nur angezeigt; Details in PLAN.md (Abschnitte "Aktionen und Sicherheit", "KI-Assistent im Detail").

## Tests

- Rust: `cd src-tauri && cargo test` (21 Tests). Opt-in mit Netz oder echtem Fenster: `cargo test -- --ignored` (Yahoo-Kurse, Notepad schliessen, echtes PowerShell-Fenster).
- TypeScript: `npx tsc --noEmit`.
- Browser-Simulator: Im Test habe ich eine Tauri-Attrappe benutzt (Fake-IPC mit gemeinsamem Speicher ueber mehrere Tabs, Playwright). Sie liegt nicht im Repo, sondern im Scratchpad der Sitzung. Wer das wieder braucht: vite auf einem freien Port starten und die Seiten `?hub`, `?panel=<id>`, `?agent=<id>`, `?settings` in Tabs oeffnen; die Attrappe muss `window.__TAURI_INTERNALS__` (invoke, transformCallback, metadata) bereitstellen. Hinweis: Hintergrund-Tabs verarbeiten Ereignisse verzoegert, im Test den Hub-Tab regelmaessig "anstossen".
- Isolierte Testinstanz der echten App, ohne eigene Daten und Hotkeys zu stoeren: `npx tauri dev --config <json>` mit anderer `identifier`, anderem `devUrl` und `beforeDevCommand` (Port).

## Wie es weitergeht (Vorschlag)

1. Von Hand testen (Liste oben), Rueckmeldungen notieren.
2. Danach nach Wunsch:
   - **Schritt 14: Pakete** (Tiere und Agenten als Datei exportieren und importieren, nur Daten, streng geprueft; Konzept in PLAN.md). Online-Marktplatz erst danach (Schritt 17).
   - **Schritt 16: Installer** (`npm run tauri build`, GitHub-Release), damit die App ohne Entwicklungsumgebung laeuft. Dazu Icons ersetzen (`npx tauri icon <bild.png>`).
   - **Schritt 15: Laufen auf Fensterkanten** (WinAPI `EnumWindows`).
3. Aufraeumen vor einem Release: Entwickler-Tasten und `?sheet` bleiben nur im Dev-Modus; Version in `tauri.conf.json` und `package.json` anheben.
