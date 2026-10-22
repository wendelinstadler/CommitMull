//! Kursabfrage fuer die Investments des Finanz-Agenten (Yahoo Finance, ohne Konto).
//!
//! Die Abfrage laeuft in Rust, weil die Schnittstelle eine Browser-Kennung (User-Agent) verlangt, die ein Webview nicht setzen darf.
//! Sicherheit: Es geht nur an den Yahoo-Host, der Pfad wird aus einem streng geprueften Kuerzel gebaut, das Frontend kann keine
//! beliebige Adresse anfragen. Die Antwort wird als Daten gelesen, nie ausgefuehrt.

use serde::Serialize;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOSTS: [&str; 2] = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub currency: String,
    pub price: f64,
    pub previous_close: f64,
}

/// Kuerzel wie AAPL, SAP.DE, BTC-USD, USDCHF=X, ^GSPC: Buchstaben, Ziffern und . - = ^ _ , bis 24 Zeichen.
pub fn valid_symbol(symbol: &str) -> bool {
    !symbol.is_empty()
        && symbol.len() <= 24
        && symbol.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '=' | '^' | '_'))
}

fn encode(symbol: &str) -> String {
    symbol.replace('^', "%5E").replace('=', "%3D")
}

/// Liest Kurs, Vortagesschluss, Waehrung und Name aus der Antwort der Chart-Schnittstelle.
pub fn parse_chart(symbol: &str, body: &str) -> Result<Quote, String> {
    let json: serde_json::Value = serde_json::from_str(body).map_err(|_| "Unerwartete Antwort".to_string())?;
    let chart = &json["chart"];
    if let Some(err) = chart["error"].as_object() {
        let desc = err.get("description").and_then(|d| d.as_str()).unwrap_or("Fehler");
        return Err(format!("{symbol}: {desc}"));
    }
    let meta = &chart["result"][0]["meta"];
    let price = meta["regularMarketPrice"].as_f64().ok_or_else(|| format!("{symbol}: kein Kurs"))?;
    let previous_close = meta["chartPreviousClose"]
        .as_f64()
        .or_else(|| meta["previousClose"].as_f64())
        .unwrap_or(price);
    if !price.is_finite() || !previous_close.is_finite() || price < 0.0 {
        return Err(format!("{symbol}: ungueltiger Kurs"));
    }
    let name = meta["longName"]
        .as_str()
        .or_else(|| meta["shortName"].as_str())
        .unwrap_or(symbol)
        .chars()
        .take(60)
        .collect();
    let currency = meta["currency"].as_str().unwrap_or("").chars().take(8).collect();
    Ok(Quote { symbol: symbol.to_string(), name, currency, price, previous_close })
}

pub async fn fetch_quote(symbol: &str) -> Result<Quote, String> {
    if !valid_symbol(symbol) {
        return Err(format!("Ungueltiges Kuerzel: {symbol}"));
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut last = String::from("Keine Antwort");
    for host in HOSTS {
        let url = format!("https://{host}/v8/finance/chart/{}?range=1d&interval=1d", encode(symbol));
        match client.get(&url).send().await {
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.map_err(|e| e.to_string())?;
                if status.is_success() {
                    return parse_chart(symbol, &body);
                }
                if status.as_u16() == 404 {
                    return Err(format!("{symbol}: Kuerzel nicht gefunden"));
                }
                last = format!("{symbol}: Fehler {status}");
            }
            Err(e) => last = format!("{symbol}: keine Verbindung ({e})"),
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &str = r#"{"chart":{"result":[{"meta":{"currency":"USD","symbol":"AAPL","regularMarketPrice":347.82,"longName":"Apple Inc.","shortName":"Apple Inc.","chartPreviousClose":343.99}}],"error":null}}"#;

    #[test]
    fn parses_a_chart_response() {
        let q = parse_chart("AAPL", AAPL).unwrap();
        assert_eq!(q, Quote { symbol: "AAPL".into(), name: "Apple Inc.".into(), currency: "USD".into(), price: 347.82, previous_close: 343.99 });
    }

    #[test]
    fn reports_unknown_symbols() {
        let body = r#"{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}"#;
        let err = parse_chart("NOPE", body).unwrap_err();
        assert!(err.contains("NOPE") && err.contains("No data found"), "{err}");
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_chart("X", "<html>nope</html>").is_err());
        assert!(parse_chart("X", r#"{"chart":{"result":[{"meta":{}}],"error":null}}"#).is_err());
    }

    /// Echte Abfrage (braucht Internet): cargo test -- --ignored live_quotes
    #[tokio::test]
    #[ignore]
    async fn live_quotes() {
        let aapl = fetch_quote("AAPL").await.unwrap();
        assert_eq!(aapl.currency, "USD");
        assert!(aapl.price > 0.0 && aapl.previous_close > 0.0, "{aapl:?}");
        let fx = fetch_quote("USDCHF=X").await.unwrap();
        assert_eq!(fx.currency, "CHF");
        assert!(fx.price > 0.3 && fx.price < 3.0, "{fx:?}");
        let sap = fetch_quote("SAP.DE").await.unwrap();
        assert_eq!(sap.currency, "EUR");
        let btc = fetch_quote("BTC-USD").await.unwrap();
        assert!(btc.price > 100.0, "{btc:?}");
        let missing = fetch_quote("NOPE123XYZ").await.unwrap_err();
        assert!(missing.contains("nicht gefunden"), "{missing}");
        println!("AAPL {} {} (gestern {}), USDCHF {}, SAP {} {}, BTC {}", aapl.price, aapl.currency, aapl.previous_close, fx.price, sap.price, sap.currency, btc.price);
    }

    #[test]
    fn validates_symbols() {
        for ok in ["AAPL", "SAP.DE", "BTC-USD", "USDCHF=X", "^GSPC", "VWRL.L"] {
            assert!(valid_symbol(ok), "{ok}");
        }
        for bad in ["", "AAPL/../x", "a b", "a?b=1&c", "https://evil", "A".repeat(30).as_str(), "x%00", "a#b"] {
            assert!(!valid_symbol(bad), "{bad}");
        }
        assert_eq!(encode("^GSPC"), "%5EGSPC");
        assert_eq!(encode("USDCHF=X"), "USDCHF%3DX");
    }
}
