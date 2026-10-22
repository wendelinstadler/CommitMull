use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Menue und seine Check-Eintraege, geteilt zwischen Tray-Icon und Rechtsklick am Tier.
struct PetMenu {
    menu: Menu<Wry>,
    pause: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

fn toggle_visible(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
    }
}

/// Setzt das Fenster in die untere rechte Ecke des Arbeitsbereichs (ueber der Taskleiste).
fn place_bottom_right(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let Ok(size) = window.outer_size() else { return };
    let area = monitor.work_area();
    let x = area.position.x + area.size.width as i32 - size.width as i32;
    let y = area.position.y + area.size.height as i32 - size.height as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
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
        "settings" => {
            let _ = app.emit("open-settings", ());
        }
        "quit" => app.exit(0),
        _ => {}
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
            quit_app
        ])
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
            let settings = MenuItem::with_id(app, "settings", "Einstellungen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &pause, &autostart, &settings, &sep, &quit])?;

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

            app.manage(PetMenu { menu, pause, autostart });

            place_bottom_right(app.handle());

            // Das Geisterfenster (Zielvorschau beim Ziehen) soll Mausklicks durchlassen.
            if let Some(ghost) = app.get_webview_window("ghost") {
                let _ = ghost.set_ignore_cursor_events(true);
            }

            let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyP);
            if let Err(e) = app.global_shortcut().register(hotkey) {
                eprintln!("Hotkey Ctrl+Shift+P konnte nicht registriert werden: {e}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CommitMull konnte nicht gestartet werden");
}
