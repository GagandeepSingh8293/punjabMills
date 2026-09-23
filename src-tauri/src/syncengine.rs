//! Offline-first cloud sync.
//!
//! The desktop app always writes to its local SQLite database. When the backend
//! (FastAPI + PostgreSQL, typically hosted on Supabase) is reachable, changed rows
//! are pushed and remote changes pulled back, last-write-wins by `updated_at`.
//! Local ids are nanoids while the backend uses UUIDs; `sync_id_map` bridges them.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Wire/Postgres kind names used everywhere the remote side is concerned.
const KIND_CHALLANS: &str = "challans";
const SYNCED_KINDS: [(&str, &str); 5] = [
    ("customers", "customers"),
    ("colours", "colours"),
    ("depths", "depths"),
    ("processes", "processors"),
    ("hsn_codes", "hsn_codes"),
];

static SYNCING: AtomicBool = AtomicBool::new(false);

fn management_api_key() -> Uuid {
    Uuid::NAMESPACE_DNS
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, false)
}

/// Canonical RFC3339 UTC with microsecond precision so lexicographic comparison
/// in SQLite matches chronological order.
fn norm_ts(s: &str) -> String {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Micros, false);
    }
    s.to_string()
}

fn device_id(conn: &Connection) -> String {
    if let Ok(id) = conn.query_row(
        "SELECT value FROM app_settings WHERE key='sync_device_id'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        return id;
    }
    let id = nanoid::nanoid!(12);
    let _ = conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('sync_device_id', ?1) ON CONFLICT(key) DO NOTHING",
        params![id],
    );
    id
}

// --------------------------- id mapping ---------------------------

fn remote_id(conn: &Connection, kind: &str, local_id: &str) -> rusqlite::Result<String> {
    if let Some(u) = conn
        .query_row(
            "SELECT remote_uuid FROM sync_id_map WHERE kind=?1 AND local_id=?2",
            params![kind, local_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(u);
    }
    let uuid = Uuid::new_v5(&management_api_key(), format!("dyeai:{kind}:{local_id}").as_bytes()).to_string();
    conn.execute(
        "INSERT INTO sync_id_map (kind, local_id, remote_uuid) VALUES (?1,?2,?3)",
        params![kind, local_id, uuid],
    )?;
    Ok(uuid)
}

fn local_id(conn: &Connection, kind: &str, remote_uuid: &str) -> rusqlite::Result<String> {
    if let Some(id) = conn
        .query_row(
            "SELECT local_id FROM sync_id_map WHERE kind=?1 AND remote_uuid=?2",
            params![kind, remote_uuid],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let id = nanoid::nanoid!(10);
    conn.execute(
        "INSERT INTO sync_id_map (kind, local_id, remote_uuid) VALUES (?1,?2,?3)",
        params![kind, id, remote_uuid],
    )?;
    Ok(id)
}

// --------------------------- config ---------------------------

fn load_cfg(conn: &Connection) -> (String, String) {
    conn.query_row(
        "SELECT remote_url, token FROM sync_state WHERE id=1",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .map(|(u, t)| (u.trim().to_string(), t.trim().to_string()))
    .unwrap_or_default()
}

fn save_last(conn: &Connection, mode: &str, server_now: &str, error: Option<&str>) {
    let _ = conn.execute(
        "UPDATE sync_state SET last_synced_at=?1, last_mode=?2, last_error=?3, last_online_at=?4 WHERE id=1",
        params![norm_ts(server_now), mode, error.unwrap_or(""), now_iso()],
    );
}

fn save_last_error(conn: &Connection, error: &str) {
    let _ = conn.execute("UPDATE sync_state SET last_error=?1 WHERE id=1", params![error]);
}

/// Count locally-pending rows per kind.
fn pending_counts(conn: &Connection) -> Value {
    let mut masters = json!({});
    if let Some(obj) = masters.as_object_mut() {
        for (kind, local_table) in SYNCED_KINDS {
            let n = pending_in_table(conn, local_table);
            obj.insert(kind.to_string(), json!(n));
        }
    }
    json!({ "challans": pending_in_table(conn, "challans"), "masters": masters })
}

fn pending_in_table(conn: &Connection, table: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE pending_sync=1"),
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// --------------------------- HTTP ---------------------------

fn post_json(url: &str, token: &str, payload: &Value, timeout: Duration) -> Result<Value, String> {
    let resp = ureq::post(url)
        .timeout(timeout)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .send_json(payload.to_string())
        .map_err(|e| http_err_message(url, e))?;
    resp.into_json::<Value>().map_err(|e| format!("Unreadable server response: {e}"))
}

fn get_json(url: &str, token: &str, timeout: Duration) -> Result<Value, String> {
    let resp = ureq::get(url)
        .timeout(timeout)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| http_err_message(url, e))?;
    resp.into_json::<Value>().map_err(|e| format!("Unreadable server response: {e}"))
}

fn get_json_anon(url: &str, timeout: Duration) -> bool {
    ureq::get(url)
        .timeout(timeout)
        .call()
        .map(|r| r.status() == 200 && r.into_string().unwrap_or_default().contains("ok"))
        .unwrap_or(false)
}

fn http_err_message(url: &str, e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("detail")
                        .or_else(|| v.get("message"))
                        .map(|d| d.to_string().trim_matches('"').to_string())
                })
                .unwrap_or_else(|| body.chars().take(200).collect());
            format!("Server returned {code}: {msg}")
        }
        ureq::Error::Transport(t) => format!("Could not reach {url}: {t}"),
    }
}

