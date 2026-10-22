# CommitMull

Ein Desktop-Haustier fuer Windows: ein Pixel-Nacktmull, der auf dem Bildschirm lebt und von deinen GitHub-Commits gefuettert wird. Gebaut mit Tauri 2, React und TypeScript.

Das Tier stirbt nie. Wenn es lange nichts zu fressen gibt, wird es nur traurig.

## Stand

Schritt 6 (Agenten-Verwaltung) und 7 (Tierarten und Rollen) sind im Test (siehe [PLAN.md](PLAN.md), dort steht auch die geplante Erweiterung zu mehreren Agenten).

Funktioniert:
- Transparentes, rahmenloses Fenster, immer im Vordergrund, nicht in der Taskleiste
- Pixel-Nacktmull in Vorderansicht, beim Laufen in Seitenansicht
- Animationen: idle, laufen, schlafen, fressen, traurig
- Hunger: sinkt ueber 8 Stunden aktiver Zeit von voll auf leer, Pause haelt ihn an; wird gespeichert
- Stimmung in drei Stufen: ueber 60 % froehlich, ab 20 % normal, darunter traurig
- Klick auf das Tier oeffnet ein Panel mit Stimmung, Sattheit und Aktionen
- Ziehen setzt ein Ziel, das Tier laeuft ueber den ganzen Bildschirm dorthin
- Tray-Icon mit Menue (dasselbe Menue per Rechtsklick auf das Tier)
- Globaler Hotkey `Ctrl+Shift+P` blendet das Tier ein und aus
- Autostart mit Windows (schaltbar)
- Mehrere Agenten, je ein eigenes Fenster mit eigenem Hunger und eigener Futterquelle
- Agenten-Verwaltung (Panel, Tray-Menue oder Rechtsklick auf "Einstellungen"): Agent anlegen, Name, Tierart und Rolle waehlen, deaktivieren, loeschen; GitHub-Benutzername, -Token, Intervall und Futter pro Commit je Agent; global Hunger-Dauer und Hotkey
- Deaktivierte Agenten haben kein Fenster und werden nicht hungriger, bleiben aber im Tray-Menue unter "Agenten" und lassen sich dort wieder einschalten
- Tierarten: Nacktmull, Katze, Hund, Echse, Schlange, Vogel, Maulwurf (je Vorder- und Seitenansicht, alle Animationen)
- Rollen mit Accessoire: Informatiker (Laptop), Finanzen (Whiteboard mit Graph), Lernen (Buch), Fitness (Hantel), Gewohnheiten (Checkliste), Eigene (Accessoire frei)
- GitHub-Anbindung: neue Pushes des eingetragenen Benutzers werden abgefragt (Standard alle 10 Minuten); jeder neue Commit bringt 25 % Futter, dazu eine Sprechblase "N Commits heute!"

Noch nicht gebaut:
- Manuelle Eintraege, Fokus-Timer, Finanz-Budget (Schritt 8)
- Schlafmodus und Nest (Schritt 9), gespeicherte Seiten und Terminal-Befehle (Schritt 10)
- Laufen auf Fensterkanten (Schritt 11)
- Installer und Release (Schritt 12)

## Voraussetzungen (Windows)

- Node.js (getestet mit 24)
- Rust ueber [rustup](https://rustup.rs)
- Visual Studio Build Tools mit der Workload "Desktopentwicklung mit C++"
- WebView2 (unter Windows 11 vorhanden)

## Starten

```
npm install
npm run tauri dev
```

Der erste Build kompiliert alle Rust-Abhaengigkeiten und dauert einige Minuten.

Produktions-Build (Installer):

```
npm run tauri build
```

## Bedienung

| Aktion | Wirkung |
| --- | --- |
| Klick auf das Tier | Panel oeffnen oder schliessen |
| Ziehen und loslassen | Tier laeuft zur losgelassenen Stelle, ueberall auf dem Bildschirm |
| Rechtsklick auf das Tier | Menue (wie im Tray) |
| Linksklick auf das Tray-Icon | Tier ein- oder ausblenden |
| `Ctrl+Shift+P` | Tier ein- oder ausblenden |

## Dev-Tasten

Nur im Dev-Modus, das Fenster braucht dafuer den Fokus (einmal anklicken):

| Taste | Wirkung |
| --- | --- |
| `1` bis `5` | Animation erzwingen: idle, laufen, schlafen, fressen, traurig |
| `0` | Zurueck zur Automatik |
| `F` | Futter geben |
| `H` | Hunger um 20 % senken |
| `G` | GitHub sofort abfragen |

Dazu im Dev-Modus: `http://localhost:1420/?sheet` im Browser zeigt alle Arten, Animationen und Accessoires nebeneinander (zum Justieren der Sprites).

## Aufbau

Jedes Tier ("Agent") hat ein eigenes kleines Fenster. Die ganze Logik laeuft in einem unsichtbaren Hub-Fenster;
die Agent-Fenster zeigen nur an und melden Eingaben (Details in [PLAN.md](PLAN.md)).

```
src/
  main.tsx          waehlt anhand der URL (?hub, ?agent=<id>, ?settings, ?ghost) die Ansicht
  Hub.tsx           unsichtbares Fenster, startet hubLogic.ts
  hubLogic.ts       Hunger-Takt, Tracker-Abfragen, Agent-Fenster oeffnen und schliessen
  AgentWindow.tsx   Fenster eines Tiers: Klick, Ziehen, Laufen, Panel, Vorschau
  Pet.tsx           Canvas, spielt die Animationen ab
  Panel.tsx         Status-Panel
  SettingsWindow.tsx  Agenten-Verwaltung und globale Einstellungen
  roles.ts          Rollen (Vorlagen) mit Accessoire und Standard-Tracker
  species.ts        Tierarten: Paletten, Formen, Ankerpunkte
  accessories.ts    Accessoires als Ueberlagerung
  draw.ts           Zeichenhilfen und gemeinsame Typen
  Sheet.tsx         Dev-Ansicht aller Sprites (?sheet)
  Ghost.tsx         halbtransparente Zielvorschau beim Ziehen
  agents.ts         Agentenmodell, Speicher, Migration vom alten Einzel-Mull
  settings.ts       globale Einstellungen (Hotkey, Hunger-Dauer)
  protocol.ts       Nachrichten zwischen Hub und Agent-Fenstern
  behavior.ts       Stimmung, Laufen
  githubTracker.ts  GitHub abfragen, neue Commits erkennen
  github.ts         GitHub-API (Events, Vergleich)
  store.ts          gespeicherter Zustand
  sprites.ts        Posen und Animationen, setzt Art und Accessoire zusammen (64x64)
src-tauri/
  src/lib.rs        Tray, Menue, Hotkey, Autostart, Agent-Fenster, Befehle
```

Der gespeicherte Zustand liegt in `%APPDATA%\de.wendelinstadler.commitmull\state.json`. Beim ersten Start der Agenten-Version wird der bisherige Mull dort als Agent "Informatiker" uebernommen (Hunger und GitHub-Zustand bleiben erhalten, die alten Schluessel werden nicht geloescht).
