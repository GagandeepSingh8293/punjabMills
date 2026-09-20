//! Embedded LAN server so a phone can submit challans directly into the desktop app
//! (mirrors the original app's "scan QR on the phone, challan syncs to desktop" flow,
//! without requiring a separate web backend).

use std::net::UdpSocket;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Request, Response, Server};

use crate::util;

pub const PORT: u16 = 3784;

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

fn handle(mut req: Request, app: AppHandle, conn: &Mutex<Connection>) {
    let method = req.method().clone();
    let path = req.url().to_string();

    let (code, ctype, body): (u16, &str, String) = match (method.as_str(), path.as_str()) {
        ("GET", "/health") => (200, "application/json", r#"{"ok":true}"#.to_string()),
        ("GET", "/") => (200, "text/html; charset=utf-8", CAPTURE_HTML.to_string()),
        ("POST", "/api/challans") => {
            let mut buf = Vec::new();
            let _ = req.as_reader().read_to_end(&mut buf);
            let body_text = String::from_utf8_lossy(&buf);
            match create_challan(&app, conn, body_text.as_ref()) {
                Ok(payload) => (200, "application/json", payload.to_string()),
                Err(msg) => (422, "application/json", json!({ "ok": false, "error": msg }).to_string()),
            }
        }
        _ => {
            respond(req, 404, "text/plain", "Not found".to_string());
            return;
        }
    };

    respond(req, code, ctype, body);
}

fn respond(req: Request, code: u16, ctype: &str, body: String) {
    let _ = req.respond(
        Response::from_string(body)
            .with_status_code(code)
            .with_header(Header::from_bytes("Content-Type", ctype).unwrap()),
    );
}

/// Validate a phone-submitted challan and persist it (mirrors `create_challan`).
fn create_challan(app: &AppHandle, conn: &Mutex<Connection>, body: &str) -> Result<Value, String> {
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