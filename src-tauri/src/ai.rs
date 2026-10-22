//! Claude-Anbindung fuer den Assistenten im Panel (eigener API-Schluessel des Benutzers).
//!
//! Sicherheit und Datenschutz:
//! - Der Schluessel liegt im Windows-Anmeldeinformationsspeicher, nicht in state.json, und verlaesst Rust nie
//!   (das Webview kann ihn weder lesen noch senden; es kann nur "gesetzt?" abfragen).
//! - Es geht nur an api.anthropic.com. Modell, Rollen und Groessen werden geprueft, das Frontend kann keine beliebige Adresse anfragen.
//! - Antworten werden nur als Text angezeigt. Sie werden nie als Befehl, Skript oder Programm ausgefuehrt.
//! - Was gesendet wird, bestimmt der Benutzer (Chat-Eingabe, Aufgaben fuer den Tagesplan, auf Klick die Depotdaten).

use serde::{Deserialize, Serialize};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
/// Version der Messages-API (Kopfzeile anthropic-version).
const API_VERSION: &str = "2026-10-21";
/// Kopfzeile fuer die serverseitige Ausweichroute bei Sicherheitsablehnungen ("fallbacks": "default").
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

const KEY_SERVICE: &str = "CommitMull";
const KEY_USER: &str = "anthropic-api-key";

/// Erlaubte Modelle (aktuelle Generation).
pub const MODELS: [&str; 3] = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
/// Modelle, bei denen die serverseitige Ausweichroute vorgesehen ist (Haiku hat keine).
const FALLBACK_MODELS: [&str; 2] = ["claude-opus-5-5", "claude-sonnet-5-5"];

const MAX_MESSAGES: usize = 40;
const MAX_TEXT: usize = 20_000;
const MAX_OUTPUT: u32 = 4_000;

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<AiMessage>,
    pub max_tokens: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiReply {
    pub text: String,
    /// Die Antwort wurde wegen der Laengenbegrenzung abgeschnitten.
    pub truncated: bool,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

// ---------------------------------------------------------------------------------------------
// Schluessel im Windows-Anmeldeinformationsspeicher

fn entry(service: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, KEY_USER).map_err(|e| format!("Schluesselspeicher nicht verfuegbar: {e}"))
}

/// Ein Schluessel sieht aus wie sk-ant-..., ohne Leerzeichen, in vernuenftiger Laenge.
pub fn valid_key_format(key: &str) -> bool {
    key.starts_with("sk-ant-")
        && key.len() >= 20
        && key.len() <= 300
        && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

pub fn set_key(key: &str) -> Result<(), String> {
    set_key_in(KEY_SERVICE, key)
}

pub fn has_key() -> bool {
    has_key_in(KEY_SERVICE)
}

pub fn delete_key() -> Result<(), String> {
    delete_key_in(KEY_SERVICE)
}

fn set_key_in(service: &str, key: &str) -> Result<(), String> {
    let key = key.trim();
    if !valid_key_format(key) {
        return Err("Das sieht nicht wie ein Anthropic-Schluessel aus (er beginnt mit sk-ant-).".to_string());
    }
    entry(service)?.set_password(key).map_err(|e| format!("Schluessel konnte nicht gespeichert werden: {e}"))
}

fn has_key_in(service: &str) -> bool {
    entry(service).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

fn delete_key_in(service: &str) -> Result<(), String> {
    match entry(service)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Schluessel konnte nicht entfernt werden: {e}")),
    }
}

fn read_key(service: &str) -> Result<String, String> {
    match entry(service)?.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err("Es ist noch kein Schluessel eingetragen (Einstellungen, Allgemein, KI-Assistent).".to_string()),
        Err(e) => Err(format!("Schluessel konnte nicht gelesen werden: {e}")),
    }
}

// ---------------------------------------------------------------------------------------------
// Anfrage