// --------------------------- push ---------------------------

fn master_row_payload(conn: &Connection, kind: &str, table: &str, id: &str) -> rusqlite::Result<Value> {
    let remote = remote_id(conn, kind, id)?;
    let update: String = conn.query_row(
        &format!("SELECT updated_at FROM {table} WHERE id=?1"),
        params![id],
        |r| r.get(0),
    )?;
    let mut obj = json!({ "id": remote, "updated_at": norm_ts(&update) });
    if let Some(map) = obj.as_object_mut() {
        let mut pick = |cols: &[&str]| -> rusqlite::Result<()> {
            let sql = format!(
                "SELECT {} FROM {table} WHERE id=?1",
                cols.iter().map(|c| *c).collect::<Vec<_>>().join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                for (i, col) in cols.iter().enumerate() {
                    let v: rusqlite::types::Value = row.get(i)?;
                    map.insert(col.to_string(), sqlite_to_json(v));
                }
            }
            Ok(())
        };
        match kind {
            "customers" => pick(&["name", "gstin", "address", "state", "state_code"]),
            "colours" => pick(&["name", "hex"]),
            "depths" => pick(&["name"]),
            "processes" => pick(&["name", "contact_name", "phone"]),
            "hsn_codes" => pick(&["code", "description", "tax_rate"]),
            _ => Ok(()),
        }?;
    }
    Ok(obj)
}

fn sqlite_to_json(v: rusqlite::types::Value) -> Value {
    match v {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(i) => json!(i),
        rusqlite::types::Value::Real(f) => json!(f),
        rusqlite::types::Value::Text(s) => json!(s),
        rusqlite::types::Value::Blob(b) => json!(String::from_utf8_lossy(&b).into_owned()),
    }
}

