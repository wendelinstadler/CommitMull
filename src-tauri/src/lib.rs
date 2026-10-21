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

#[tauri::command]
fn show_pet_menu(window: tauri::Window, menu: tauri::State<PetMenu>) {
    let _ = window.popup_menu(&menu.menu);
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
        .invoke_handler(tauri::generate_handler![show_pet_menu])
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

            let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyP);
            if let Err(e) = app.global_shortcut().register(hotkey) {
                eprintln!("Hotkey Ctrl+Shift+P konnte nicht registriert werden: {e}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CommitMull konnte nicht gestartet werden");
}
