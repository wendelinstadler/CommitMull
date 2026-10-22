//! Aktionen pro Modus: gespeicherte Seiten oeffnen und gespeicherte Terminal-Befehle ausfuehren.
//!
//! Sicherheitsregeln (siehe PLAN.md, "Aktionen und Sicherheit"):
//! - Das Frontend schickt nur IDs (Tier, Modus, Aktion), nie Adresse oder Befehlstext. Rust liest die Aktion selbst aus dem
//!   gespeicherten Stand (state.json). Befehle aus externen Daten (GitHub-Antworten, KI-Antworten, Pakete) gibt es nicht.
//! - Seiten: nur http und https, ohne Zugangsdaten in der Adresse, ueber ShellExecute geoeffnet (keine Shell-Zeile, die sich
//!   einschleusen liesse).
//! - Befehle: vor dem ersten Start einer neuen oder geaenderten Fassung (Befehl oder Ordner) muss der Benutzer den vollen Befehl
//!   bestaetigen. Die Bestaetigung gilt nur fuer genau diese Fassung (Pruefsumme); aendert sich etwas, fragt die App erneut.
//!   Zwischen Anzeige und Bestaetigung kann sich der Befehl nicht unbemerkt aendern, weil die Pruefsumme mitgeschickt wird.
//! - Der Befehl laeuft in einem neuen, sichtbaren PowerShell-Fenster mit den Rechten des Benutzers (nicht als Administrator).

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "state.json";
const APPROVALS_KEY: &str = "approvals";

pub const MAX_URL: usize = 2000;
pub const MAX_COMMAND: usize = 2000;

#[derive(Deserialize, Debug, Clone)]
struct LinkCfg {
    id: String,
    #[serde(default)]
    url: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct CommandCfg {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub cwd: String,
}

#[derive(Deserialize, Debug, Clone)]
struct ModeCfg {
    id: String,
    #[serde(default)]
    links: Vec<LinkCfg>,
    #[serde(default)]
    commands: Vec<CommandCfg>,
}

#[derive(Deserialize, Debug, Clone)]
struct AgentCfg {
    id: String,
    #[serde(default)]
    modes: Vec<ModeCfg>,
}

fn load_agents(app: &AppHandle) -> Result<Vec<AgentCfg>, String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("Speicher nicht verfuegbar: {e}"))?;
    let value = store.get("agents").ok_or("Keine Tiere gespeichert.")?;
    serde_json::from_value(value).map_err(|_| "Gespeicherte Tiere sind nicht lesbar.".to_string())
}

fn find_mode(agents: &[AgentCfg], agent_id: &str, mode_id: &str) -> Result<ModeCfg, String> {
    agents
        .iter()
        .find(|a| a.id == agent_id)
        .and_then(|a| a.modes.iter().find(|m| m.id == mode_id))
        .cloned()
        .ok_or_else(|| "Tier oder Modus nicht gefunden.".to_string())
}

// ---------------------------------------------------------------------------------------------
// Seiten

/// Eine Adresse ist erlaubt, wenn sie http oder https ist, einen Rechner nennt, keine Zugangsdaten und keine Steuerzeichen enthaelt.
pub fn validate_url(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.chars().count() > MAX_URL {
        return Err("Die Adresse ist leer oder zu lang.".to_string());
    }
    if raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Die Adresse darf keine Leerzeichen oder Steuerzeichen enthalten.".to_string());
    }
    let parsed = url::Url::parse(raw).map_err(|_| "Das ist keine gueltige Adresse (https://...).".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Nur Adressen mit http:// oder https:// sind erlaubt.".to_string());
    }
    if parsed.host_str().is_none_or(|h| h.is_empty()) {
        return Err("Die Adresse nennt keinen Rechner.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Adressen mit Benutzername oder Passwort sind nicht erlaubt.".to_string());
    }
    Ok(parsed.to_string())
}

#[cfg(windows)]
fn shell_open(url: &str) -> Result<(), String> {
    use windows::core::{w, HSTRING};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let target = HSTRING::from(url);
    // Ein Wert groesser als 32 heisst Erfolg.
    let result = unsafe { ShellExecuteW(None, w!("open"), &target, None, None, SW_SHOWNORMAL) };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("Die Seite konnte nicht geoeffnet werden.".to_string())
    }
}

