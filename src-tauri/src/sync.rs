//! Embedded LAN server so a phone can submit challans directly into the desktop app
//! (mirrors the original app's "scan QR on the phone, challan syncs to desktop" flow,
//! without requiring a separate web backend).

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Request, Response, Server};
use tauri::Manager;

use crate::ocr;
use crate::util;

pub const PORT: u16 = 3784;
const MAX_PHOTO_BYTES: usize = 20 * 1024 * 1024;

pub fn lan_ip() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip().to_string())
}

pub fn base_url() -> String {
    format!("http://{}:{}", lan_ip().unwrap_or_else(|| "127.0.0.1".to_string()), PORT)
}

/// Start the LAN server in a background thread. The server opens its own
/// connection to the same database file (the app's connection stays in the
/// Tauri state); WAL mode makes the two connections safe to use together.
pub fn start(app: AppHandle, db_path: std::path::PathBuf) {
    std::thread::spawn(move || {
        let conn: Arc<Mutex<Connection>> = match Connection::open(&db_path) {
            Ok(c) => Arc::new(Mutex::new(c)),
            Err(e) => {
                let _ = app.emit("sync:status", json!({ "running": false, "error": e.to_string() }));
                return;
            }
        };

        let server = match Server::http(("0.0.0.0", PORT)) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit("sync:status", json!({ "running": false, "error": e.to_string() }));
                return;
            }
        };

        let url = base_url();
        let _ = app.emit("sync:status", json!({ "running": true, "port": PORT, "url": url }));

        for request in server.incoming_requests() {
            let app = app.clone();
            let conn = Arc::clone(&conn);
            std::thread::spawn(move || handle(request, app, &conn));
        }
    });
}

fn query_params(full_url: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some((_, q)) = full_url.split_once('?') {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                out.insert(k.to_string(), percent_decode(v));
            }
        }
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type(req: &Request) -> String {
    req.headers()
        .iter()
        .find(|h| h.field.equiv("Content-Type"))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_default()
}

