# CommitMull - Plan

Desktop-Pixel-Haustiere fuer Windows. Tauri 2 + React + TypeScript.
Aus dem einen Nacktmull werden mehrere "Agenten": Jeder Agent ist ein Tier mit eigener Aufgabe,
eigenem Aussehen und eigener Futterquelle (GitHub-Commits, manuelle Eintraege, Fokuszeit).

## Gleich bleibt

- Tiere sterben nie, sie werden nur traurig.
- Hunger, Stimmung (3 Stufen), Animationen, Ziehen/Laufen, Panel, Tray, Hotkey, Autostart - jetzt pro Agent.
- Pixel-Art 64x64 auf Canvas (sprites.ts), deutsche Texte und Kommentare.
- Bestehender Zustand in state.json wird migriert, nicht geloescht. Der bisherige Mull wird der Agent "Informatiker".

## Architektur

### Fenster
- **Ein Fenster pro Agent** (`agent-<id>`, 170x190, transparent, immer oben). Das jetzige Fenster ist schon so gebaut,
  Ziehen, Laufen, Panel und Vorschau-Geist funktionieren pro Fenster unveraendert. Eine grosse Vollbild-Ueberlagerung
  waere dagegen auf Windows nur mit aufwendigem Hit-Testing klickdurchlaessig zu bekommen.
- **Hub-Fenster** (unsichtbar, laeuft immer, dient zugleich als Verwaltungsfenster): hier liegt die ganze Logik.
  Die Agent-Fenster zeigen nur an und melden Eingaben (Klick, Ziehen, Panel-Aktionen).
  - Hunger-Takt, Stimmung, Schlafzustand: ein einziger Schreiber, keine Konflikte zwischen Fenstern.
  - Tracker laufen hier: ein GitHub-Abruf pro Benutzer statt einer pro Fenster (Rate-Limit 60/h ohne Token).
  - "Alle schlafen schicken", Tray-Menue und Hotkeys sind Befehle an den Hub.
- Ein gemeinsames **Geisterfenster** fuer die Zielvorschau (wie bisher), kleine **Nestfenster** (klickdurchlaessig).
- Kommunikation ueber Tauri-Events: `agent-state` (Hub an Agent), `agent-cmd` (Agent an Hub).
- Mehrere Webviews kosten Speicher (grob 50-100 MB je Fenster). Fuer 3-5 Agenten in Ordnung.

### Datenmodell (state.json)
- `settings`: global (Hotkeys, Autostart, Standard-Hungerdauer).
- `agents`: Liste der Agent-Konfigurationen (id, name, species, role, trackers, links, commands, visible, nest).
- `agentState:<id>`: Hunger, Position, schlaeft, Nestposition. Schreiber ist nur der Hub.
- `tracker:<agentId>:<trackerId>`: gesehene Events, Zaehler (z. B. GitHub-Event-IDs).
- Tracker-Daten der Eintrags-Tracker (Ausgaben, Haekchen): `entries:<agentId>`.

### Tracker-Schnittstelle
Gemeinsamer Vertrag in `src/trackers/`: jeder Tracker liefert Futter-Ereignisse `{ amount, label }`.
- `poll(config, state)` fuer abfragende Tracker (GitHub): gibt neue Ereignisse und neuen Tracker-Zustand zurueck.
- `entry(config, input)` fuer manuelle Tracker: ein Eintrag ergibt ein Ereignis.
- `summary(config, state)` liefert die Anzeige fuers Panel (z. B. "3 Commits heute", "Ausgaben 84 von 150 CHF").
- Neue Tracker = eine Datei plus Eintrag in einer Liste.
- Der Hub rechnet Ereignisse in Hunger-Anteile um (Futterwert pro Tracker einstellbar).

### Sprites
- Gemeinsames Pose-System bleibt (Hub, Beine, Augen, Mund, Traene, Zzz, Futter).
- Pro Tierart eine Beschreibung `Species`: Farben, Koerper-/Kopfform, Ohren, Schwanz, Schnauze usw. und
  Ankerpunkte (Kopf, Ruecken, Vorderpfoten, Boden) fuer Vorder- und Seitenansicht.
  Abweichler (Schlange ohne Beine, Vogel mit Fluegeln) bekommen eigene Zeichenfunktionen.