#[cfg(not(windows))]
fn shell_open(_url: &str) -> Result<(), String> {
    Err("Nur unter Windows verfuegbar.".to_string())
}

/// Oeffnet eine gespeicherte Seite im Standardbrowser. Die Adresse kommt aus dem Speicher, nicht vom Frontend.
pub fn open_link(app: &AppHandle, agent_id: &str, mode_id: &str, link_id: &str) -> Result<(), String> {
    let mode = find_mode(&load_agents(app)?, agent_id, mode_id)?;
    let link = mode.links.iter().find(|l| l.id == link_id).ok_or("Seite nicht gefunden.")?;
    shell_open(&validate_url(&link.url)?)
}

// ---------------------------------------------------------------------------------------------
// Befehle

/// Prueft einen gespeicherten Befehl: nicht leer, nicht zu lang, Ordner (falls angegeben) ein vorhandener absoluter Ordner.
pub fn validate_command(cmd: &CommandCfg) -> Result<(), String> {
    if cmd.command.trim().is_empty() || cmd.command.chars().count() > MAX_COMMAND {
        return Err("Der Befehl ist leer oder zu lang.".to_string());
    }
    if cmd.command.contains('\0') {
        return Err("Der Befehl enthaelt ein ungueltiges Zeichen.".to_string());
    }
    if cmd.cwd.trim().is_empty() {
        return Ok(());
    }
    let path = std::path::Path::new(cmd.cwd.trim());
    if !path.is_absolute() {
        return Err("Der Ordner muss ein vollstaendiger Pfad sein, z. B. C:\\Projekte\\app.".to_string());
    }
    if !path.is_dir() {
        return Err("Der Ordner existiert nicht.".to_string());
    }
    Ok(())
}