/// Prueft die Anfrage des Frontends; liefert eine verstaendliche Fehlermeldung.
pub fn validate(req: &AiRequest) -> Result<(), String> {
    if !MODELS.contains(&req.model.as_str()) {
        return Err(format!("Unbekanntes Modell: {}", req.model));
    }
    if req.messages.is_empty() || req.messages.len() > MAX_MESSAGES {
        return Err("Ungueltige Zahl von Nachrichten.".to_string());
    }
    if req.messages[0].role != "user" {
        return Err("Die erste Nachricht muss vom Benutzer sein.".to_string());
    }
    if req.messages.iter().any(|m| m.role != "user" && m.role != "assistant") {
        return Err("Ungueltige Rolle in den Nachrichten.".to_string());
    }
    if req.messages.iter().any(|m| m.content.trim().is_empty() || m.content.chars().count() > MAX_TEXT) {
        return Err("Eine Nachricht ist leer oder zu lang.".to_string());
    }
    if req.system.chars().count() > MAX_TEXT {
        return Err("Die Anweisung ist zu lang.".to_string());
    }
    if req.max_tokens == 0 || req.max_tokens > MAX_OUTPUT {
        return Err("Ungueltige Antwortlaenge.".to_string());
    }
    Ok(())
}

/// Baut den JSON-Koerper. Thinking bleibt weg (bei diesen Modellen standardmaessig adaptiv), die Anstrengung ist niedrig:
/// ein Begleiter soll schnell und billig antworten.
pub fn build_body(req: &AiRequest, with_fallbacks: bool) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": req.messages.iter().map(|m| serde_json::json!({ "role": m.role, "content": m.content })).collect::<Vec<_>>(),
        "output_config": { "effort": "low" },
    });
    if with_fallbacks {
        body["fallbacks"] = serde_json::json!("default");
    }
    body
}

/// Liest die Antwort der Messages-API: Text, Abbruchgrund, Verbrauch.
pub fn parse_reply(body: &str, requested_model: &str) -> Result<AiReply, String> {
    let json: serde_json::Value = serde_json::from_str(body).map_err(|_| "Unerwartete Antwort von Claude.".to_string())?;
    let stop = json["stop_reason"].as_str().unwrap_or("");
    if stop == "refusal" {
        return Err("Claude hat diese Anfrage abgelehnt.".to_string());
    }
    let text: String = json["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err(if stop == "max_tokens" {
            "Die Antwort war zu lang und wurde vor dem Text abgebrochen. Frag etwas kuerzer.".to_string()
        } else {
            "Claude hat nichts geantwortet.".to_string()
        });
    }
    Ok(AiReply {
        text: text.trim().to_string(),
        truncated: stop == "max_tokens",
        model: json["model"].as_str().unwrap_or(requested_model).to_string(),
        input_tokens: json["usage"]["input_tokens"].as_u64().unwrap_or(0),
        output_tokens: json["usage"]["output_tokens"].as_u64().unwrap_or(0),
    })
}

/// Verstaendliche Meldung zu einem Fehlerstatus (ohne Schluessel oder Eingaben zu nennen).
pub fn describe_error(status: u16, body: &str) -> String {
    let api_message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|j| j["error"]["message"].as_str().map(|m| m.chars().take(200).collect::<String>()));
    match status {
        401 | 403 => "Der API-Schluessel wurde abgelehnt. Pruefe ihn in den Einstellungen (Allgemein, KI-Assistent).".to_string(),
        402 => "Das Guthaben bei Anthropic ist aufgebraucht.".to_string(),
        404 => "Das Modell ist fuer deinen Zugang nicht verfuegbar. Waehle in den Einstellungen ein anderes.".to_string(),
        429 => "Zu viele Anfragen oder Limit erreicht. Warte einen Moment.".to_string(),
        500..=599 => "Claude ist gerade nicht erreichbar oder ueberlastet. Versuche es gleich nochmal.".to_string(),
        _ => format!("Anfrage abgelehnt ({status}){}", api_message.map(|m| format!(": {m}")).unwrap_or_default()),
    }
}

/// Schickt die Anfrage an base_url (im Betrieb immer API_URL). Bei Modellen mit serverseitiger Ausweichroute wird sie mitgeschickt;
/// lehnt die API sie mit 400 ab, wird einmal ohne wiederholt.
pub async fn complete_at(base_url: &str, service: &str, req: &AiRequest) -> Result<AiReply, String> {
    validate(req)?;
    let key = read_key(service)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let mut with_fallbacks = FALLBACK_MODELS.contains(&req.model.as_str());
    loop {
        let mut request = client
            .post(base_url)
            .header("x-api-key", &key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json");
        if with_fallbacks {
            request = request.header("anthropic-beta", FALLBACK_BETA);
        }
        let response = request
            .body(build_body(req, with_fallbacks).to_string())
            .send()
            .await
            .map_err(|_| "Keine Verbindung zu Claude. Pruefe dein Netz.".to_string())?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|_| "Antwort konnte nicht gelesen werden.".to_string())?;
        if (200..300).contains(&status) {
            return parse_reply(&body, &req.model);
        }
        if status == 400 && with_fallbacks {
            with_fallbacks = false;
            continue;
        }
        return Err(describe_error(status, &body));
    }
}

