# CommitMull

Ein Desktop-Haustier fuer Windows: ein Pixel-Nacktmull, der auf dem Bildschirm lebt und von deinen GitHub-Commits gefuettert wird. Gebaut mit Tauri 2, React und TypeScript.

Das Tier stirbt nie. Wenn es lange nichts zu fressen gibt, wird es nur traurig.

## Stand

Schritt 3 von 6 ist fertig (siehe [PLAN.md](PLAN.md)).

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
- GitHub-Anbindung: alle 10 Minuten werden neue Pushes von `wendelinstadler` abgefragt; jeder neue Commit bringt 25 % Futter, dazu eine Sprechblase "N Commits heute!"

Noch nicht gebaut:
- Einstellungsfenster (Schritt 4)
- Laufen auf Fensterkanten (Schritt 5)
- Installer und Release (Schritt 6)

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

## Aufbau

```
src/
  App.tsx        Fenster-Logik: Klick, Ziehen, Zustand, Panel
  Pet.tsx        Canvas, spielt die Animationen ab
  Panel.tsx      Status-Panel
  behavior.ts    Hunger, Stimmung, Laufen
  commits.ts     GitHub abfragen, neue Commits erkennen
  github.ts      GitHub-API (Events, Vergleich)
  store.ts       Gespeicherter Zustand
  sprites.ts     Nacktmull als 64x64-Pixelzeichnung samt Frames
src-tauri/
  src/lib.rs     Tray, Menue, Hotkey, Autostart, Befehle
```

Der gespeicherte Zustand liegt in `%APPDATA%\de.wendelinstadler.commitmull\state.json`.