/// Pruefsumme der Fassung eines Befehls (Ordner und Befehlstext). Aendert sich eines davon, ist eine neue Bestaetigung noetig.
pub fn fingerprint(cmd: &CommandCfg) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cmd.cwd.trim().as_bytes());
    hasher.update([0u8]);
    hasher.update(cmd.command.as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Befehl fuer PowerShell -EncodedCommand: Base64 von UTF-16LE. So gibt es keine Probleme mit Anfuehrungszeichen.
pub fn encode_command(command: &str) -> String {
    let bytes: Vec<u8> = command.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    /// Fassung ist bestaetigt: ausfuehren.
    Run,
    /// Neue oder geaenderte Fassung: erst den Benutzer fragen.
    NeedsApproval,
    /// Die Bestaetigung bezog sich auf eine andere Fassung als die aktuelle.
    Changed,
}

/// Entscheidet ueber das Ausfuehren: bestaetigt = die gespeicherte Pruefsumme dieses Befehls, approve = die Pruefsumme, die der
/// Benutzer gerade bestaetigt hat (aus dem Dialog).
pub fn decide(current: &str, approved: Option<&str>, approve: Option<&str>) -> Decision {
    match approve {
        Some(fp) if fp == current => Decision::Run,
        Some(_) => Decision::Changed,
        None if approved == Some(current) => Decision::Run,
        None => Decision::NeedsApproval,
    }
}

fn read_approvals(app: &AppHandle) -> HashMap<String, String> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(APPROVALS_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn write_approvals(app: &AppHandle, approvals: &HashMap<String, String>) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(APPROVALS_KEY, serde_json::to_value(approvals).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn spawn_powershell(command: &str, cwd: &str, keep_open: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let exe = format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    let mut process = std::process::Command::new(exe);
    process.arg("-NoLogo");
    if keep_open {
        process.arg("-NoExit");
    }
    process.arg("-EncodedCommand").arg(encode_command(command)).creation_flags(CREATE_NEW_CONSOLE);
    if !cwd.trim().is_empty() {
        process.current_dir(cwd.trim());
    }
    process.spawn().map(|_| ()).map_err(|e| format!("PowerShell konnte nicht gestartet werden: {e}"))
}

#[cfg(not(windows))]
fn spawn_powershell(_command: &str, _cwd: &str, _keep_open: bool) -> Result<(), String> {
    Err("Nur unter Windows verfuegbar.".to_string())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum RunOutcome {
    /// Das Terminalfenster wurde geoeffnet.
    Started,
    /// Der Benutzer muss diese Fassung erst bestaetigen. Das Frontend zeigt Name, Befehl und Ordner und schickt fingerprint zurueck.
    NeedsApproval { name: String, command: String, cwd: String, fingerprint: String },
}

/// Fuehrt einen gespeicherten Befehl aus (oder verlangt die Bestaetigung). approve = Pruefsumme aus dem Bestaetigungsdialog.
pub fn run_command(app: &AppHandle, agent_id: &str, mode_id: &str, command_id: &str, approve: Option<&str>) -> Result<RunOutcome, String> {
    let mode = find_mode(&load_agents(app)?, agent_id, mode_id)?;
    let cmd = mode.commands.iter().find(|c| c.id == command_id).ok_or("Befehl nicht gefunden.")?;
    validate_command(cmd)?;
    let current = fingerprint(cmd);
    let mut approvals = read_approvals(app);
    match decide(&current, approvals.get(command_id).map(String::as_str), approve) {
        Decision::Changed => Err("Der Befehl wurde in der Zwischenzeit geaendert. Bitte erneut bestaetigen.".to_string()),
        Decision::NeedsApproval => Ok(RunOutcome::NeedsApproval {
            name: cmd.name.clone(),
            command: cmd.command.clone(),
            cwd: cmd.cwd.trim().to_string(),
            fingerprint: current,
        }),
        Decision::Run => {
            if approvals.get(command_id) != Some(&current) {
                approvals.insert(command_id.to_string(), current);
                write_approvals(app, &approvals)?;
            }
            spawn_powershell(&cmd.command, &cmd.cwd, true)?;
            Ok(RunOutcome::Started)
        }
    }
}

#[derive(Serialize, Debug)]
pub struct CommandStatus {
    pub id: String,
    pub approved: bool,
}

/// Welche Befehle des Modus sind in ihrer jetzigen Fassung bestaetigt?
pub fn command_status(app: &AppHandle, agent_id: &str, mode_id: &str) -> Result<Vec<CommandStatus>, String> {
    let mode = find_mode(&load_agents(app)?, agent_id, mode_id)?;
    let approvals = read_approvals(app);
    Ok(mode
        .commands
        .iter()
        .map(|c| CommandStatus { id: c.id.clone(), approved: approvals.get(&c.id).is_some_and(|fp| *fp == fingerprint(c)) })
        .collect())
}

/// Vergisst die Bestaetigung eines Befehls (nach dem Loeschen).
pub fn forget_command(app: &AppHandle, command_id: &str) -> Result<(), String> {
    let mut approvals = read_approvals(app);
    if approvals.remove(command_id).is_some() {
        write_approvals(app, &approvals)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(command: &str, cwd: &str) -> CommandCfg {
        CommandCfg { id: "c1".into(), name: "Test".into(), command: command.into(), cwd: cwd.into() }
    }

    #[test]
    fn accepts_only_plain_http_links() {
        assert_eq!(validate_url("https://github.com/octocat/hello").unwrap(), "https://github.com/octocat/hello");
        assert_eq!(validate_url("  http://localhost:3000/  ").unwrap(), "http://localhost:3000/");
        assert!(validate_url("https://example.com/a?b=1&c=2#x").is_ok());
        for bad in [
            "",
            "   ",
            "example.com",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/cmd.exe",
            "ftp://example.com",
            "calc.exe",
            "C:\\Windows\\notepad.exe",
            "https://",
            "https://user:pw@example.com",
            "https://user@example.com",
            "https://exa mple.com",
            "https://example.com/\nx",
            "data:text/html,<script>1</script>",
            "ms-msdt:/id PCWDiagnostic",
        ] {
            assert!(validate_url(bad).is_err(), "{bad:?} haette abgelehnt werden muessen");
        }
        assert!(validate_url(&format!("https://example.com/{}", "a".repeat(MAX_URL))).is_err());
    }

    #[test]
    fn validates_commands() {
        assert!(validate_command(&cmd("npm run dev", "")).is_ok());
        assert!(validate_command(&cmd("", "")).is_err());
        assert!(validate_command(&cmd("   ", "")).is_err());
        assert!(validate_command(&cmd(&"x".repeat(MAX_COMMAND + 1), "")).is_err());
        assert!(validate_command(&cmd("a\0b", "")).is_err());
        assert!(validate_command(&cmd("dir", "relativer\\ordner")).is_err());
        assert!(validate_command(&cmd("dir", "C:\\gibt\\es\\nicht\\sicher")).is_err());
        let temp = std::env::temp_dir();
        assert!(validate_command(&cmd("dir", temp.to_str().unwrap())).is_ok());
        assert!(validate_command(&cmd("dir", &format!("{}\\", temp.to_str().unwrap()))).is_ok());
    }

    #[test]
    fn fingerprint_changes_with_command_and_folder() {
        let base = fingerprint(&cmd("npm run dev", "C:\\a"));
        assert_eq!(base, fingerprint(&cmd("npm run dev", " C:\\a ")), "Leerraum um den Ordner zaehlt nicht");
        assert_ne!(base, fingerprint(&cmd("npm run build", "C:\\a")));
        assert_ne!(base, fingerprint(&cmd("npm run dev", "C:\\b")));
        assert_ne!(base, fingerprint(&cmd("npm run dev", "")));
        // Trennung: Ordner "ab" + Befehl "c" ist nicht Ordner "a" + Befehl "bc"
        assert_ne!(fingerprint(&cmd("c", "ab")), fingerprint(&cmd("bc", "a")));
        assert_eq!(base.len(), 64);
    }

    #[test]
    fn decides_about_running() {
        assert_eq!(decide("fp1", None, None), Decision::NeedsApproval);
        assert_eq!(decide("fp1", Some("fp1"), None), Decision::Run);
        assert_eq!(decide("fp2", Some("fp1"), None), Decision::NeedsApproval, "geaendert: erneut fragen");
        assert_eq!(decide("fp1", None, Some("fp1")), Decision::Run, "gerade bestaetigt");
        assert_eq!(decide("fp2", Some("fp1"), Some("fp1")), Decision::Changed, "zwischen Anzeige und Bestaetigung geaendert");
        assert_eq!(decide("fp1", Some("fp1"), Some("xx")), Decision::Changed);
    }

    #[test]
    fn encodes_commands_for_powershell() {
        // Bekannter Wert: "echo hi" als UTF-16LE in Base64
        assert_eq!(encode_command("echo hi"), "ZQBjAGgAbwAgAGgAaQA=");
        // Anfuehrungszeichen und Umlaute gehen unveraendert durch
        let encoded = encode_command("Write-Host \"Grüße\"");
        let decoded = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        let units: Vec<u16> = decoded.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(String::from_utf16(&units).unwrap(), "Write-Host \"Grüße\"");
    }

    /// Echter Start in einem neuen PowerShell-Fenster: cargo test -- --ignored runs_in_a_new_powershell_window
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn runs_in_a_new_powershell_window() {
        let marker = std::env::temp_dir().join("commitmull-actions-test.txt");
        let _ = std::fs::remove_file(&marker);
        let temp = std::env::temp_dir();
        // Befehl mit Anfuehrungszeichen und Umlaut, laeuft im angegebenen Ordner und beendet das Fenster selbst (exit)
        let command = "Set-Content -Path 'commitmull-actions-test.txt' -Value \"ok Grüße $((Get-Location).Path)\" -Encoding UTF8; exit";
        spawn_powershell(command, temp.to_str().unwrap(), true).unwrap();
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if marker.exists() {
                break;
            }
        }
        let text = std::fs::read_to_string(&marker).expect("Der Befehl hat nichts geschrieben");
        assert!(text.contains("ok Grüße"), "{text}");
        assert!(text.to_lowercase().contains(&temp.to_str().unwrap().trim_end_matches('\\').to_lowercase()), "Ordner stimmt nicht: {text}");
        let _ = std::fs::remove_file(&marker);
    }
}
