# CommitMull - Plan

Desktop-Pixel-Haustier (Nacktmull) fuer Windows. Tauri 2 + React + TypeScript.
Das Tier lebt von deinen GitHub-Commits (User: wendelinstadler).

## Struktur

```
PixCommit/
  index.html
  package.json / vite.config.ts / tsconfig.json
  src/                      Frontend (React)
    main.tsx                Einstieg
    App.tsx                 Fenster-Logik: Drag, Klick, Rechtsklick, Sprechblase, Zustand
    Pet.tsx                 Canvas-Komponente, spielt Animationen ab
    sprites.ts              Nacktmull als 64x64 Pixel-Zeichnung + Frames pro Animation
    styles.css
    (spaeter) store.ts      Zustand laden/speichern (Hunger, Position, Einstellungen)
    (spaeter) github.ts     Commits abfragen
    (spaeter) behavior.ts   Hunger-Logik, Laufen, Stimmung
    (spaeter) Settings.tsx  Einstellungsfenster
  src-tauri/                Backend (Rust)
    tauri.conf.json         Fenster: transparent, rahmenlos, immer oben, nicht in Taskleiste
    capabilities/default.json
    src/lib.rs              Tray, Menue, Hotkey, Autostart, Kontextmenue-Command
    src/main.rs
```

## Schritte

1. Fenster + Sprite + Tray-Menue + Hotkey + Autostart  (jetzt)
   - transparentes Fenster, Drag, Sprechblase beim Klick, Rechtsklick-Menue
   - Animationen idle / laufen / schlafen / essen / traurig
   - Tray: Anzeigen/Ausblenden, Pausieren, Autostart, Einstellungen, Beenden
   - Ctrl+Shift+P blendet ein/aus
2. Zustand + Verhalten
   - lokaler Speicher (tauri-plugin-store): Hunger, Position, Einstellungen
   - Hunger sinkt ueber den Tag, Pause stoppt ihn, Stimmung (satt/leer)
   - Laufen am unteren Bildschirmrand (Taskleisten-Oberkante)
3. GitHub
   - Commits von wendelinstadler alle 10 Min abfragen (Events API), neue Commits = Futter
   - optionaler Token in den Einstellungen
   - "3 Commits heute!" in der Sprechblase
4. Einstellungsfenster
   - Token, Intervall, Hunger-Rate, Hotkey
5. Fensterkanten
   - Tier laeuft auch auf Oberkanten anderer Fenster (WinAPI EnumWindows), faellt runter wenn das Fenster verschwindet
6. Release
   - Installer bauen, GitHub-Repo mit Release

## Entscheidungen

- Name: CommitMull, Tier: Nacktmull
- Rechtsklick auf das Tier oeffnet dasselbe Menue wie das Tray-Icon
- Das Tier stirbt nie, es wird nur traurig
