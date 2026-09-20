//! Real OCR for handwritten/textile challan photos via the Google Gemini vision API.
//! The phone's photo is uploaded to the desktop app, saved, and sent to Gemini with
//! a strict-JSON extraction prompt. The result is stored in the `scan_sessions` table
//! and re-emitted to the UI as `challan:fields-updated`.

use base64::Engine;
use rusqlite::Connection;
use serde_json::{json, Value};

/// Google Gemini model used for vision extraction. Can be adjusted if Google
/// deprecates a model or a newer one is preferred.
pub const MODEL: &str = "gemini-2.5-flash";

fn settings_key() -> &'static str {
    "gemini_api_key"
}

pub fn api_key(conn: &Connection) -> Option<String> {
    conn.query_row("SELECT value FROM app_settings WHERE key=?1", [settings_key()], |r| r.get(0))
        .ok()
        .filter(|k: &String| !k.trim().is_empty())
}

pub fn set_api_key(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [settings_key(), key],
    )
    .map(|_| ())
}

pub fn configured(conn: &Connection) -> bool {
    api_key(conn).is_some()
}

pub fn photo_dir(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    app_data_dir.join("scan-photos")
}

const PROMPT: &str = "\
You are an OCR engine for Indian textile job-work challans (also called dhams/delivery challans). \
Read the attached photo of a handwritten or printed challan carefully. The handwriting may mix \
Hindi, Gujarati and English; transliterate product/colour/process names into English where possible. \
Return ONLY valid JSON, with no markdown fences, in exactly this shape (all keys present):\n\
\n\
{\n  \"type\": \"incoming\" or \"outgoing\",\n  \"header\": {\n    \"vehicleNo\": \"string or \\\"\\\"\",\n    \"challanDate\": \"YYYY-MM-DD or \\\"\\\"\",\n    \"eWayNo\": \"string or \\\"\\\"\",\n    \"billing\": { \"name\": \"\", \"address\": \"\", \"gstin\": \"\", \"state\": \"\", \"stateCode\": \"\", \"mobile\": \"\" },\n    \"shipping\": { \"name\": \"\", \"address\": \"\", \"gstin\": \"\", \"state\": \"\", \"stateCode\": \"\", \"mobile\": \"\" }\n  },\n  \"lineItems\": [\n    { \"particulars\": \"\", \"lotNo\": \"\", \"colour\": \"\", \"depth\": \"\", \"processName\": \"\", \"hsnCode\": \"\", \"roll\": 0, \"weight\": 0, \"rate\": 0, \"remarks\": \"\" }\n  ],\n  \"confidence\": { \"<dot path such as header.billing.name or lineItems.0.particulars>\": 0.0-1.0 }\n}\n\nRules:\n- billing is the supplier/vendor party who sent the goods; shipping is the destination party; \
if only one party is written, copy it to both.\n- Read the table row by row. Convert roll counts to integers, weights to kg numbers, rate to a \
Rupees-per-kg number.\n- stateCode is the 2-digit GST state code if recognisable, else \\\"\\\".\n- For every field you actually fill, include a numeric confidence 0.0-1.0 in the confidence map \
under its exact dot path. Skip fields you could not read.\n- If a party name is unreadable set it to \\\"\\\" with confidence 0.1.\n";

/// Upload the image to Gemini and return a normalized FieldsUpdatedPayload-style JSON:
/// `{ type, header, lineItems, confidence }`. The key is already resolved by the caller
/// so no DB lock is held while the HTTP call is in flight.
pub fn extract_challan(key: &str, mime: &str, bytes: &[u8]) -> Result<Value, String> {
    let raw = call_gemini(key, mime, bytes)?;
    let mut value = parse_json_response(&raw)?;
    let normalized = normalize(&mut value);
    ensure_intelligible(&normalized)?;
    Ok(normalized)
}