fn handle(mut req: Request, app: AppHandle, conn: &Arc<Mutex<Connection>>) {
    let method = req.method().clone();
    let url = req.url().to_string();
    let path_only = url.split('?').next().unwrap_or("").to_string();
    let params = query_params(&url);

    let (code, ctype, body): (u16, String, String) = match (method.as_str(), path_only.as_str()) {
        ("GET", "/health") => (200, "application/json".to_string(), r#"{"ok":true}"#.to_string()),
        ("GET", "/") => (200, "text/html; charset=utf-8".to_string(), CAPTURE_HTML.to_string()),
        ("GET", "/scan") => (200, "text/html; charset=utf-8".to_string(), SCAN_PHOTO_HTML.to_string()),
        ("GET", "/api/scan/status") => match scan_status(conn, &params) {
            Ok(payload) => (200, "application/json".to_string(), payload.to_string()),
            Err(msg) => (500, "application/json".to_string(), json!({ "ok": false, "error": msg }).to_string()),
        },
        ("GET", "/api/scan/result") => match scan_result(&app, conn, &params) {
            Ok(payload) => (200, "application/json".to_string(), payload.to_string()),
            Err(msg) => (500, "application/json".to_string(), json!({ "ok": false, "error": msg }).to_string()),
        },
        ("POST", "/api/challans") => {
            let mut buf = Vec::new();
            let _ = req.as_reader().read_to_end(&mut buf);
            let body_text = String::from_utf8_lossy(&buf);
            match create_challan(&app, conn, body_text.as_ref()) {
                Ok(payload) => (200, "application/json".to_string(), payload.to_string()),
                Err(msg) => (422, "application/json".to_string(), json!({ "ok": false, "error": msg }).to_string()),
            }
        }
        ("POST", "/api/scan") => {
            let ctype = content_type(&req);
            let mut buf = Vec::new();
            let mut chunk = [0u8; 65536];
            let mut oversized = false;
            loop {
                let n = req.as_reader().read(&mut chunk).unwrap_or(0);
                if n == 0 {
                    break;
                }
                if buf.len() + n > MAX_PHOTO_BYTES {
                    oversized = true;
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            if oversized {
                (
                    413,
                    "application/json".to_string(),
                    json!({ "ok": false, "error": "Photo is too large (max 20 MB)." }).to_string(),
                )
            } else {
                let session = params.get("session").cloned().unwrap_or_default();
                match save_scan_photo(&app, conn, &session, &ctype, &buf) {
                    Ok(payload) => (200, "application/json".to_string(), payload),
                    Err(msg) => (422, "application/json".to_string(), json!({ "ok": false, "error": msg }).to_string()),
                }
            }
        }
        _ => {
            respond(req, 404, "text/plain", "Not found".to_string());
            return;
        }
    };

    respond(req, code, &ctype, body);
}

fn respond(req: Request, code: u16, ctype: &str, body: String) {
    let _ = req.respond(
        Response::from_string(body)
            .with_status_code(code)
            .with_header(Header::from_bytes("Content-Type", ctype).unwrap()),
    );
}

/// Validate a phone-submitted challan and persist it (mirrors `create_challan`).
fn create_challan(app: &AppHandle, conn: &Arc<Mutex<Connection>>, body: &str) -> Result<Value, String> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| "Invalid JSON body".to_string())?;

    let document_type = parsed
        .get("documentType")
        .and_then(|v| v.as_str())
        .unwrap_or("incoming")
        .to_string();
    if document_type != "incoming" && document_type != "outgoing" {
        return Err("documentType must be \"incoming\" or \"outgoing\"".to_string());
    }

    let header: Value = parsed.get("header").cloned().unwrap_or(Value::Null);
    let billing = header
        .get("billing")
        .cloned()
        .filter(|v| !v.is_null())
        .unwrap_or(Value::Null);
    let party_name = billing
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Party name is required".to_string())?;

    let mut billing = billing;
    if let Value::Object(map) = &mut billing {
        map.insert("name".to_string(), json!(party_name));
    }

    let line_items: Vec<Value> = parsed
        .get("lineItems")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|it| {
                    let s = |k: &str| it.get(k).and_then(|v| v.as_str()).map(|x| x.trim()).unwrap_or("");
                    s("lotNo") != "" || s("particulars") != "" || s("colour") != "" || s("depth") != ""
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if line_items.is_empty() {
        return Err("At least one line item is required".to_string());
    }

    let shipping = header
        .get("shipping")
        .cloned()
        .filter(|v| !v.is_null())
        .unwrap_or_else(|| billing.clone());

    let challan_no = header
        .get("challanNo")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();

    let challan_date = header
        .get("challanDate")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(today);

    let vehicle_no = header
        .get("vehicleNo")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let id = nanoid::nanoid!(10);
    let record = json!({
        "id": id,
        "documentType": document_type,
        "status": "saved",
        "createdAt": now_iso(),
        "header": {
            "challanNo": if challan_no.is_empty() { format!("CH-{}", id[..6].to_uppercase()) } else { challan_no },
            "challanDate": challan_date,
            "vehicleNo": vehicle_no,
            "billing": billing,
            "shipping": shipping,
        },
        "lineItems": line_items,
        "source": "phone",
    });

    let guard = conn.lock().map_err(|e| e.to_string())?;
    util::upsert_challan(&guard, &record).map_err(|e| e.to_string())?;
    drop(guard);

    let challan_no = record["header"]["challanNo"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let _ = app.emit("challan:synced", record.clone());
    Ok(json!({ "ok": true, "id": id, "challanNo": challan_no, "documentType": document_type }))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Backend status check used by the phone capture page: is Gemini configured?
fn scan_status(conn: &Arc<Mutex<Connection>>, _params: &HashMap<String, String>) -> Result<Value, String> {
    let seal = conn.lock().map_err(|e| e.to_string())?;
    Ok(json!({ "configured": ocr::configured(&seal), "model": ocr::MODEL }))
}

/// Phone polling endpoint: did OCR finish for this session?
fn scan_result(app: &AppHandle, conn: &Arc<Mutex<Connection>>, params: &HashMap<String, String>) -> Result<Value, String> {
    let session = params.get("session").cloned().unwrap_or_default();
    let seal = conn.lock().map_err(|e| e.to_string())?;
    let extracted: Option<String> = seal
        .query_row("SELECT extracted_json FROM scan_sessions WHERE session_id=?1", [&session], |r| r.get(0))
        .ok()
        .flatten();
    let photo: Option<(String, i64)> = seal
        .query_row(
            "SELECT id, size FROM scan_photos WHERE session_id=?1 ORDER BY created_at DESC LIMIT 1",
            [&session],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    drop(seal);
    let _ = app; // reserved for future live-update events to the phone
    let Some(extracted) = extracted else {
        return Ok(json!({ "state": "processing", "received": photo.is_some() }));
    };
    match serde_json::from_str::<Value>(&extracted) {
        Ok(v) if v.get("error").is_some() => {
            let msg = v.get("error").and_then(|e| e.as_str()).unwrap_or("Extraction failed").to_string();
            Ok(json!({ "state": "error", "message": msg, "received": photo.is_some() }))
        }
        Ok(v) => {
            let items = v.get("lineItems").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
            let name = v["header"]["billing"]["name"].as_str().unwrap_or("").to_string();
            Ok(json!({ "state": "done", "party": name, "lineItems": items, "received": photo.is_some() }))
        }
        Err(_) => Ok(json!({ "state": "processing", "received": photo.is_some() })),
    }
}

/// Receive a captured challan photo from the phone, save it to disk + DB,
/// emit `challan:photo-received`, then run the real OCR pipeline in the background.
fn save_scan_photo(
    app: &AppHandle,
    conn: &Arc<Mutex<Connection>>,
    session_id: &str,
    ctype: &str,
    buf: &[u8],
) -> Result<String, String> {
    let mime = normalize_mime(ctype);
    if mime.is_empty() {
        return Err("Upload a photo with Content-Type image/jpeg, image/png or image/webp.".to_string());
    }
    if buf.is_empty() {
        return Err("Empty photo upload.".to_string());
    }
    if buf.len() > MAX_PHOTO_BYTES {
        return Err("Photo is too large (max 20 MB).".to_string());
    }

    let dir = ocr::photo_dir(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
    );
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let id = nanoid::nanoid!(10);
    let ext = mime.split('/').next_back().unwrap_or("jpg").replace("jpeg", "jpg");
    let filename = format!("{id}.{ext}");
    std::fs::write(dir.join(&filename), buf).map_err(|e| e.to_string())?;

    let created = now_iso();
    let seal = conn.lock().map_err(|e| e.to_string())?;
    seal.execute(
        "INSERT INTO scan_photos (id, session_id, challan_id, filename, mime, size, created_at)
         VALUES (?1,?2,NULL,?3,?4,?5,?6)",
        params![id, session_id, filename, mime, buf.len() as i64, created],
    )
    .map_err(|e| e.to_string())?;
    seal.execute(
        "INSERT INTO scan_sessions (session_id, created_at, extracted_json)
         VALUES (?1,?2,NULL) ON CONFLICT(session_id) DO NOTHING",
        params![session_id, created],
    )
    .map_err(|e| e.to_string())?;
    drop(seal);

    let _ = app.emit(
        "challan:photo-received",
        json!({ "sessionId": session_id, "photoId": id, "mime": mime, "size": buf.len(), "createdAt": created }),
    );

    spawn_ocr(app.clone(), Arc::clone(conn), session_id.to_string(), mime.to_string(), buf.to_vec());

    Ok(json!({ "ok": true, "photoId": id }).to_string())
}

fn normalize_mime(ctype: &str) -> String {
    let raw = ctype.split(';').next().unwrap_or("").trim().to_lowercase();
    match raw.as_str() {
        "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" => raw,
        _ => String::new(),
    }
}

/// Run Gemini vision extraction and orchestrate the event sequence the UI already
/// understands: `challan:processing` → `challan:type-detected` → `challan:fields-updated`
/// (or `challan:extraction-failed`). The result is stored in `scan_sessions` so the form
/// can re-fetch it and corrections can be logged against it.
fn spawn_ocr(app: AppHandle, conn: Arc<Mutex<Connection>>, session_id: String, mime: String, buf: Vec<u8>) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(350));
        let _ = app.emit("challan:processing", json!({}));
        std::thread::sleep(std::time::Duration::from_millis(250));

        let key = {
            let seal = match conn.lock() {
                Ok(s) => s,
                Err(e) => {
                    let _ = app.emit("challan:extraction-failed", json!({ "message": e.to_string() }));
                    return;
                }
            };
            ocr::api_key(&seal)
        };

        match ocr::extract_challan(key.as_deref().unwrap_or(""), &mime, &buf) {
            Ok(patch) => {
                let _ = conn.lock().ok().and_then(|seal| {
                    seal
                        .execute(
                            "UPDATE scan_sessions SET extracted_json=?1 WHERE session_id=?2",
                            params![patch.to_string(), session_id],
                        )
                        .ok()
                });
                let doc_type = patch.get("type").and_then(|v| v.as_str()).unwrap_or("incoming").to_string();
                let _ = app.emit("challan:type-detected", json!({ "type": doc_type }));
                std::thread::sleep(std::time::Duration::from_millis(200));
                let _ = app.emit("challan:fields-updated", patch.clone());
            }
            Err(msg) => {
                let _ = conn.lock().ok().and_then(|seal| {
                    seal
                        .execute(
                            "UPDATE scan_sessions SET extracted_json=?1 WHERE session_id=?2",
                            params![json!({ "error": msg }).to_string(), session_id],
                        )
                        .ok()
                });
                let _ = app.emit("challan:extraction-failed", json!({ "message": msg }));
            }
        }
    });
}

/// LAN sync status for the "Sync" page.
#[tauri::command]
pub fn get_sync_status() -> Result<Value, String> {
    Ok(json!({
        "running": true,
        "port": PORT,
        "url": base_url(),
        "ip": lan_ip(),
    }))
}

const CAPTURE_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Challan Sync</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f3f4f6; color: #111827; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { font-size: 20px; margin: 8px 0 2px; }
  p.sub { color: #6b7280; font-size: 13px; margin: 0 0 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin: 10px 0 4px; }
  input, select { width: 100%; padding: 9px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; background: #fff; }
  .row { display: flex; gap: 8px; }
  .row.short input { width: 100%; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .item { border: 1px dashed #d1d5db; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fafafa; }
  .del { float: right; font-size: 12px; color: #b91c1c; background: none; border: none; cursor: pointer; padding: 0; margin-top: 2px; }
  button.add { display: block; width: 100%; padding: 10px; border: 1px solid #10b981; color: #047857; background: #ecfdf5; border-radius: 8px; font-size: 14px; cursor: pointer; margin-top: 10px; }
  button.submit { width: 100%; padding: 12px; border: 0; border-radius: 10px; background: #0f766e; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
  button.submit:disabled { background: #9ca3af; }
  .msg { margin-top: 12px; padding: 10px; border-radius: 8px; font-size: 14px; display: none; }
  .msg.ok { display: block; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .msg.err { display: block; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .itemhead { font-size: 12px; font-weight: 700; color: #4b5563; margin-bottom: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>DyeAI Challan Sync</h1>
  <p class="sub">Enter challan details and they sync straight into the desktop app.</p>

  <div class="card">
    <label>Document type</label>
    <select id="docType">
      <option value="incoming">Incoming Challan</option>
      <option value="outgoing">Outgoing Challan</option>
    </select>

    <label>Party name</label>
    <input id="partyName" placeholder="e.g. Om Textiles Pvt Ltd">
    <div class="grid2">
      <div>
        <label>GSTIN</label>
        <input id="gstin" placeholder="Optional">
      </div>
      <div>
        <label>Phone</label>
        <input id="mobile" placeholder="Optional">
      </div>
    </div>

    <div class="grid2">
      <div>
        <label>Challan no.</label>
        <input id="challanNo" placeholder="Optional">
      </div>
      <div>
        <label>Date</label>
        <input id="challanDate" type="date">
      </div>
    </div>
    <label>Vehicle no.</label>
    <input id="vehicleNo" placeholder="e.g. PB-65-AB-1234">
  </div>

  <div class="card" id="items">
    <p class="itemhead">Line items</p>
    <div id="list"></div>
    <button class="add" type="button" onclick="addItem()">+ Add line item</button>
  </div>

  <button class="submit" id="submitBtn" onclick="submitChallan()">Sync challan</button>
  <div class="msg" id="msg"></div>
</div>

<script>
  function makeRow(n) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = '<button class="del" onclick="this.parentNode.remove()">Remove</button>' +
      '<label>Particulars</label><input data-k="particulars" placeholder="e.g. Dyed Fabric">' +
      '<label>Lot / Order no.</label><input data-k="lotNo" placeholder="e.g. LOT-3001">' +
      '<label>Colour</label><input data-k="colour" placeholder="e.g. Mustard">' +
      '<div class="grid2"><div><label>Depth</label><input data-k="depth" placeholder="Medium"></div>' +
      '<div><label>Process</label><input data-k="processName" placeholder="Dyeing"></div></div>' +
      '<div class="grid2"><div><label>HSN</label><input data-k="hsnCode" placeholder="540752"></div>' +
      '<div><label>Rate (Rs/kg)</label><input data-k="rate" type="number" min="0" step="0.01" value="0"></div></div>' +
      '<div class="grid2"><div><label>Rolls</label><input data-k="roll" type="number" min="0" step="1" value="0"></div>' +
      '<div><label>Weight (kg)</label><input data-k="weight" type="number" min="0" step="0.001" value="0"></div></div>';
    return d;
  }
  let counter = 0;
  function addItem() {
    document.getElementById('list').appendChild(makeRow(++counter));
  }
  addItem();

  function num(v) { const x = parseFloat(v); return isFinite(x) ? x : 0; }

  async function submitChallan() {
    const rows = [...document.querySelectorAll('#list .item')].map(el => {
      const get = (k) => (el.querySelector('[data-k="'+k+'"]') || {}).value || '';
      return {
        particulars: get('particulars').trim(),
        lotNo: get('lotNo').trim(),
        colour: get('colour').trim(),
        depth: get('depth').trim(),
        processName: get('processName').trim(),
        hsnCode: get('hsnCode').trim(),
        rate: num(get('rate')),
        roll: num(get('roll')),
        weight: num(get('weight')),
      };
    }).filter(r => r.particulars || r.lotNo || r.colour || r.depth);

    const payload = {
      documentType: document.getElementById('docType').value,
      header: {
        challanNo: document.getElementById('challanNo').value.trim(),
        challanDate: document.getElementById('challanDate').value || new Date().toISOString().slice(0, 10),
        vehicleNo: document.getElementById('vehicleNo').value.trim(),
        billing: {
          name: document.getElementById('partyName').value.trim(),
          gstin: document.getElementById('gstin').value.trim(),
          mobile: document.getElementById('mobile').value.trim(),
        },
        shipping: {
          name: document.getElementById('partyName').value.trim(),
          gstin: document.getElementById('gstin').value.trim(),
          mobile: document.getElementById('mobile').value.trim(),
        },
      },
      lineItems: rows,
    };

    const msg = document.getElementById('msg');
    msg.className = 'msg';
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const res = await fetch('/api/challans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      msg.className = 'msg ' + (res.ok ? 'ok' : 'err');
      msg.textContent = res.ok
        ? 'Synced! Challan ' + (data.challanNo || '') + ' saved. You can send another one.'
        : (data.error || 'Sync failed');
      if (res.ok) { document.getElementById('list').innerHTML = ''; addItem(); }
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = 'Could not reach the desktop app: ' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync challan';
    }
  }
</script>
</body>
</html>"#;

/// Mobile page that captures a real handwritten challan photo and posts it to the
/// desktop app, which reads it with Gemini and auto-fills an incoming challan.
const SCAN_PHOTO_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scan Challan Photo</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f3f4f6; color: #111827; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { font-size: 20px; margin: 8px 0 2px; }
  p.sub { color: #6b7280; font-size: 13px; margin: 0 0 16px; line-height: 1.5; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin: 8px 0 4px; }
  input[type="file"] { width: 100%; padding: 10px; border: 1px dashed #d1d5db; border-radius: 8px; font-size: 14px; }
  #preview { margin-top: 12px; }
  #preview img { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; }
  button.submit { width: 100%; padding: 13px; border: 0; border-radius: 10px; background: #0f766e; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 12px; }
  button.submit:disabled { background: #9ca3af; }
  .msg { margin-top: 12px; padding: 10px; border-radius: 8px; font-size: 14px; display: none; }
  .msg.ok { display: block; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .msg.err { display: block; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .msg.warn { display: block; background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .hint { font-size: 12px; color: #6b7280; margin-top: 12px; line-height: 1.5; }
  a.back { display: inline-block; color: #0f766e; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Scan challan photo</h1>
  <p class="sub">Take a clear photo of the handwritten challan. The desktop app reads it and fills the challan automatically.</p>

  <div class="card">
    <label>Photo of the challan (hold flat, good lighting)</label>
    <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment">
    <div id="preview"></div>
    <button class="submit" id="go" onclick="send()" disabled>Scan challan</button>
    <div class="msg" id="msg"></div>
    <p class="hint" id="hint">Only this photo is uploaded to your desktop machine — nothing is stored on third-party servers.</p>
  </div>

  <p class="sub"><a class="back" href="/">Prefer to type the challan manually? Open the manual form instead.</a></p>

  <div class="card" id="statusCard" style="display:none">
    <p id="statusText" style="margin:0; font-size:14px;">Sending photo…</p>
  </div>
</div>

<script>
  var SESSION = new URLSearchParams(location.search).get('session') || '';
  var file = document.getElementById('file');
  var go = document.getElementById('go');
  var msg = document.getElementById('msg');
  var hint = document.getElementById('hint');
  var statusCard = document.getElementById('statusCard');
  var statusText = document.getElementById('statusText');
  var current = null;

  file.addEventListener('change', function () {
    current = file.files && file.files[0] ? file.files[0] : null;
    var img = document.querySelector('#preview img');
    if (!current) { go.disabled = true; if (img) img.remove(); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      if (!document.querySelector('#preview img')) {
        var el = document.createElement('img');
        el.src = e.target.result;
        document.getElementById('preview').appendChild(el);
      } else {
        document.querySelector('#preview img').src = e.target.result;
      }
    };
    reader.readAsDataURL(current);
    go.disabled = false;
    document.getElementById('msg').className = 'msg';
  });

  function setMessage(cls, text) {
    msg.className = 'msg ' + cls;
    msg.textContent = text;
  }

  function checkConfigured(cb) {
    fetch('/api/scan/status' + (SESSION ? '?session=' + SESSION : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.configured) cb(true);
        else {
          cb(false);
          setMessage('warn', 'The desktop app does not have a Gemini API key yet. Open the Sync page in the desktop app → Scan AI, add the key, then try again.');
        }
      })
      .catch(function () {
        setMessage('err', 'Could not reach the desktop app. Is it running on the same Wi-Fi?');
        cb(false);
      });
  }

  function send() {
    if (!current) { setMessage('err', 'Choose a photo first.'); return; }
    checkConfigured(function (ok) {
      if (!ok) return;
      var btn = go;
      btn.disabled = true;
      btn.textContent = 'Scanning…';
      statusCard.style.display = 'block';
      statusText.textContent = 'Uploading photo to the desktop app…';
      msg.className = 'msg';

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/scan?session=' + SESSION);
      xhr.setRequestHeader('Content-Type', current.type || 'image/jpeg');
      xhr.onload = function () {
        try {
          var d = JSON.parse(xhr.responseText);
          if (!d.ok) { setMessage('err', d.error || 'Upload failed.'); btn.disabled = false; btn.textContent = 'Scan challan'; return; }
          pollResult(0);
        } catch (e) {
          setMessage('err', 'Upload failed (' + xhr.status + ').'); btn.disabled = false; btn.textContent = 'Scan challan';
        }
      };
      xhr.onerror = function () {
        setMessage('err', 'Upload failed — is the desktop app still on?');
        btn.disabled = false; btn.textContent = 'Scan challan';
      };
      xhr.send(current);
    });
  }

  function pollResult(tries) {
    statusText.textContent = 'The desktop app is reading the challan photo…';
    fetch('/api/scan/result?session=' + SESSION)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.state === 'done') {
          statusText.textContent = 'Done — challan read (party: ' + (d.party || '?') + ', ' + (d.lineItems || 0) + ' items). Review it on the desktop screen now.';
          setMessage('ok', '✓ Photo read. The desktop app just opened the challan for review.');
          hint.textContent = 'You can scan another challan now, or close this page.';
          go.disabled = false; go.textContent = 'Scan another';
        } else if (d.state === 'error') {
          statusCard.style.display = 'none';
          setMessage('err', (d.message || 'Could not read the challan.') + ' Try a clearer photo.');
          go.disabled = false; go.textContent = 'Scan challan';
        } else if (tries < 60) {
          setTimeout(function () { pollResult(tries + 1); }, 1500);
        } else {
          statusCard.style.display = 'none';
          setMessage('warn', 'Still processing on the desktop — check that screen.');
          go.disabled = false; go.textContent = 'Scan again';
        }
      })
      .catch(function () {
        if (tries < 60) setTimeout(function () { pollResult(tries + 1); }, 1500);
        else { statusCard.style.display = 'none'; setMessage('err', 'Lost contact with the desktop app.'); }
      });
  }
</script>
</body>
</html>"#;