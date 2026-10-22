use std::sync::Mutex;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

const DEFAULT_HOTKEY: &str = "Ctrl+Shift+P";

/// Aktuell registrierter Hotkey zum Ein-/Ausblenden.
struct Hotkey(Mutex<Option<Shortcut>>);

/// Menue und seine Check-Eintraege, geteilt zwischen Tray-Icon und Rechtsklick am Tier.
struct PetMenu {
    menu: Menu<Wry>,
    pause: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    /// Untermenue mit allen Agenten (auch deaktivierten); der Hub haelt es aktuell.
    agents: Submenu<Wry>,
}

const AGENT_PREFIX: &str = "agent-";

fn agent_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(AGENT_PREFIX))
        .map(|(_, window)| window)
        .collect()
}

/// Blendet alle Agenten ein oder aus: Ist mindestens einer sichtbar, werden alle versteckt.
fn toggle_visible(app: &AppHandle) {
    let windows = agent_windows(app);
    let any_visible = windows.iter().any(|w| w.is_visible().unwrap_or(false));
    for window in windows {
        let _ = if any_visible { window.hide() } else { window.show() };
    }
}

/// Setzt das Fenster in die untere rechte Ecke des Arbeitsbereichs (ueber der Taskleiste);
/// jeder weitere Agent steht eine Fensterbreite weiter links.
fn place_bottom_right(window: &WebviewWindow, slot: i32) {
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let Ok(size) = window.outer_size() else { return };
    let area = monitor.work_area();
    let x = (area.position.x + area.size.width as i32 - size.width as i32 * (slot + 1)).max(area.position.x);
    let y = area.position.y + area.size.height as i32 - size.height as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Agent-Ids werden Teil des Fensternamens und der URL: nur Buchstaben, Ziffern, - und _.
fn valid_agent_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Oeffnet das Fenster eines Agenten (tut nichts, wenn es schon offen ist).
#[tauri::command]
async fn open_agent_window(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_agent_id(&id) {
        return Err(format!("Ungueltige Agent-Id: {id}"));
    }
    let label = format!("{AGENT_PREFIX}{id}");
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let slot = agent_windows(&app).len() as i32;
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html?agent={id}").into()))
        .title("CommitMull")
        .inner_size(170.0, 190.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    place_bottom_right(&window, slot);
    window.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_agent_window(app: AppHandle, id: String) {
    if let Some(window) = app.get_webview_window(&format!("{AGENT_PREFIX}{id}")) {
        let _ = window.destroy();
    }
}

#[derive(serde::Deserialize)]
struct AgentEntry {
    id: String,
    name: String,
    visible: bool,
}

/// Baut das Agenten-Untermenue neu auf: pro Agent ein Haken (an = aktiv). Ein Klick geht als
/// Ereignis `agent-toggle` an den Hub, der den Agenten ein- oder ausschaltet.
#[tauri::command]
fn set_agent_menu(app: AppHandle, agents: Vec<AgentEntry>) -> Result<(), String> {
    let menu = app.try_state::<PetMenu>().ok_or("Menue noch nicht bereit")?;
    let err = |e: tauri::Error| e.to_string();
    for item in menu.agents.items().map_err(err)? {
        menu.agents.remove(&item).map_err(err)?;
    }
    let mut count = 0;
    for agent in agents.iter().filter(|a| valid_agent_id(&a.id)) {
        let item = CheckMenuItem::with_id(&app, format!("agent:{}", agent.id), &agent.name, true, agent.visible, None::<&str>)
            .map_err(err)?;
        menu.agents.append(&item).map_err(err)?;
        count += 1;
    }
    if count == 0 {
        let empty = MenuItem::with_id(&app, "no-agents", "Keine Agenten", false, None::<&str>).map_err(err)?;
        menu.agents.append(&empty).map_err(err)?;
    }
    Ok(())
}

/// Pause-Zustand. Die Fenster laden teils vor `setup`; dann ist noch nicht pausiert.
#[tauri::command]
fn get_paused(app: AppHandle) -> bool {
    app.try_state::<PetMenu>()
        .map(|menu| menu.pause.is_checked().unwrap_or(false))
        .unwrap_or(false)
}

/// Registriert den Hotkey neu. Der alte bleibt aktiv, wenn der neue ungueltig oder belegt ist.
fn register_hotkey(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("Ungueltiger Hotkey: {e}"))?;
    let state = app.state::<Hotkey>();
    let mut current = state.0.lock().map_err(|_| "Hotkey-Zustand gesperrt".to_string())?;
    if *current == Some(shortcut) {
        return Ok(());
    }
    let shortcuts = app.global_shortcut();
    shortcuts
        .register(shortcut)
        .map_err(|e| format!("Hotkey konnte nicht registriert werden: {e}"))?;
    if let Some(old) = current.take() {
        let _ = shortcuts.unregister(old);
    }
    *current = Some(shortcut);
    Ok(())
}

/// Hotkey aus den gespeicherten Einstellungen (state.json), sonst der Standard.
fn saved_hotkey(app: &AppHandle) -> String {
    app.store("state.json")
        .ok()
        .and_then(|store| store.get("settings"))
        .and_then(|settings| settings.get("hotkey").and_then(|h| h.as_str().map(String::from)))
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
}

#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    register_hotkey(&app, &hotkey)
}

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        // Das Fenster laedt dabei den gespeicherten Stand neu (verwirft ungespeicherte Eingaben).
        let _ = app.emit_to("settings", "settings-opened", ());
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
fn show_pet_menu(window: tauri::Window, menu: tauri::State<PetMenu>) {
    let _ = window.popup_menu(&menu.menu);
}

/// Pause setzen (vom Panel aus); das Haekchen im Menue und das Frontend bleiben synchron.
#[tauri::command]
fn set_paused(app: AppHandle, menu: tauri::State<PetMenu>, paused: bool) {
    let _ = menu.pause.set_checked(paused);
    let _ = app.emit("pause-changed", paused);
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Gibt den tatsaechlichen Zustand zurueck (bei Fehler der alte).
#[tauri::command]
fn set_autostart(app: AppHandle, menu: tauri::State<PetMenu>, enabled: bool) -> bool {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    let actual = if result.is_ok() { enabled } else { !enabled };
    let _ = menu.autostart.set_checked(actual);
    actual
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    let state = app.state::<PetMenu>();
    match id {
        "toggle" => toggle_visible(app),
        "pause" => {
            let paused = state.pause.is_checked().unwrap_or(false);
            let _ = app.emit("pause-changed", paused);
        }
        "autostart" => {
            let wanted = state.autostart.is_checked().unwrap_or(false);
            let launcher = app.autolaunch();
            let result = if wanted { launcher.enable() } else { launcher.disable() };
            if result.is_err() {
                // Zustand zurueckdrehen, damit das Haekchen stimmt
                let _ = state.autostart.set_checked(!wanted);
            }
        }
        "settings" => show_settings(app),
        "quit" => app.exit(0),
        other => {
            if let Some(agent_id) = other.strip_prefix("agent:") {
                let _ = app.emit_to("hub", "agent-toggle", agent_id.to_string());
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_visible(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            show_pet_menu,
            set_paused,
            get_autostart,
            set_autostart,
            quit_app,
            set_hotkey,
            open_settings,
            open_agent_window,
            close_agent_window,
            set_agent_menu,
            get_paused
        ])
        // Das Einstellungsfenster wird nur versteckt, damit es sich wieder oeffnen laesst.
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "Anzeigen / Ausblenden", true, None::<&str>)?;
            let pause = CheckMenuItem::with_id(app, "pause", "Pausieren", true, false, None::<&str>)?;
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart = CheckMenuItem::with_id(
                app,
                "autostart",
                "Autostart mit Windows",
                true,
                autostart_on,
                None::<&str>,
            )?;
            let agents = Submenu::with_id(app, "agents", "Agenten", true)?;
            let settings = MenuItem::with_id(app, "settings", "Einstellungen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &agents, &pause, &autostart, &settings, &sep, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("CommitMull")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_visible(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(PetMenu { menu, pause, autostart, agents });

            // Das Geisterfenster (Zielvorschau beim Ziehen) soll Mausklicks durchlassen.
            if let Some(ghost) = app.get_webview_window("ghost") {
                let _ = ghost.set_ignore_cursor_events(true);
            }

            app.manage(Hotkey(Mutex::new(None)));
            let accelerator = saved_hotkey(app.handle());
            if let Err(e) = register_hotkey(app.handle(), &accelerator) {
                eprintln!("{e}");
                if accelerator != DEFAULT_HOTKEY {
                    let _ = register_hotkey(app.handle(), DEFAULT_HOTKEY);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CommitMull konnte nicht gestartet werden");
}
