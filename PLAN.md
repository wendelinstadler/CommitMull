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
- **Investments** (`invest`, Finanz-Agent): Depot mit Kuerzel, Stueckzahl und Kaufkurs je Position. Der Hub laedt die Kurse in einstellbarem
  Abstand (5 bis 60 Min) ueber den Rust-Befehl `fetch_quote` (Yahoo Finance, ohne Konto), rechnet fremde Waehrungen zum aktuellen Kurs in die
  Anzeigewaehrung um und zeigt im Panel Depotwert, Gewinn/Verlust, Tagesveraenderung und je Position Heute/Gesamt. Die letzten Kurse werden
  gespeichert (`quotes:<agentId>`), bei Ausfall bleiben sie stehen. Nur Anzeige, keine Anlageberatung, kein Futter.
  Sicherheit: Die Abfrage laeuft nur in Rust, nur gegen den Yahoo-Host, das Kuerzel wird streng geprueft (Buchstaben, Ziffern und . - = ^ _);
  eine Browser-Kennung ist noetig, die ein Webview nicht setzen darf.
- **Programm-Sperre** im Fokus-Timer: Sperrliste von Programmnamen (z. B. `discord.exe`). Solange der Timer laeuft, prueft der Hub alle 3 Sekunden
  (Rust-Befehl `find_blocked_apps`), ob ein gesperrtes Programm ein sichtbares Fenster hat. Dann warnt das Tier, nach der einstellbaren Frist
  (5, 10 oder 30 Sekunden) werden die Fenster sanft geschlossen (`WM_CLOSE`, wie ein Klick auf X: Programme fragen bei ungespeicherter Arbeit nach)
  und weiter geprueft. Kein hartes Beenden, keine Webseiten.
  Sicherheit: Es werden nur Programmnamen aus der selbst gespeicherten Liste angenommen (nur `name.exe`, keine Pfade, nur erlaubte Zeichen),
  Systemprogramme (explorer, dwm, svchost, taskmgr ...) und CommitMull selbst sind ausgenommen; der Befehl nimmt nichts aus externen Daten.
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

### Schlafmodus und Nest (umgesetzt)
- Phasen pro Agent (nur der Hub kennt sie): `awake`, `to-nest`, `asleep`, `back`. Gespeichert werden Nest, Platz vor dem Schlafen und
  "schlaeft" in `agentState:<id>`; nach einem App-Neustart im Schlaf wird das Tier direkt ins Nest gesetzt.
- Ablauf: Panel "Schlafen schicken" (oder Tray/Hotkey) -> Tierfenster klappt das Panel zu und meldet seine Position und das Nest ->
  Hub oeffnet das Nestfenster (`nest-<id>`, klickdurchlaessig) -> Tier laeuft hin, liegt im Nest. "Aufwecken": Nest verschwindet,
  Tier laeuft an den alten Platz. Waehrend des Schlafs steht der Hunger still, eintreffendes Futter wartet und wird beim Aufwecken gutgeschrieben.
- Nest verschieben: Panel "Nest verschieben" blendet das Nestfenster mit "Fertig" ein; ziehen, "Fertig" speichert die Position.
  Standard: unten am Bildschirmrand (Arbeitsbereich) unter dem Standort des Tiers.
- "Alle schlafen schicken / aufwecken": Tray-Eintrag und eigener Hotkey (Standard Strg+Umschalt+S, einstellbar unter Allgemein).
  Schlafen nicht alle, gehen alle sichtbaren Tiere schlafen, sonst werden alle geweckt.

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
10. Schlafmodus + Nest, "Alle schlafen" per Tray und Hotkey  (im Test)
    dazu: Programm-Sperre im Fokus (sanftes Schliessen) und Investments (Depot, Kurse von Yahoo Finance)  (im Test)
11. Begleiter im Arbeitsalltag, Teil 1: Tier mit mehreren Modi, neues Panel-Fenster mit Reitern (Heute, Aufgaben, Mehr), Aufgabenliste,
    Hinweise bei grossen Kursbewegungen  (im Test)
12. Begleiter, Teil 2: KI-Assistent mit eigenem Anthropic-Schluessel (Chat im Modus, Aufgaben aufteilen, Tagesplan, Depot erklaeren, Tagesrueckblick)  (im Test)
13. Aktionen: gespeicherte Seiten, Terminal-Befehle mit Bestaetigung
14. Pakete: Tiere und Agenten als Datei exportieren und importieren, mit strenger Pruefung (siehe unten)
15. Fensterkanten (WinAPI EnumWindows), faellt runter, wenn das Fenster verschwindet
16. Release: Installer bauen, GitHub-Release
17. Spaeter, eigenes Projekt: Online-Marktplatz auf Basis der Pakete (Konten, Hochladen, Pruefung, Meldefunktion)

Nach jedem Schritt laeuft `npm run tauri dev`, README.md wird nachgezogen, dann Pause zum Testen.

