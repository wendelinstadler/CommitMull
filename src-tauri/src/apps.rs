//! Programmfenster auflisten und sanft schliessen (fuer die Programm-Sperre waehrend des Fokus).
//!
//! Sicherheit: Es werden nur Programmnamen (z. B. "discord.exe") angenommen, keine Pfade. Geschlossen wird mit WM_CLOSE,
//! also wie ein Klick auf das X: Programme fragen bei ungespeicherter Arbeit nach, nichts wird hart beendet.
//! Systemprogramme und CommitMull selbst sind gesperrt (PROTECTED).

use serde::Serialize;

/// Programme, die nie gesperrt oder geschlossen werden duerfen.
const PROTECTED: &[&str] = &[
    "explorer.exe",
    "dwm.exe",
    "csrss.exe",
    "winlogon.exe",
    "svchost.exe",
    "taskmgr.exe",
    "searchhost.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "applicationframehost.exe",
    "textinputhost.exe",
    "lockapp.exe",
    "sihost.exe",
    "ctfmon.exe",
    "msedgewebview2.exe",
    "commitmull.exe",
];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct OpenWindow {
    pub exe: String,
    pub title: String,
}

/// Programmname in Kleinbuchstaben, wenn er gueltig ist: nur Name.exe, keine Pfade, nicht geschuetzt.
pub fn normalize_exe(name: &str) -> Result<String, String> {
    let exe = name.trim().to_lowercase();
    let valid_chars = exe.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' ' | '+'));
    if exe.len() < 5 || exe.len() > 64 || !exe.ends_with(".exe") || !valid_chars || exe.starts_with('.') {
        return Err(format!("Ungueltiger Programmname: {name}"));
    }
    if PROTECTED.contains(&exe.as_str()) || own_exe().as_deref() == Some(exe.as_str()) {
        return Err(format!("{exe} kann nicht gesperrt werden."));
    }
    Ok(exe)
}

fn own_exe() -> Option<String> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
}

/// Alle sichtbaren Hauptfenster mit Titel und dem Programm, zu dem sie gehoeren.
#[cfg(windows)]
pub fn visible_windows() -> Vec<OpenWindow> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
    };

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = unsafe { &mut *(lparam.0 as *mut Vec<OpenWindow>) };
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || GetWindow(hwnd, GW_OWNER).is_ok_and(|w| !w.is_invalid()) {
                return BOOL(1);
            }
            let mut title = [0u16; 256];
            let len = GetWindowTextW(hwnd, &mut title);
            if len <= 0 {
                return BOOL(1);
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return BOOL(1);
            };
            let mut buf = [0u16; 520];
            let mut size = buf.len() as u32;
            let queried = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(process);
            if queried.is_err() {
                return BOOL(1);
            }
            let path = String::from_utf16_lossy(&buf[..size as usize]);
            let exe = path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
            if !exe.is_empty() {
                out.push(OpenWindow { exe, title: String::from_utf16_lossy(&title[..len as usize]) });
            }
        }
        BOOL(1)
    }

    let mut windows: Vec<OpenWindow> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut windows as *mut Vec<OpenWindow> as isize));
    }
    windows
}

#[cfg(not(windows))]
pub fn visible_windows() -> Vec<OpenWindow> {
    Vec::new()
}

/// Laufende Programme mit sichtbarem Fenster (je Programm ein Eintrag), ohne geschuetzte.
pub fn running_apps() -> Vec<OpenWindow> {
    let mut seen = std::collections::HashSet::new();
    let own = own_exe();
    visible_windows()
        .into_iter()
        .filter(|w| !PROTECTED.contains(&w.exe.as_str()) && own.as_deref() != Some(w.exe.as_str()))
        .filter(|w| seen.insert(w.exe.clone()))
        .collect()
}

