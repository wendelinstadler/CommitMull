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
- **Hub-Fenster** (unsichtbar, laeuft immer): hier liegt die ganze Logik. Das Verwaltungsfenster bleibt ein eigenes Fenster (`settings`).
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
Typen, Standardwerte und die Berechnung der Panel-Anzeige liegen in `src/trackers.ts`; alle Daten schreibt nur der Hub.
- **Abfragende Tracker** (GitHub): Vertrag `PollPlugin` in `src/trackerPlugins.ts` (`ready`, `intervalMs`, `poll` gibt ein Futter-Ereignis `{ amount, text }` oder null zurueck).
  Der Hub fragt pro Agent und Tracker nach und startet die Abfrage nur neu, wenn sich die Einstellungen aendern.
- **Eingabe-Tracker:**
  - `entries`: manuelle Eintraege, entweder Ausgaben mit Wochenbudget (Montag bis Sonntag) oder Haken. Gespeichert unter `entries:<agentId>`,
    jeder Eintrag gibt Futter (einstellbar). "Letzten Eintrag zuruecknehmen" loescht den Eintrag, das Futter bleibt.
  - `focus`: Fokus-Timer. Start und Stopp im Panel, pro volle Zeitspanne (15 bis 60 Min) Futter; Sitzungen unter `focus:<agentId>`.
    Ein laufender Timer ueberlebt keinen Neustart der App und stoppt, wenn der Agent deaktiviert wird.
- **Anzeige:** Der Hub schickt mit dem Zustand eine fertig berechnete Sicht (`TrackerViews`) ans Tierfenster; das Panel zeigt sie an.
  Das Whiteboard des Finanz-Agenten faerbt den Verlauf gruen (unter Budget) oder rot (darueber).
- Neuer Tracker = Typ und Standardwerte in `trackers.ts`, Anzeige im Panel, Konfiguration in der Verwaltung, bei Abfragen ein `PollPlugin`.
- Rollen-Vorlagen (`src/roles.ts`) legen die Start-Tracker fest: Informatiker GitHub, Finanzen Ausgaben, Lernen Fokus-Timer, Fitness und Gewohnheiten Haken.

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
4. Einstellungsfenster (global: Hotkey, Token, Intervall, Hunger, Futter)  (fertig; wurde zur Basis der Verwaltung)
5. Umbau: Hub und Agent-Fenster, Datenmodell, Migration. Aussehen unveraendert, ein Agent.  (fertig)
6. Agenten-Verwaltung: anlegen, bearbeiten, deaktivieren (bleibt im Tray-Menue), loeschen, Name, Art und Rolle waehlen  (im Test)
7. Sprite-System: 7 Arten (Vierbeiner als Daten, Vogel und Schlange eigene Zeichner) und 6 Rollen mit Accessoires  (im Test)
8. Hauptfenster als Startseite der App: alle Tiere als Karten mit Schalter, "Neues Tier", "Bearbeiten"  (im Test)
9. Tracker-System: GitHub portiert, manuelles Eintragen (Ausgaben mit Wochenbudget, Haken), Fokus-Timer; Whiteboard zeigt den Budgetstand  (im Test)
10. Schlafmodus + Nest, "Alle schlafen" per Tray und Hotkey
11. Aktionen: gespeicherte Seiten, Terminal-Befehle mit Bestaetigung
12. Pakete: Tiere und Agenten als Datei exportieren und importieren, mit strenger Pruefung (siehe unten)
13. Fensterkanten (WinAPI EnumWindows), faellt runter, wenn das Fenster verschwindet
14. Release: Installer bauen, GitHub-Release
15. Spaeter, eigenes Projekt: Online-Marktplatz auf Basis der Pakete (Konten, Hochladen, Pruefung, Meldefunktion)

Nach jedem Schritt laeuft `npm run tauri dev`, README.md wird nachgezogen, dann Pause zum Testen.

## Hauptfenster (Schritt 8)
Die App hat eine Startseite (Fenster `home`): Karten aller Tiere mit Bild, Name, Rolle und einem Schalter (aktiv/deaktiviert),
"Bearbeiten" oeffnet die Verwaltung beim jeweiligen Tier, "Neues Tier" legt eines an. Schliessen versteckt das Fenster,
die App lebt im Tray weiter ("Tiere verwalten" oeffnet es wieder). Beim Start mit Windows (Argument `--autostart`) bleibt es zu.

## Pakete und Marktplatz (Schritt 12, spaeter 15)
Ziel: Eigene Tiere und Agenten (z. B. ein Kunst-Agent) teilen, ohne dass ein Paket Schaden anrichten kann.
Entscheidung: Pakete enthalten **nur Daten, nie Code**.
- Format: Zip mit `pack.json` plus PNG-Bildern fuer Sprites (Endung z. B. `.cmpack`). Inhalt: Tierart (Farben, Bilder je Animation),
  Rolle (Name, Accessoire-Bild), Agent-Vorlage (Name, Art, Rolle, Einstellungen fuer **vorhandene** Tracker).
  Keine Befehle, keine Links, keine Skripte, keine ausfuehrbaren Dateien.
- Pruefung in Rust vor dem Laden, alles nach dem Prinzip "nur Erlaubtes": Groessenlimits (Zip, Eintraege, entpackte Groesse,
  Kompressionsfaktor gegen Zip-Bomben), nur `.json` und `.png`, keine Pfade mit `..`, absolute Pfade oder Symlinks,
  `pack.json` gegen ein festes Schema (unbekannte Felder abgelehnt, Textlaengen und Zeichen begrenzt),
  PNGs werden dekodiert und muessen die erwartete Groesse haben (64x64 je Bild), Tracker nur aus der eingebauten Liste.
- Vor dem Installieren zeigt die App eine Vorschau (Name, Autor, Inhalt, animiertes Tier) und fragt nach; Pakete lassen sich wieder entfernen.
- Pakete werden nur als Daten gezeichnet (der gemeinsame Sprite-Zeichner liest Bilder und Farben), sie koennen nichts ausfuehren.
- Online-Marktplatz (Schritt 15): eigener Server, Konten, Pruefung vor Veroeffentlichung, Pruefsumme je Paket,
  Meldefunktion. Die App laedt dort nur Pakete, die durch dieselbe lokale Pruefung gehen.

## Dev-Tasten (geplant)
`1`-`5` Animation, `0` Automatik, `F` Futter, `H` Hunger senken, `G` GitHub abfragen (bestehend);
neu: `Tab` naechsten Agenten waehlen, `S` Schlafmodus des gewaehlten Agenten, `Shift+S` alle schlafen.

## Entscheidungen

- Name: CommitMull, das Tier stirbt nie
- Rechtsklick auf das Tier oeffnet dasselbe Menue wie das Tray-Icon
- Ziehen setzt ein Ziel, das Tier laeuft dorthin (mit Vorschau); GitHub ohne Token startet ohne Futter-Schwemme