## Begleiter im Arbeitsalltag (Schritt 11 und 12)
Ziel: Das Tier begleitet durch den Arbeitstag, nicht nur ein Zaehler. Entscheidungen:
- **Ein Tier, mehrere Modi.** Ein Tier (`Agent`) hat Modi (`Mode`: Rolle, Accessoire, Futterquellen). Im Panel wechselt man mit einem Klick, der aktive Modus
  steht im Tierzustand (`agentState:<id>.mode`). Hunger, Schlaf, Nest, Aufgaben und Hinweise haengen am Tier; Eintraege, Kurse, Fokus und GitHub-Zustand am Modus
  (Schluessel mit der Modus-Id; der erste Modus traegt die Id des Tiers, so bleiben alle bisherigen Daten gueltig). Aeltere Speicherstaende (Rolle und Tracker direkt am Tier)
  werden beim Lesen umgewandelt. GitHub- und Kursabfragen laufen fuer alle Modi weiter, auch wenn gerade ein anderer aktiv ist.
- **Panel als eigenes Fenster** (`panel-<id>`, 392x600, neben dem Tier): Kopf mit Tier, Sattheit und Modus-Schalter; Reiter *Heute* (Hinweise und die Ansicht des aktiven Modus),
  *Aufgaben*, *Mehr* (Schlafen, Nest, Pausieren, Verwalten, Autostart, Beenden). Schliesst sich mit Esc oder beim Wegklicken. Das Tierfenster bleibt 170x190.
- **Aufgaben** gehoeren zum Tier (`todos:<id>`): hinzufuegen, abhaken, loeschen. Jede Aufgabe fuettert beim ersten Erledigen mit 10 %.
- **Hinweise** (`alerts:<id>`): Nach jeder Kursabfrage prueft der Hub das Depot: Tagesbewegung des Depots ab 3 % oder einer Position ab 5 % (einstellbar, 0 = aus)
  ergibt einen Hinweis in der Liste und eine Sprechblase am Tier, zum selben Ausloeser hoechstens alle 3 Stunden. Auch im anderen Modus.
- **KI (Schritt 12, umgesetzt):** eigener API-Schluessel von console.anthropic.com (eine Anmeldung mit dem Claude-Abo ist in fremden Apps nicht moeglich), sicher im
  Windows-Anmeldeinformationsspeicher, Abfragen nur aus Rust. Funktionen: Chat im aktuellen Modus, Aufgaben aufteilen und Tagesplan, Depot-Bewegung erklaeren
  (sendet die Positionen, nur auf Klick), Tagesrueckblick. Alle KI-Funktionen sind aus, bis ein Schluessel eingetragen und die Weitergabe bestaetigt ist.

### KI-Assistent im Detail
- **Zugang:** API-Schluessel in den Einstellungen (Allgemein, KI-Assistent). Er geht per `ai_set_key` direkt in den Windows-Anmeldeinformationsspeicher
  (Crate `keyring`), das Webview kann ihn weder lesen noch senden, nur "vorhanden?" abfragen (`ai_key_status`). Eingeschaltet wird der Assistent separat mit
  einer Bestaetigung, was gesendet wird; "Verbindung testen" schickt eine winzige Anfrage.
- **Anfragen nur aus Rust** (`src-tauri/src/ai.rs`, roher HTTP-Aufruf, Rust hat kein offizielles SDK): nur `api.anthropic.com`, nur die Modelle
  Opus 5.5 (Standard), Sonnet 5.5 und Haiku 5.5, Rollen, Anzahl und Groessen geprueft, `effort: low`, keine Sampling-Parameter. Bei Opus und Sonnet wird die serverseitige
  Ausweichroute (`fallbacks: "default"`) mitgeschickt; lehnt die API sie mit 400 ab, folgt einmal dieselbe Anfrage ohne. Ablehnungen (`refusal`) und Fehler
  (Schluessel, Limit, Ueberlastung) werden verstaendlich gemeldet, ohne Schluessel oder Eingaben zu nennen.
- **Was gesendet wird** (Datenschutz-Grundsatz, `src/ai.ts`): Chat nur die eigenen Nachrichten plus Name, Modus und Datum; Tagesplan und Aufgaben aufteilen die
  offenen Aufgaben (beim Aufteilen nur die eine); Rueckblick erledigte und offene Aufgaben, Fokuszeit, Ausgaben; "Depot erklaeren" die Positionen. Jeweils nur auf Klick.
  Der Depot-Prompt verlangt ehrliche Grenzen (keine aktuellen Nachrichten) und keine Anlageberatung.
- **Antworten werden nur als Text angezeigt** oder als Aufgabentext uebernommen (nach Vorschau), nie ausgefuehrt.
- **Panel:** Reiter "Assistent" mit Chat (Verlauf lokal je Tier und Modus, loeschbar) und Schnellaktionen; "Aufteilen" an offenen Aufgaben. Solange eine Antwort aussteht,
  schliesst das Wegklicken das Panel nicht.

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