- Rollen zeichnen ein Accessoire als Ueberlagerung an den Ankerpunkten der Art.
- Rollen: Informatiker (Laptop), Finanzen (Whiteboard mit Graph), Vorschlaege: Lernen (Buch),
  Fitness (Hantel), Gewohnheiten (Checkliste), Eigene (Accessoire und Tracker frei waehlbar).
- Arten: Nacktmull, Katze, Hund, Echse, Schlange, Vogel, Maulwurf. Pixel-Art laesst sich nur mit Augen
  beurteilen: Die Arten kommen in Gruppen, du schaust jeweils drauf und wir justieren nach.

### Schlafmodus und Nest
- Befehl "schlafen schicken": Tier laeuft zum Nest, legt sich hin, Hunger steht still. Aufwecken: aufstehen, zurueck.
- Futter, das waehrend des Schlafs eintrifft, wird nicht verworfen, sondern beim Aufwachen gutgeschrieben.
- Nest: Position pro Agent gespeichert, Standard unten am Bildschirmrand, verschiebbar.
- "Alle schlafen schicken" ueber Tray-Menue und eigenen Hotkey.

### Aktionen und Sicherheit
- **Gespeicherte Seiten:** Oeffnen im Standardbrowser ueber das Opener-Plugin, nur `http` und `https`.
- **Terminal-Befehle:** Ausfuehrung ausschliesslich in Rust. Der Befehl wird per id aus dem Speicher gelesen,
  nie als Text vom Frontend uebernommen und nie aus externen Daten (GitHub-Antworten usw.).
  Start in einem neuen Terminalfenster (PowerShell, `-NoExit`), optional mit Arbeitsverzeichnis.
- **Bestaetigung:** Neue oder geaenderte Befehle (Text oder Ordner) fragen vor dem ersten Start nach;
  die Freigabe gilt nur fuer genau diesen Stand (Pruefsumme).
- **Berechtigungen:** keine Shell-Rechte fuer das Frontend, Fenster-Rechte nur fuer `agent-*`, `settings`, Hub;
  Opener-Rechte nur fuer URLs mit http/https.

### Migration
Beim ersten Start der neuen Version: Fehlt `agents`, wird der Agent "Informatiker" angelegt
(Nacktmull, Rolle Informatiker, GitHub-Tracker mit dem bisherigen Benutzernamen/Token/Intervall).
Hunger und GitHub-Zustand wandern in die neuen Schluessel. Die alten Schluessel bleiben stehen
(Rueckweg), ein Merker `migrated` verhindert Wiederholung.

## Schritte

1. Fenster + Sprite + Tray-Menue + Hotkey + Autostart  (fertig)
2. Zustand + Verhalten: Hunger, Stimmung, Panel, Laufen per Ziehen  (fertig)
3. GitHub: Commits als Futter  (fertig)
4. Einstellungsfenster (global: Hotkey, Token, Intervall, Hunger, Futter)  (in Arbeit; wird zur Basis der Verwaltung)
5. Umbau: Hub und Agent-Fenster, Datenmodell, Migration. Aussehen unveraendert, ein Agent.
6. Agenten-Verwaltung: anlegen, bearbeiten, ausblenden, loeschen, Name und Art waehlen (zunaechst nur Nacktmull)
7. Sprite-System: Arten (in Gruppen) und Rollen mit Accessoires
8. Tracker-System: GitHub portiert, manuelles Eintragen, Fokus-Timer; Finanz-Whiteboard und Budget
9. Schlafmodus + Nest, "Alle schlafen" per Tray und Hotkey
10. Aktionen: gespeicherte Seiten, Terminal-Befehle mit Bestaetigung
11. Fensterkanten (WinAPI EnumWindows), faellt runter, wenn das Fenster verschwindet
12. Release: Installer bauen, GitHub-Release

Nach jedem Schritt laeuft `npm run tauri dev`, README.md wird nachgezogen, dann Pause zum Testen.

## Dev-Tasten (geplant)
`1`-`5` Animation, `0` Automatik, `F` Futter, `H` Hunger senken, `G` GitHub abfragen (bestehend);
neu: `Tab` naechsten Agenten waehlen, `S` Schlafmodus des gewaehlten Agenten, `Shift+S` alle schlafen.

## Entscheidungen

- Name: CommitMull, das Tier stirbt nie
- Rechtsklick auf das Tier oeffnet dasselbe Menue wie das Tray-Icon
- Ziehen setzt ein Ziel, das Tier laeuft dorthin (mit Vorschau); GitHub ohne Token startet ohne Futter-Schwemme