fn call_gemini(key: &str, mime: &str, bytes: &[u8]) -> Result<String, String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let body = json!({
        "contents": [{
            "parts": [
                { "text": PROMPT },
                { "inline_data": { "mime_type": mime, "data": b64 } }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    });
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}"
    );

    let resp = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(90))
        .send_json(body)
        .map_err(|e| format!("Could not reach the Gemini API: {e}"))?;

    let out: Value = resp.into_json().map_err(|e| format!("Bad response from Gemini: {e}"))?;

    if let Some(msg) = out.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
        return Err(format!("Gemini API error: {msg}"));
    }

    let text = out["candidates"][0]["content"]["parts"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|p| p.get("text").and_then(|t| t.as_str()).map(String::from))
        .collect::<Vec<_>>()
        .join("\n");

    if text.trim().is_empty() {
        return Err("Gemini returned an empty response.".to_string());
    }
    Ok(text)
}

fn parse_json_response(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    let cleaned = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(|s| s.trim())
        .and_then(|s| s.strip_suffix("```"))
        .map(|s| s.trim())
        .unwrap_or(trimmed);
    serde_json::from_str(cleaned).map_err(|e| format!("Could not interpret the AI result as JSON: {e}"))
}

/// Coerce the model's output into our record shape: document type, header with both
/// parties, line items with ids and numeric fields, and a confidence map.
fn normalize(value: &mut Value) -> Value {
    let obj = match value.as_object_mut() {
        Some(o) => o,
        None => return json!({ "type": "incoming", "header": {}, "lineItems": [], "confidence": {} }),
    };

    let detected = obj.get("type").and_then(|v| v.as_str()).unwrap_or("incoming");
    let doc_type = if detected == "outgoing" { "outgoing" } else { "incoming" };
    obj.insert("type".to_string(), json!(doc_type));

    let header = obj.entry("header").or_insert_with(|| json!({}));
    if let Value::Object(h) = header {
        for k in ["vehicleNo", "challanDate", "eWayNo"] {
            h.entry(k.to_string()).or_insert_with(|| json!(""));
        }
        for side in ["billing", "shipping"] {
            let party = h.entry(side.to_string()).or_insert_with(|| json!({}));
            if let Value::Object(p) = party {
                for k in ["name", "address", "gstin", "state", "stateCode", "mobile"] {
                    p.entry(k.to_string()).or_insert_with(|| json!(""));
                }
            }
        }
    }

    let items = obj.entry("lineItems").or_insert_with(|| json!([]));
    let mut cleaned = Vec::new();
    if let Some(arr) = items.as_array() {
        for item in arr {
            let mut it = item.clone();
            if let Value::Object(m) = &mut it {
                if !m.contains_key("id") {
                    m.insert("id".to_string(), json!(nanoid::nanoid!(8)));
                }
                for k in ["particulars", "lotNo", "colour", "depth", "processName", "hsnCode", "remarks"] {
                    m.entry(k.to_string()).or_insert_with(|| json!(""));
                }
                for k in ["roll", "weight", "rate"] {
                    let v = m.get(k).cloned().unwrap_or(Value::Null);
                    let n = v.as_f64().unwrap_or_else(|| {
                        v.as_str()
                            .and_then(|s| s.trim().parse::<f64>().ok())
                            .unwrap_or(0.0)
                    });
                    m.insert(k.to_string(), json!(n));
                }
            }
            cleaned.push(it);
        }
    }
    obj.insert("lineItems".to_string(), json!(cleaned));

    let conf = obj.entry("confidence").or_insert_with(|| json!({}));
    if !conf.is_object() {
        *conf = json!({});
    }

    value.clone()
}

fn ensure_intelligible(value: &Value) -> Result<(), String> {
    let name = value["header"]["billing"]["name"].as_str().unwrap_or("").trim();
    if name.is_empty() {
        return Err("Could not read the supplier (billing) party name from the photo. Try again with a clearer, flatter photo in good light.".to_string());
    }
    Ok(())
}