pub async fn complete(req: &AiRequest) -> Result<AiReply, String> {
    complete_at(API_URL, KEY_SERVICE, req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn request(model: &str) -> AiRequest {
        AiRequest {
            model: model.to_string(),
            system: "Du bist ein Tier.".to_string(),
            messages: vec![AiMessage { role: "user".into(), content: "Hallo".into() }],
            max_tokens: 500,
        }
    }

    #[test]
    fn checks_key_format() {
        assert!(valid_key_format("sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123456789-AB"));
        for bad in ["", "sk-ant-", "sk-ant-short", "abc", "sk-ant-api03-has space inside-abcdefghijkl", "sk-ant-ünicode-abcdefghijklmnop", "xx-ant-api03-abcdefghijklmnopqrstuvwxyz"] {
            assert!(!valid_key_format(bad), "{bad}");
        }
        assert!(!valid_key_format(&format!("sk-ant-{}", "a".repeat(400))));
    }

    #[test]
    fn validates_requests() {
        assert!(validate(&request("claude-opus-5-5")).is_ok());
        assert!(validate(&request("gpt-4")).is_err());
        let mut r = request("claude-haiku-5-5");
        r.messages.clear();
        assert!(validate(&r).is_err());
        let mut r = request("claude-haiku-5-5");
        r.messages[0].role = "assistant".into();
        assert!(validate(&r).is_err());
        let mut r = request("claude-haiku-5-5");
        r.messages.push(AiMessage { role: "system".into(), content: "x".into() });
        assert!(validate(&r).is_err(), "system-Rolle darf nicht durchgehen");
        let mut r = request("claude-haiku-5-5");
        r.messages[0].content = "   ".into();
        assert!(validate(&r).is_err());
        let mut r = request("claude-haiku-5-5");
        r.messages[0].content = "x".repeat(MAX_TEXT + 1);
        assert!(validate(&r).is_err());
        let mut r = request("claude-haiku-5-5");
        r.max_tokens = 0;
        assert!(validate(&r).is_err());
        r.max_tokens = MAX_OUTPUT + 1;
        assert!(validate(&r).is_err());
    }

    #[test]
    fn builds_the_request_body() {
        let body = build_body(&request("claude-opus-5-5"), true);
        assert_eq!(body["model"], "claude-opus-5-5");
        assert_eq!(body["max_tokens"], 500);
        assert_eq!(body["system"], "Du bist ein Tier.");
        assert_eq!(body["messages"][0], serde_json::json!({"role": "user", "content": "Hallo"}));
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["fallbacks"], "default");
        // Es werden keine Parameter gesendet, die diese Modelle ablehnen.
        for forbidden in ["temperature", "top_p", "top_k", "thinking", "tool_choice"] {
            assert!(body.get(forbidden).is_none(), "{forbidden} darf nicht gesendet werden");
        }
        assert!(build_body(&request("claude-haiku-5-5"), false).get("fallbacks").is_none());
    }

    #[test]
    fn parses_replies() {
        let ok = r#"{"model":"claude-opus-5-5","stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"Hallo "},{"type":"text","text":"Welt"}],"usage":{"input_tokens":12,"output_tokens":7}}"#;
        let reply = parse_reply(ok, "x").unwrap();
        assert_eq!(reply, AiReply { text: "Hallo Welt".into(), truncated: false, model: "claude-opus-5-5".into(), input_tokens: 12, output_tokens: 7 });

        let cut = r#"{"stop_reason":"max_tokens","content":[{"type":"text","text":"Halb"}],"usage":{}}"#;
        assert!(parse_reply(cut, "m").unwrap().truncated);

        let refusal = r#"{"stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber"},"content":[]}"#;
        assert!(parse_reply(refusal, "m").unwrap_err().contains("abgelehnt"));

        let empty = r#"{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""}]}"#;
        assert!(parse_reply(empty, "m").is_err());
        assert!(parse_reply("<html>", "m").is_err());
    }

    #[test]
    fn explains_errors_without_leaking() {
        assert!(describe_error(401, "{}").contains("Schluessel"));
        assert!(describe_error(429, "{}").contains("Zu viele"));
        assert!(describe_error(529, "{}").contains("ueberlastet"));
        let msg = describe_error(400, r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: too big"}}"#);
        assert!(msg.contains("400") && msg.contains("max_tokens: too big"), "{msg}");
    }

    /// Mini-Server: antwortet der Reihe nach mit den gegebenen (Status, Koerper) und merkt sich die Anfragen.
    async fn mock_server(replies: Vec<(u16, String)>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/messages", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            for (status, body) in replies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut data = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    let n = socket.read(&mut buf).await.unwrap();
                    data.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&data).to_string();
                    if let Some(split) = text.find("\r\n\r\n") {
                        let length = text[..split]
                            .lines()
                            .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if data.len() >= split + 4 + length {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                log.lock().unwrap().push(String::from_utf8_lossy(&data).to_string());
                let response = format!("HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (url, seen)
    }

    const SERVICE: &str = "CommitMull-Test-AI";
    const SERVICE_2: &str = "CommitMull-Test-AI-2";
    const TEST_KEY: &str = "sk-ant-test-0123456789abcdefghijklmnop";

    #[tokio::test]
    async fn talks_to_the_api_with_the_right_headers_and_retries_without_fallbacks() {
        set_key_in(SERVICE, TEST_KEY).unwrap();
        assert!(has_key_in(SERVICE));
        let ok = r#"{"model":"claude-opus-5-5","stop_reason":"end_turn","content":[{"type":"text","text":"Antwort"}],"usage":{"input_tokens":3,"output_tokens":2}}"#.to_string();
        let rejected = r#"{"type":"error","error":{"type":"invalid_request_error","message":"fallbacks: not enabled"}}"#.to_string();
        let (url, seen) = mock_server(vec![(400, rejected), (200, ok)]).await;
        let reply = complete_at(&url, SERVICE, &request("claude-opus-5-5")).await.unwrap();
        assert_eq!(reply.text, "Antwort");
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 2, "erst mit, dann ohne Ausweichroute");
        let first = requests[0].to_lowercase();
        assert!(first.contains("x-api-key: sk-ant-test-"), "{first}");
        assert!(first.contains("anthropic-version: 2026-10-21"));
        assert!(first.contains("anthropic-beta: server-side-fallback-2026-07-01"));
        assert!(requests[0].contains("\"fallbacks\":\"default\""));
        let second = requests[1].to_lowercase();
        assert!(!second.contains("anthropic-beta"), "zweiter Versuch ohne Beta-Kopfzeile");
        assert!(!requests[1].contains("fallbacks"));
        delete_key_in(SERVICE).unwrap();
        assert!(!has_key_in(SERVICE));
    }

    #[tokio::test]
    async fn haiku_sends_no_fallbacks_and_errors_are_reported() {
        set_key_in(SERVICE_2, TEST_KEY).unwrap();
        let (url, seen) = mock_server(vec![(401, r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#.to_string())]).await;
        let err = complete_at(&url, SERVICE_2, &request("claude-haiku-5-5")).await.unwrap_err();
        assert!(err.contains("Schluessel"), "{err}");
        assert!(!err.contains("sk-ant"), "der Schluessel darf nie in einer Meldung stehen");
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 1);
        assert!(!requests[0].to_lowercase().contains("anthropic-beta"));
        delete_key_in(SERVICE_2).unwrap();
    }

    #[tokio::test]
    async fn refuses_without_a_key_and_with_invalid_input() {
        delete_key_in("CommitMull-Test-NoKey").unwrap();
        let err = complete_at("http://127.0.0.1:1/x", "CommitMull-Test-NoKey", &request("claude-opus-5-5")).await.unwrap_err();
        assert!(err.contains("kein Schluessel"), "{err}");
        let mut bad = request("claude-opus-5-5");
        bad.model = "evil-model".into();
        assert!(complete_at("http://127.0.0.1:1/x", "CommitMull-Test-NoKey", &bad).await.is_err());
    }
}
