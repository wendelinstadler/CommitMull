# Handoff - CommitMull

Stand: 2026-10-21. Schritt 1 von 6 aus PLAN.md ist geschrieben, aber noch nicht gestartet.

## Was funktioniert / was geprueft ist

- Frontend: `npx tsc` und `npx vite build` laufen ohne Fehler.
- NICHT geprueft: der gesamte Rust-Teil (`src-tauri/`). Rust und die VS Build Tools waren auf dem Rechner nicht installiert, daher wurde nie `cargo build` ausgefuehrt. Erwartbar sind kleine Compilerfehler (API-Details von Tauri 2, z.B. `popup_menu`, `CheckMenuItem::is_checked`, `on_menu_event` am Builder).
- Das Tier wurde noch nie gesehen. Sprite-Proportionen und Positionen in `src/sprites.ts` sind nach Gefuehl gesetzt und wahrscheinlich nachzujustieren.

## Voraussetzungen (Windows)

- Node 24 (vorhanden), Git (vorhanden), WebView2 (vorhanden)
- Fehlend: Visual Studio Build Tools (Workload "Desktopentwicklung mit C++") und Rust via rustup
- Optional: GitHub CLI

## Starten

```
npm install
npm run tauri dev
```

Im Dev-Modus schalten die Tasten 1-5 durch idle / laufen / schlafen / essen / traurig.

## Architektur in Kurzform

- `src-tauri/src/lib.rs`: Tray-Icon, Menue (geteilt mit Rechtsklick ueber den Command `show_pet_menu`), globaler Hotkey Ctrl+Shift+P, Autostart-Plugin. Menue-Events `pause-changed` (bool) und `open-settings` gehen als Tauri-Events ans Frontend.
- `src/App.tsx`: Drag (startDragging nach 4 px Bewegung), Klick = Sprechblase, Rechtsklick = Menue, Pause = Schlafen.
- `src/sprites.ts`: Nacktmull wird prozedural mit Rechtecken/Ellipsen auf ein 64x64-Canvas gezeichnet. Animationen sind Listen von `Pose`-Objekten in `FRAMES`, Tempo in `FRAME_MS`.
- Fenster: 170x190, transparent, rahmenlos, immer oben, nicht in der Taskleiste (`tauri.conf.json`).

## Bekannte Luecken / Platzhalter

- "Einstellungen" im Menue sendet nur das Event `open-settings`, es gibt noch kein Fenster.
- Pausieren laesst das Tier schlafen, aber es gibt noch keinen Hunger, der stoppen koennte.
- Icons in `src-tauri/icons/` sind generierte Platzhalter (kein `256x256.png`, `icon.ico` bettet ein 256er-PNG ein). Spaeter mit `npx tauri icon <bild.png>` ersetzen.
- Der Hotkey ist fest verdrahtet; schlaegt die Registrierung fehl, wird nur auf stderr geloggt.
- Das Tier blickt immer nach rechts (`facing` ist vorbereitet, CSS-Klasse `flip`).

## Naechste Schritte

1. Rust/Build Tools installieren, `npm run tauri dev`, Compilerfehler beheben, Tier ansehen und Sprite feinjustieren.
2. Zustand und Verhalten: `tauri-plugin-store` fuer Hunger, Position, Einstellungen; Hunger sinkt ueber den Tag, Pause stoppt ihn; Stimmung (satt = froehlich, leer = traurig, nie tot); Laufen am unteren Bildschirmrand (Taskleisten-Oberkante, `facing` je nach Richtung).
3. GitHub: Events/Commits-API fuer `wendelinstadler` alle 10 Min, neue Commits = Futter (gesehene Commit-SHAs speichern, sonst wird doppelt gefuettert), optionaler Token, Sprechblase "N Commits heute!".
4. Einstellungsfenster (Token, Intervall, Hunger-Rate, Hotkey).
5. Laufen auf Fensterkanten (WinAPI `EnumWindows`), faellt runter, wenn das Fenster verschwindet.
6. Installer bauen, Release auf GitHub.

## Entscheidungen des Nutzers

- Tier: Nacktmull, Name: CommitMull
- Auch auf Fensterkanten laufen (Schritt 5)
- Rechtsklick auf das Tier oeffnet dasselbe Menue wie das Tray-Icon
- Repo: https://github.com/wendelinstadler/CommitMull