/// Welche der Programme haben gerade ein sichtbares Fenster? (Namen schon normalisiert.)
pub fn find_open(exes: &[String]) -> Vec<String> {
    let open: std::collections::HashSet<String> = visible_windows().into_iter().map(|w| w.exe).collect();
    exes.iter().filter(|e| open.contains(e.as_str())).cloned().collect()
}

/// Schliesst alle sichtbaren Fenster des Programms (WM_CLOSE). Liefert die Zahl der angefragten Fenster.
#[cfg(windows)]
pub fn close_windows_of(exe: &str) -> usize {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GW_OWNER, WM_CLOSE,
    };

    struct Job<'a> {
        exe: &'a str,
        closed: usize,
    }

    unsafe extern "system" fn close_matching(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let job = unsafe { &mut *(lparam.0 as *mut Job) };
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || GetWindow(hwnd, GW_OWNER).is_ok_and(|w| !w.is_invalid()) {
                return BOOL(1);
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return BOOL(1);
            };
            let mut buf = [0u16; 520];
            let mut size = buf.len() as u32;
            let queried = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(process);
            if queried.is_ok() {
                let path = String::from_utf16_lossy(&buf[..size as usize]);
                let name = path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
                if name == job.exe && PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)).is_ok() {
                    job.closed += 1;
                }
            }
        }
        BOOL(1)
    }

    let mut job = Job { exe, closed: 0 };
    unsafe {
        let _ = EnumWindows(Some(close_matching), LPARAM(&mut job as *mut Job as isize));
    }
    job.closed
}

#[cfg(not(windows))]
pub fn close_windows_of(_exe: &str) -> usize {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_program_names() {
        assert_eq!(normalize_exe("Discord.exe").as_deref(), Ok("discord.exe"));
        assert_eq!(normalize_exe("  steam.exe ").as_deref(), Ok("steam.exe"));
        assert_eq!(normalize_exe("Some App-2.exe").as_deref(), Ok("some app-2.exe"));
    }

    #[test]
    fn rejects_paths_and_odd_names() {
        for bad in ["", ".exe", "discord", "discord.com", "C:\\Windows\\notepad.exe", "..\\x.exe", "a/b.exe", "x;y.exe", "x&y.exe", "$(x).exe"] {
            assert!(normalize_exe(bad).is_err(), "{bad} haette abgelehnt werden muessen");
        }
        assert!(normalize_exe(&format!("{}.exe", "a".repeat(80))).is_err());
    }

    #[test]
    fn rejects_system_and_own_programs() {
        for bad in ["explorer.exe", "EXPLORER.EXE", "dwm.exe", "svchost.exe", "commitmull.exe", "msedgewebview2.exe"] {
            assert!(normalize_exe(bad).is_err(), "{bad} muss geschuetzt sein");
        }
    }

    /// Echtes Fenster oeffnen und sanft schliessen: cargo test -- --ignored closes_a_real_window
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn closes_a_real_window() {
        let mut child = std::process::Command::new("notepad.exe").spawn().expect("notepad starten");
        let wait_for = |want_open: bool| {
            for _ in 0..40 {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if find_open(&["notepad.exe".to_string()]).is_empty() != want_open {
                    return true;
                }
            }
            false
        };
        assert!(wait_for(true), "Notepad-Fenster wurde nicht gefunden");
        assert!(running_apps().iter().any(|w| w.exe == "notepad.exe"));
        let asked = close_windows_of("notepad.exe");
        assert!(asked >= 1, "kein Fenster angefragt");
        let closed = wait_for(false);
        let _ = child.kill();
        assert!(closed, "Notepad-Fenster ist nach WM_CLOSE noch offen");
    }

    #[cfg(windows)]
    #[test]
    fn lists_windows_without_crashing() {
        // Auf einem Entwicklungsrechner gibt es fast immer ein Fenster; wichtig ist, dass nichts abstuerzt.
        let apps = running_apps();
        for app in &apps {
            assert!(app.exe.ends_with(".exe"), "{app:?}");
            assert!(!app.title.is_empty());
        }
    }
}