/// Build the normalized wire document from a local challan row (nanoid id → uuid).
fn challan_doc_payload(conn: &Connection, conn_id: &str) -> rusqlite::Result<Value> {
    let row: (String, String, String, String, String, String) = conn.query_row(
        "SELECT document_type, status, challan_date, data_json, created_at, updated_at FROM challans WHERE id=?1",
        params![conn_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    )?;
    let (doc_type_local, status, challan_date_db, data_json, _created, updated) = row;
    let remote_id = remote_id(conn, KIND_CHALLANS, conn_id)?;

    let rec: Value = serde_json::from_str(&data_json).unwrap_or_else(|_| json!({}));
    let header = rec.get("header").cloned().unwrap_or_else(|| json!({}));
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    let num = |v: &Value| v.as_f64().unwrap_or(0.0);

    let party_name = header
        .get("billing")
        .and_then(|b| b.get("name"))
        .and_then(|n| n.as_str())
        .map(|n| n.trim().to_string())
        .unwrap_or_default();
    let customer_id = resolve_customer_id(conn, &party_name)?;

    let items: Vec<Value> = rec
        .get("lineItems")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, it)| {
                    let has_data = ["lotNo", "particulars", "colour", "depth", "processName", "hsnCode"]
                        .iter()
                        .any(|k| s(it.get(k).unwrap_or(&Value::Null)) != "");
                    let (roll, weight, rate) = if has_data {
                        (num(it.get("roll").unwrap_or(&Value::Null)), num(it.get("weight").unwrap_or(&Value::Null)), num(it.get("rate").unwrap_or(&Value::Null)))
                    } else {
                        (0.0f64, 0.0f64, 0.0f64)
                    };
                    json!({
                        "line_no": i + 1,
                        "lot_no": s(it.get("lotNo").unwrap_or(&Value::Null)),
                        "rolls": roll,
                        "quantity": weight,
                        "rate": rate,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let wire_type = match doc_type_local.as_str() {
        "outgoing" => "ISSUE",
        _ => "RECEIPT",
    };
    let challan_no = s(header.get("challanNo").unwrap_or(&Value::Null));
    let challan_date = s(header.get("challanDate").unwrap_or(&Value::Null));
    let challan_no = if challan_no.is_empty() { conn_id.to_string() } else { challan_no };
    let challan_date = if challan_date.is_empty() { challan_date_db } else { challan_date };

    Ok(json!({
        "id": remote_id,
        "updated_at": norm_ts(&updated),
        "document_type": wire_type,
        "challan_no": challan_no,
        "challan_date": challan_date,
        "status": status,
        "customer_id": customer_id,
        "vehicle_no": s(header.get("vehicleNo").unwrap_or(&Value::Null)),
        "eway_no": s(header.get("eWayNo").unwrap_or(&Value::Null)),
        "through": s(header.get("transporter").unwrap_or(&Value::Null)),
        "items": items,
        "raw_json": data_json,
    }))
}

fn resolve_customer_id(conn: &Connection, name: &str) -> rusqlite::Result<Option<String>> {
    if name.is_empty() {
        return Ok(None);
    }
    let local: Option<String> = conn
        .query_row(
            "SELECT id FROM customers WHERE upper(trim(name))=upper(?1) LIMIT 1",
            params![name],
            |r| r.get(0),
        )
        .optional()?;
    match local {
        Some(id) => remote_id(conn, "customers", &id).map(Some),
        None => Ok(None),
    }
}

fn remote_to_local(conn: &Connection, kind: &str, uuid: &str) -> rusqlite::Result<String> {
    local_id(conn, kind, uuid)
}

// --------------------------- pull apply ---------------------------

fn apply_master_row(conn: &Connection, kind: &str, row: &Value) -> rusqlite::Result<()> {
    let table = match kind {
        "customers" => "customers",
        "colours" => "colours",
        "depths" => "depths",
        "processes" => "processors",
        "hsn_codes" => "hsn_codes",
        _ => return Ok(()),
    };
    let uuid = row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let remote_updated = norm_ts(row.get("updated_at").and_then(|v| v.as_str()).unwrap_or(""));
    let local = remote_to_local(conn, kind, &uuid)?;

    // Local edit pending and newer wins until it is pushed.
    let local_newer = !remote_updated.is_empty() && {
        conn.query_row(
            &format!("SELECT updated_at FROM {table} WHERE id=?1"),
            params![local],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .map(|lu| {
            conn.query_row(
                &format!("SELECT pending_sync FROM {table} WHERE id=?1"),
                params![local],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
                == 1
                && norm_ts(&lu) > remote_updated
        })
        .unwrap_or(false)
    };
    if local_newer {
        return Ok(());
    }

    let g = |k: &str| row.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let gf = |k: &str| row.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let name = g("name");
    let sql = match kind {
        "customers" => format!(
            "INSERT INTO {table} (id, name, gstin, address, state, state_code, created_at, updated_at, pending_sync)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0)
             ON CONFLICT(id) DO UPDATE SET name=?2, gstin=?3, address=?4, state=?5, state_code=?6, updated_at=?8, pending_sync=0"
        ),
        "colours" => format!(
            "INSERT INTO {table} (id, name, hex, created_at, updated_at, pending_sync)
             VALUES (?1,?2,?3,?4,?5,0)
             ON CONFLICT(id) DO UPDATE SET name=?2, hex=?3, updated_at=?5, pending_sync=0"
        ),
        "depths" => format!(
            "INSERT INTO {table} (id, name, created_at, updated_at, pending_sync)
             VALUES (?1,?2,?3,?4,0)
             ON CONFLICT(id) DO UPDATE SET name=?2, updated_at=?4, pending_sync=0"
        ),
        "processes" => format!(
            "INSERT INTO {table} (id, name, contact_name, phone, created_at, updated_at, pending_sync)
             VALUES (?1,?2,?3,?4,?5,?6,0)
             ON CONFLICT(id) DO UPDATE SET name=?2, contact_name=?3, phone=?4, updated_at=?6, pending_sync=0"
        ),
        "hsn_codes" => format!(
            "INSERT INTO {table} (id, code, description, tax_rate, created_at, updated_at, pending_sync)
             VALUES (?1,?2,?3,?4,?5,?6,0)
             ON CONFLICT(id) DO UPDATE SET code=?2, description=?3, tax_rate=?4, updated_at=?6, pending_sync=0"
        ),
        _ => return Ok(()),
    };
    match kind {
        "customers" => {
            conn.execute(&sql, params![local, name, g("gstin"), g("address"), g("state"), g("state_code"), now_iso(), remote_updated])?;
        }
        "colours" => {
            conn.execute(&sql, params![local, name, g("hex"), now_iso(), remote_updated])?;
        }
        "depths" => {
            conn.execute(&sql, params![local, name, now_iso(), remote_updated])?;
        }
        "processes" => {
            conn.execute(&sql, params![local, name, g("contact_name"), g("phone"), now_iso(), remote_updated])?;
        }
        "hsn_codes" => {
            conn.execute(&sql, params![local, g("code"), g("description"), gf("tax_rate"), now_iso(), remote_updated])?;
        }
        _ => {}
    }
    Ok(())
}

fn apply_document_row(conn: &Connection, doc: &Value) -> rusqlite::Result<()> {
    let uuid = doc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let remote_updated = doc
        .get("updated_at")
        .and_then(|v| v.as_str())
        .map(|s| norm_ts(s))
        .unwrap_or_default();
    let local = remote_to_local(conn, KIND_CHALLANS, &uuid)?;

    // Local newer pending edit wins.
    let local_newer = {
        conn.query_row(
            "SELECT updated_at, pending_sync FROM challans WHERE id=?1",
            params![local],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .optional()
        .ok()
        .flatten()
        .map(|(lu, ps)| ps == 1 && !remote_updated.is_empty() && norm_ts(&lu) > remote_updated)
        .unwrap_or(false)
    };
    if local_newer {
        return Ok(());
    }

    let doc_type_local = match doc.get("document_type").and_then(|v| v.as_str()).unwrap_or("RECEIPT") {
        "ISSUE" => "outgoing",
        _ => "incoming",
    };
    let status = doc.get("status").and_then(|v| v.as_str()).unwrap_or("saved").to_string();

    let mut rec: Value = match doc.get("raw_json").and_then(|v| v.as_str()) {
        Some(raw) => serde_json::from_str(raw).unwrap_or_else(|_| json!({})),
        None => {
            let date = doc.get("document_date").and_then(|v| v.as_str()).unwrap_or("").to_string();
            json!({
                "header": { "challanNo": doc.get("challan_no").and_then(|v| v.as_str()).unwrap_or(""), "challanDate": date }
            })
        }
    };
    if let Some(m) = rec.as_object_mut() {
        m.insert("id".to_string(), json!(local));
        m.insert("documentType".to_string(), json!(doc_type_local));
        m.insert("status".to_string(), json!(status));
        if !m.contains_key("createdAt") {
            m.insert("createdAt".to_string(), json!(now_iso()));
        }
    }
    let challan_date = rec
        .get("header")
        .and_then(|h| h.get("challanDate"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    conn.execute(
        "INSERT INTO challans (id, document_type, status, challan_date, data_json, created_at, updated_at, pending_sync)
         VALUES (?1,?2,?3,?4,?5,?6,?7,0)
         ON CONFLICT(id) DO UPDATE SET document_type=?2, status=?3, challan_date=?4, data_json=?5, updated_at=?7, pending_sync=0",
        params![local, doc_type_local, status, challan_date, rec.to_string(), now_iso(), remote_updated],
    )
    .map(|_| ())
}

fn apply_tombstone(conn: &Connection, table: &str, uuid: &str, deleted_at: &str) -> rusqlite::Result<bool> {
    let kind = if table == "challans" {
        KIND_CHALLANS
    } else {
        let _ = SYNCED_KINDS.iter().find(|(w, _)| *w == table);
        table
    };
    let Some(local) = conn
        .query_row(
            "SELECT local_id FROM sync_id_map WHERE kind=?1 AND remote_uuid=?2",
            params![kind, uuid],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    else {
        return Ok(false);
    };

    // Don't delete a row the local device just edited.
    if kind == KIND_CHALLANS {
        let local_newer = conn
            .query_row(
                "SELECT updated_at, pending_sync FROM challans WHERE id=?1",
                params![local],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .optional()
            .ok()
            .flatten()
            .map(|(lu, ps)| ps == 1 && norm_ts(&lu) > norm_ts(deleted_at))
            .unwrap_or(false);
        if local_newer {
            return Ok(false);
        }
        let _ = conn.execute("DELETE FROM challans WHERE id=?1", params![local]);
        return Ok(true);
    }
    if let Some((_, tbl)) = SYNCED_KINDS.iter().find(|(w, _)| *w == table) {
        let _ = conn.execute(&format!("DELETE FROM {tbl} WHERE id=?1"), params![local]);
    }
    Ok(true)
}

// --------------------------- master sync flow ---------------------------

fn push_sync(conn: &Connection, cfg: &(String, String)) -> Result<Value, String> {
    let (url, token) = cfg;
    let remote = format!("{url}/sync/push");

    let mut masters = json!({});
    if let Some(m) = masters.as_object_mut() {
        for (kind, local_table) in SYNCED_KINDS {
            let mut stmt = conn
                .prepare(&format!("SELECT id FROM {local_table} WHERE pending_sync=1"))
                .map_err(|e| e.to_string())?;
            let ids: Vec<String> = stmt
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            let rows: Vec<Value> = ids
                .iter()
                .filter_map(|id| master_row_payload(conn, kind, local_table, id).ok())
                .collect();
            if !rows.is_empty() {
                m.insert(kind.to_string(), json!(rows));
            }
        }
    }

    let mut documents = vec![];
    {
        let mut stmt = conn
            .prepare("SELECT id FROM challans WHERE pending_sync=1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        for id in ids {
            if let Ok(doc) = challan_doc_payload(conn, &id) {
                documents.push(doc);
            }
        }
    }

    let tombstones: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT table_name, row_id FROM sync_tombstones WHERE synced=0")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rows.iter()
            .map(|(t, rid)| json!({ "table": t, "row_id": rid }))
            .collect()
    };

    let payload = json!({
        "device_id": device_id(conn),
        "masters": masters,
        "documents": documents,
        "tombstones": tombstones,
    });
    let resp = post_json(&remote, token, &payload, Duration::from_secs(60))?;

    apply_push_reply(conn, &resp)?;
    Ok(resp)
}

/// Server returns the rows that won each LWW conflict plus per-row errors.
/// Anything that was pushed and neither conflicted nor errored is confirmed, and
/// its `pending_sync` flag is cleared.
fn apply_push_reply(conn: &Connection, resp: &Value) -> Result<(), String> {
    // Collect the local ids the server won (masters + challans) and errored ids.
    let conflict_remote: Vec<String> = {
        let mut out = vec![];
        if let Some(ms) = resp.get("masters").and_then(|m| m.as_object()) {
            for rows in ms.values() {
                if let Some(arr) = rows.as_array() {
                    for r in arr {
                        if let Some(id) = r.get("id").and_then(|v| v.as_str()) {
                            out.push(id.to_string());
                        }
                    }
                }
            }
        }
        if let Some(docs) = resp.get("documents").and_then(|d| d.as_array()) {
            for d in docs {
                if let Some(id) = d.get("id").and_then(|v| v.as_str()) {
                    out.push(id.to_string());
                }
            }
        }
        out
    };
    let error_remote: Vec<String> = {
        let mut out = vec![];
        if let Some(errs) = resp.get("errors").and_then(|e| e.as_array()) {
            for e in errs {
                if let Some(id) = e.get("row_id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        out.push(id.to_string());
                    }
                }
            }
        }
        out
    };

    for (kind, local_table) in SYNCED_KINDS {
        let mut stmt = conn
            .prepare(&format!("SELECT id FROM {local_table} WHERE pending_sync=1"))
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        for id in ids {
            let rid = remote_id(conn, kind, &id).map_err(|e| e.to_string())?;
            let blocked = conflict_remote.iter().any(|r| r == &rid) || error_remote.iter().any(|r| r == &rid);
            if !blocked {
                conn.execute(
                    &format!("UPDATE {local_table} SET pending_sync=0 WHERE id=?1"),
                    params![id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    let mut stmt = conn
        .prepare("SELECT id FROM challans WHERE pending_sync=1")
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    for id in ids {
        let rid = remote_id(conn, KIND_CHALLANS, &id).map_err(|e| e.to_string())?;
        let blocked = conflict_remote.iter().any(|r| r == &rid) || error_remote.iter().any(|r| r == &rid);
        if !blocked {
            conn.execute("UPDATE challans SET pending_sync=0 WHERE id=?1", params![id])
                .map_err(|e| e.to_string())?;
        }
    }

    // Re-apply the server's winning versions where it won the LWW battle.
    if let Some(ms) = resp.get("masters").and_then(|m| m.as_object()) {
        for (kind, rows) in ms {
            if let Some(arr) = rows.as_array() {
                for r in arr {
                    let _ = apply_master_row(conn, kind, r);
                }
            }
        }
    }
    if let Some(docs) = resp.get("documents").and_then(|d| d.as_array()) {
        for d in docs {
            let _ = apply_document_row(conn, d);
        }
    }

    // Tombstones we sent are handled server-side.
    let _ = conn.execute("UPDATE sync_tombstones SET synced=1 WHERE synced=0", []);
    Ok(())
}

fn pull_sync(conn: &Connection, cfg: &(String, String)) -> Result<Value, String> {
    let (url, token) = cfg;
    let since: String = conn
        .query_row("SELECT last_synced_at FROM sync_state WHERE id=1", [], |r| r.get(0))
        .unwrap_or_default();
    let dev = device_id(conn);
    let q = if since.is_empty() {
        format!("?device_id={dev}")
    } else {
        format!("?since={}&device_id={dev}", urlencode(&since))
    };
    let resp = get_json(&format!("{url}/sync/pull{q}"), token, Duration::from_secs(60))?;

    if let Some(ms) = resp.get("masters").and_then(|m| m.as_object()) {
        for (kind, rows) in ms {
            if let Some(arr) = rows.as_array() {
                for r in arr {
                    let _ = apply_master_row(conn, kind, r);
                }
            }
        }
    }
    if let Some(docs) = resp.get("documents").and_then(|d| d.as_array()) {
        for d in docs {
            let _ = apply_document_row(conn, d);
        }
    }
    if let Some(tombs) = resp.get("tombstones").and_then(|t| t.as_array()) {
        for t in tombs {
            let table = t.get("table").and_then(|v| v.as_str()).unwrap_or("");
            let rid = t.get("row_id").and_then(|v| v.as_str()).unwrap_or("");
            let del = t.get("deleted_at").and_then(|v| v.as_str()).unwrap_or("");
            let _ = apply_tombstone(conn, table, rid, del);
        }
    }
    Ok(resp)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// --------------------------- public entry points ---------------------------

fn run_sync(app: &AppHandle, db_path: &std::path::Path, mode: &str) -> Result<Value, String> {
    if SYNCING.swap(true, Ordering::SeqCst) {
        return Err("A sync is already running".to_string());
    }
    let result = (|| {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let cfg = load_cfg(&conn);
        if cfg.0.is_empty() || cfg.1.is_empty() {
            return Err("Cloud sync is not configured".to_string());
        }
        let push_resp = push_sync(&conn, &cfg)?;
        let pull_resp = pull_sync(&conn, &cfg)?;
        let server_now = pull_resp
            .get("server_now")
            .and_then(|v| v.as_str())
            .or_else(|| push_resp.get("server_now").and_then(|v| v.as_str()))
            .unwrap_or("");
        save_last(&conn, mode, server_now, None);
        let status = build_status(&conn);
        Ok(json!({ "ok": true, "mode": mode, "status": status }))
    })();
    SYNCING.store(false, Ordering::SeqCst);
    match &result {
        Ok(v) => {
            let _ = app.emit("cloud-sync:status", v.clone());
        }
        Err(e) => {
            let _ = Connection::open(db_path).ok().map(|c| save_last_error(&c, e));
            let _ = app.emit("cloud-sync:status", json!({ "ok": false, "error": e }));
        }
    }
    result
}

fn build_status(conn: &Connection) -> Value {
    let (url, token) = load_cfg(conn);
    let (last_synced_at, last_mode, last_error, last_online_at): (String, String, String, String) = conn
        .query_row("SELECT last_synced_at, last_mode, last_error, last_online_at FROM sync_state WHERE id=1", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .unwrap_or_default();
    let online = if url.is_empty() || token.is_empty() {
        false
    } else if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&last_online_at) {
        let age = (chrono::Utc::now() - dt.with_timezone(&chrono::Utc)).num_seconds();
        age < 150
    } else {
        false
    };
    json!({
        "configured": !url.is_empty() && !token.is_empty(),
        "remoteUrl": url,
        "online": online,
        "syncing": SYNCING.load(Ordering::SeqCst),
        "lastSyncedAt": last_synced_at,
        "lastMode": last_mode,
        "lastOnlineAt": last_online_at,
        "lastError": last_error,
        "pending": pending_counts(conn),
        "deviceId": device_id(conn),
    })
}

/// Manual trigger from the UI.
#[tauri::command]
pub fn cloud_sync_now(app: AppHandle) -> Result<Value, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("dyeai.db");
    run_sync(&app, &db_path, "manual")
}

/// Save remote URL + API token (a JWT obtained from `{remote}/auth/login`).
#[tauri::command]
pub fn cloud_sync_configure(app: AppHandle, remote_url: String, token: String) -> Result<Value, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("dyeai.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let cleaned = remote_url.trim().trim_end_matches('/').to_string();
    let health_url = format!("{cleaned}/sync/health");
    let online = get_json_anon(&health_url, Duration::from_secs(5));
    conn.execute(
        "UPDATE sync_state SET remote_url=?1, token=?2, last_error='' WHERE id=1",
        params![cleaned, token.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "configured": true, "online": online }))
}

/// Current sync status for the Sync page / status chip.
#[tauri::command]
pub fn cloud_sync_status(app: AppHandle) -> Result<Value, String> {
    let db_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("dyeai.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    Ok(build_status(&conn))
}

/// Background auto-sync: every ~30 s, if configured and reachable, run a cycle.
pub fn start_auto(app: AppHandle, db_path: PathBuf) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let conn = match Connection::open(&db_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let cfg = load_cfg(&conn);
        drop(conn);
        if cfg.0.is_empty() || cfg.1.is_empty() {
            continue;
        }
        let health_url = format!("{}/sync/health", cfg.0);
        if get_json_anon(&health_url, Duration::from_secs(5)) {
            let _ = Connection::open(&db_path).ok().and_then(|c| {
                c.execute(
                    "UPDATE sync_state SET last_online_at=?1 WHERE id=1",
                    params![now_iso()],
                )
                .ok()
            });
            let _ = run_sync(&app, &db_path, "auto");
        }
    });
}