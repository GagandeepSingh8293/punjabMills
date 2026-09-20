use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use chrono::Datelike;
use crate::util::{self, upsert_challan};

pub struct DbState(pub Mutex<Connection>);

fn conn<'a>(state: &'a State<'_, DbState>) -> std::sync::MutexGuard<'a, Connection> {
    state.0.lock().unwrap()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

// ─────────────────────────── AUTH ───────────────────────────

#[tauri::command]
pub fn login(state: State<'_, DbState>, identifier: String, password: String) -> Result<Value, String> {
    let conn = conn(&state);
    let trimmed = identifier.trim();
    let normalized = trimmed.to_lowercase();
    let user: Option<(String, String, String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT id, name, role, email, phone, avatar_url FROM users WHERE lower(email)=?1 OR phone=?2",
            params![normalized, trimmed],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .ok();

    if let Some((id, name, role, email, phone, avatar)) = user {
        let stored_password: String = conn
            .query_row("SELECT password FROM users WHERE id=?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if stored_password == password {
            return Ok(json!({
                "id": id, "name": name, "role": role, "email": email, "phone": phone,
                "avatarUrl": avatar,
            }));
        }
    }
    Err("Incorrect email/phone or password. Please try again.".to_string())
}

#[tauri::command]
pub fn get_user(state: State<'_, DbState>, user_id: String) -> Result<Option<Value>, String> {
    let conn = conn(&state);
    let user = conn
        .query_row(
            "SELECT id, name, role, email, phone, avatar_url, password FROM users WHERE id=?1",
            params![user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                ))
            },
        )
        .ok();
    Ok(user.map(|(id, name, role, email, phone, avatar, _pw)| {
        json!({ "id": id, "name": name, "role": role, "email": email, "phone": phone, "avatarUrl": avatar })
    }))
}

#[tauri::command]
pub fn update_profile(state: State<'_, DbState>, user_id: String, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let email = payload.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let phone = payload.get("phone").and_then(|v| v.as_str()).unwrap_or("").to_string();
    conn.execute(
        "UPDATE users SET name=?1, email=?2, phone=?3 WHERE id=?4",
        params![name, email, phone, user_id.as_str()],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    get_user(state, user_id).and_then(|u| u.ok_or_else(|| "User not found".to_string()))
}

#[tauri::command]
pub fn update_avatar(state: State<'_, DbState>, user_id: String, avatar_url: Option<String>) -> Result<Value, String> {
    let conn = conn(&state);
    conn.execute("UPDATE users SET avatar_url=?1 WHERE id=?2", params![avatar_url, user_id.as_str()])
        .map_err(|e| e.to_string())?;
    drop(conn);
    get_user(state, user_id).and_then(|u| u.ok_or_else(|| "User not found".to_string()))
}

#[tauri::command]
pub fn change_password(
    state: State<'_, DbState>,
    user_id: String,
    current_password: String,
    new_password: String,
) -> Result<bool, String> {
    let conn = conn(&state);
    let stored: String = conn
        .query_row("SELECT password FROM users WHERE id=?1", params![user_id.as_str()], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if stored != current_password {
        return Err("Current password is incorrect".to_string());
    }
    if new_password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }
    conn.execute("UPDATE users SET password=?1 WHERE id=?2", params![new_password, user_id])
        .map_err(|e| e.to_string())?;
    Ok(true)
}

// ─────────────────────────── MASTERS ───────────────────────────

fn master_table(kind: &str) -> Result<&'static str, String> {
    Ok(match kind {
        "customers" => "customers",
        "hsn-codes" => "hsn_codes",
        "colours" => "colours",
        "processors" => "processors",
        "rate" => "rates",
        "rate-cards" => "rate_cards",
        "depth" => "depths",
        _ => return Err(format!("Unknown master type: {kind}")),
    })
}

fn snake_to_camel(col: &str) -> String {
    col.split('_')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect()
}

fn master_to_json(kind: &str, row: &rusqlite::Row) -> rusqlite::Result<Value> {
    let id: String = row.get(0)?;
    let created_at: String = row.get(row.as_ref().column_count() - 1)?;
    Ok(match kind {
        "customers" => {
            let name: String = row.get(1)?;
            let gstin: String = row.get(2)?;
            let address: String = row.get(3)?;
            let state: String = row.get(4)?;
            let state_code: String = row.get(5)?;
            json!({ "id": id, "name": name, "gstin": gstin, "address": address, "state": state, "stateCode": state_code, "createdAt": created_at })
        }
        "hsn-codes" => {
            let code: String = row.get(1)?;
            let description: String = row.get(2)?;
            let tax_rate: f64 = row.get(3)?;
            json!({ "id": id, "code": code, "description": description, "taxRate": tax_rate, "createdAt": created_at })
        }
        "colours" => {
            let name: String = row.get(1)?;
            let hex: String = row.get(2)?;
            json!({ "id": id, "name": name, "hex": hex, "createdAt": created_at })
        }
        "processors" => {
            let name: String = row.get(1)?;
            let contact_name: Option<String> = row.get(2)?;
            let phone: Option<String> = row.get(3)?;
            json!({ "id": id, "name": name, "contactName": contact_name, "phone": phone, "createdAt": created_at })
        }
        "rate" => {
            let value: f64 = row.get(1)?;
            json!({ "id": id, "value": value, "createdAt": created_at })
        }
        "rate-cards" => {
            let customer_name: String = row.get(1)?;
            let process: String = row.get(2)?;
            let depth: String = row.get(3)?;
            let fabric_quality: String = row.get(4)?;
            let value: f64 = row.get(5)?;
            json!({ "id": id, "customerName": customer_name, "process": process, "depth": depth, "fabricQuality": fabric_quality, "value": value, "createdAt": created_at })
        }
        "depth" => {
            let name: String = row.get(1)?;
            json!({ "id": id, "name": name, "createdAt": created_at })
        }
        _ => unreachable!(),
    })
}

/// Read the camelCase (or snake_case) field from a payload, mapped to its column value.
fn field_value(payload: &Value, col: &str) -> Value {
    let camel = snake_to_camel(col);
    let v = payload.get(&camel).or_else(|| payload.get(col));
    match col {
        "fabric_quality" => v.cloned().unwrap_or_else(|| json!("")),
        _ => v.cloned().unwrap_or(Value::Null),
    }
}

fn to_sql_value(v: Value) -> rusqlite::types::Value {
    match v {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(if b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        Value::String(s) => rusqlite::types::Value::Text(s),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}

const MASTER_COLUMNS: [(&str, &[&str]); 7] = [
    ("customers", &["name", "gstin", "address", "state", "state_code"]),
    ("hsn-codes", &["code", "description", "tax_rate"]),
    ("colours", &["name", "hex"]),
    ("processors", &["name", "contact_name", "phone"]),
    ("rate", &["value"]),
    ("rate-cards", &["customer_name", "process", "depth", "fabric_quality", "value"]),
    ("depth", &["name"]),
];

#[tauri::command]
pub fn list_masters(state: State<'_, DbState>, kind: String) -> Result<Vec<Value>, String> {
    let conn = conn(&state);
    let table = master_table(&kind)?;
    let sql = format!("SELECT * FROM {table} ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| master_to_json(&kind, row))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_master(state: State<'_, DbState>, kind: String, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let table = master_table(&kind)?;
    let cols = MASTER_COLUMNS
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, c)| *c)
        .ok_or_else(|| "Unknown master type".to_string())?;

    let id = nanoid::nanoid!(10);
    let created_at = now_iso();
    let mut values: Vec<rusqlite::types::Value> = Vec::with_capacity(cols.len() + 2);
    values.push(to_sql_value(json!(id.clone())));
    for col in cols {
        values.push(to_sql_value(field_value(&payload, col)));
    }
    values.push(to_sql_value(json!(created_at)));

    let placeholders: Vec<String> = (1..=values.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "INSERT INTO {table} (id, {}, created_at) VALUES ({})",
        cols.join(", "),
        placeholders.join(", ")
    );
    conn.execute(&sql, rusqlite::params_from_iter(values))
        .map_err(|e| e.to_string())?;

    conn.query_row(&format!("SELECT * FROM {table} WHERE id=?1"), params![id], |row| {
        master_to_json(&kind, row)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_master(state: State<'_, DbState>, kind: String, id: String, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let table = master_table(&kind)?;
    let cols = MASTER_COLUMNS
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, c)| *c)
        .ok_or_else(|| "Unknown master type".to_string())?;

    let sets: Vec<String> = cols.iter().enumerate().map(|(i, c)| format!("{c}=?{}", i + 1)).collect();
    let sql = format!("UPDATE {table} SET {} WHERE id=?{}", sets.join(", "), cols.len() + 1);
    let mut values: Vec<rusqlite::types::Value> = cols.iter().map(|c| to_sql_value(field_value(&payload, c))).collect();
    values.push(to_sql_value(json!(id.clone())));
    conn.execute(&sql, rusqlite::params_from_iter(values))
        .map_err(|e| e.to_string())?;

    conn.query_row(&format!("SELECT * FROM {table} WHERE id=?1"), params![id], |row| {
        master_to_json(&kind, row)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tenant_settings(state: State<'_, DbState>) -> Result<Value, String> {
    Ok(util::tenant_settings(&conn(&state)))
}

#[tauri::command]
pub fn save_tenant_settings(state: State<'_, DbState>, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let g = |k: &str| payload.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    conn.execute(
        "UPDATE tenant_settings SET company_name=?1, tagline=?2, gstin=?3, address=?4, state=?5, state_code=?6, email=?7, phone=?8 WHERE id='tenant'",
        params![g("companyName"), g("tagline"), g("gstin"), g("address"), g("state"), g("stateCode"), g("email"), g("phone")],
    )
    .map_err(|e| e.to_string())?;
    Ok(util::tenant_settings(&conn))
}

#[tauri::command]
pub fn get_job_work_settings(state: State<'_, DbState>) -> Result<Value, String> {
    Ok(util::job_work_settings(&conn(&state)))
}

#[tauri::command]
pub fn save_job_work_settings(state: State<'_, DbState>, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let sac_code = payload.get("sacCode").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let gst_rate = payload.get("gstRate").and_then(|v| v.as_f64()).unwrap_or(0.0);
    conn.execute(
        "UPDATE job_work_settings SET sac_code=?1, gst_rate=?2 WHERE id='job-work'",
        params![sac_code, gst_rate],
    )
    .map_err(|e| e.to_string())?;
    Ok(util::job_work_settings(&conn))
}

#[tauri::command]
pub fn get_invoice_numbering_settings(state: State<'_, DbState>) -> Result<Value, String> {
    Ok(util::invoice_numbering_settings(&conn(&state)))
}

#[tauri::command]
pub fn save_invoice_numbering_settings(state: State<'_, DbState>, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let prefix = payload.get("prefix").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let series_mode = payload.get("seriesMode").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let padding_digits = payload.get("paddingDigits").and_then(|v| v.as_i64()).unwrap_or(4);
    conn.execute(
        "UPDATE invoice_numbering_settings SET prefix=?1, series_mode=?2, padding_digits=?3 WHERE id='invnum'",
        params![prefix, series_mode, padding_digits],
    )
    .map_err(|e| e.to_string())?;
    Ok(util::invoice_numbering_settings(&conn))
}

// ─────────────────────────── CHALLANS ───────────────────────────

fn acc<'a>(m: &'a Value, k: &str) -> Option<&'a str> {
    m.get(k).and_then(|v| v.as_str())
}

fn str_arg(m: &Value, k: &str) -> Option<String> {
    m.get(k).and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

fn bool_arg(m: &Value, k: &str) -> bool {
    m.get(k)
        .map(|v| match v {
            Value::Bool(b) => *b,
            Value::String(s) => s == "true" || s == "1",
            Value::Number(n) => n.as_i64() == Some(1),
            _ => false,
        })
        .unwrap_or(false)
}

fn usize_arg(m: &Value, k: &str, default: usize) -> usize {
    m.get(k)
        .and_then(|v| match v {
            Value::Number(n) => n.as_u64().map(|u| u as usize),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .unwrap_or(default)
        .max(1)
}

/// Mirror of `challanEffectiveStatus` support fields: add `billed`, and for incoming
/// challans the dispatched/pending weight.
fn enrich_challan(conn: &Connection, c: &Value) -> Value {
    let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let incoming = acc(c, "documentType") == Some("incoming");
    let mut out = c.clone();
    if let Value::Object(map) = &mut out {
        map.insert("billed".to_string(), json!(util::is_challan_billed(conn, &id, None)));
        if incoming {
            let dispatched = util::dispatched_weight(conn, &id);
            let total = util::challan_total_weight(c);
            map.insert("dispatchedWeight".to_string(), json!(dispatched));
            map.insert("pendingWeight".to_string(), json!(total - dispatched));
        }
    }
    out
}

#[tauri::command]
pub fn get_challan(state: State<'_, DbState>, id: String) -> Result<Value, String> {
    let conn = conn(&state);
    let record = util::challan_by_id(&conn, &id).ok_or_else(|| "Not found".to_string())?;
    Ok(enrich_challan(&conn, &record))
}

#[tauri::command]
pub fn list_challans(state: State<'_, DbState>, filters: Value) -> Result<Value, String> {
    let conn = conn(&state);

    let q = str_arg(&filters, "q").map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let document_type = str_arg(&filters, "documentType");
    let from = str_arg(&filters, "from");
    let to = str_arg(&filters, "to");
    let exclude_billed = bool_arg(&filters, "excludeBilled");
    let exclude_invoice_id = str_arg(&filters, "excludeInvoiceId");
    let pending_only = bool_arg(&filters, "pendingOnly");
    let page = usize_arg(&filters, "page", 1);
    let page_size = usize_arg(&filters, "pageSize", 10);

    let challan_no = str_arg(&filters, "challanNo").map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let lot = str_arg(&filters, "lot").map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let vehicle_no = str_arg(&filters, "vehicleNo");
    let customer = str_arg(&filters, "customer");
    let destination = str_arg(&filters, "destination");
    let weight = str_arg(&filters, "weight");
    let hsn = str_arg(&filters, "hsn");
    let colour = str_arg(&filters, "colour");
    let depth = str_arg(&filters, "depth");
    let status = str_arg(&filters, "status");
    let date = str_arg(&filters, "date");

    let all = util::all_challans(&conn);
    let mut items: Vec<&Value> = all.iter().collect();

    if let Some(dt) = &document_type {
        items.retain(|c| acc(c, "documentType") == Some(dt.as_str()));
    }
    if exclude_billed {
        items.retain(|c| {
            !util::is_challan_billed(&conn, acc(c, "id").unwrap_or(""), exclude_invoice_id.as_deref())
        });
    }
    if pending_only {
        items.retain(|c| {
            if acc(c, "documentType") != Some("incoming") {
                return false;
            }
            let id = acc(c, "id").unwrap_or("").to_string();
            let total = util::challan_total_weight(c);
            let dispatched = util::dispatched_weight(&conn, &id);
            total - dispatched > 0.0
        });
    }
    if let Some(f) = &from {
        items.retain(|c| acc(c, "challanDate").map(|d| d >= f.as_str()).unwrap_or(false));
    }
    if let Some(t) = &to {
        items.retain(|c| acc(c, "challanDate").map(|d| d <= t.as_str()).unwrap_or(false));
    }
    if let Some(d) = &date {
        items.retain(|c| acc(c, "challanDate") == Some(d.as_str()));
    }
    if !challan_no.is_empty() {
        items.retain(|c| {
            c.get("header")
                .and_then(|h| h.get("challanNo"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase()
                .contains(&challan_no)
        });
    }
    if !lot.is_empty() {
        items.retain(|c| {
            c.get("lineItems")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .any(|li| li.get("lotNo").and_then(|v| v.as_str()).unwrap_or("").to_lowercase().contains(&lot))
                })
                .unwrap_or(false)
        });
    }
    if let Some(v) = &vehicle_no {
        items.retain(|c| header_field(c, "vehicleNo") == Some(v.as_str()));
    }
    if let Some(v) = &customer {
        items.retain(|c| party_field(c, "billing", "name") == Some(v.as_str()));
    }
    if let Some(v) = &destination {
        items.retain(|c| party_field(c, "shipping", "name") == Some(v.as_str()));
    }
    if let Some(w) = &weight {
        items.retain(|c| util::challan_total_weight(c).to_string() == *w);
    }
    if let Some(h) = &hsn {
        items.retain(|c| util::distinct_line_item_values(c, "hsnCode").iter().any(|v| v == h));
    }
    if let Some(c2) = &colour {
        items.retain(|c| util::distinct_line_item_values(c, "colour").iter().any(|v| v == c2));
    }
    if let Some(d) = &depth {
        items.retain(|c| util::distinct_line_item_values(c, "depth").iter().any(|v| v == d));
    }
    if let Some(s) = &status {
        items.retain(|c| util::effective_status(&conn, c) == *s);
    }
    if !q.is_empty() {
        items.retain(|c| {
            let hay: Vec<String> = [
                c.get("header").and_then(|h| h.get("challanNo")).and_then(|v| v.as_str()),
                c.get("header").and_then(|h| h.get("vehicleNo")).and_then(|v| v.as_str()),
                c.get("header").and_then(|h| h.get("billing")).and_then(|b| b.get("name")).and_then(|v| v.as_str()),
                c.get("header").and_then(|h| h.get("shipping")).and_then(|b| b.get("name")).and_then(|v| v.as_str()),
            ]
            .into_iter()
            .flatten()
            .map(|s| s.to_lowercase())
            .collect();
            hay.iter().any(|s| s.contains(&q))
                || c.get("lineItems")
                    .and_then(|v| v.as_array())
                    .map(|items| items.iter().any(|li| li.get("lotNo").and_then(|v| v.as_str()).unwrap_or("").to_lowercase().contains(&q)))
                    .unwrap_or(false)
        });
    }

    let total = items.len();
    let start = ((page - 1) * page_size).min(total);
    let end = (start + page_size).min(total);
    let page_items: Vec<Value> = items[start..end].iter().map(|c| enrich_challan(&conn, c)).collect();

    Ok(json!({ "items": page_items, "total": total, "page": page, "pageSize": page_size }))
}

fn header_field<'a>(c: &'a Value, field: &str) -> Option<&'a str> {
    c.get("header").and_then(|h| h.get(field)).and_then(|v| v.as_str())
}

fn party_field<'a>(c: &'a Value, party: &str, field: &str) -> Option<&'a str> {
    c.get("header")
        .and_then(|h| h.get(party))
        .and_then(|p| p.get(field))
        .and_then(|v| v.as_str())
}

#[tauri::command]
pub fn create_challan(
    state: State<'_, DbState>,
    payload: Value,
    session_id: Option<String>,
) -> Result<Value, String> {
    let conn = conn(&state);
    let id = nanoid::nanoid!(10);
    let mut record = payload;

    if let Value::Object(map) = &mut record {
        map.insert("id".to_string(), json!(id));
        map.insert("status".to_string(), json!("saved"));
        map.insert("createdAt".to_string(), json!(now_iso()));

        let needs_default_no = map
            .get("header")
            .and_then(|h| h.get("challanNo"))
            .map(|v| v.is_null() || v.as_str().map(|s| s.is_empty()).unwrap_or(true))
            .unwrap_or(true);
        if needs_default_no {
            if let Some(Value::Object(header)) = map.get_mut("header") {
                let no = format!("CH-{}", id[..6].to_uppercase());
                header.insert("challanNo".to_string(), json!(no));
            }
        }
    }

    upsert_challan(&conn, &record).map_err(|e| e.to_string())?;
    record_scan_corrections(&conn, session_id.as_deref(), &id, &record);
    Ok(enrich_challan(&conn, &record))
}

#[tauri::command]
pub fn update_challan(
    state: State<'_, DbState>,
    id: String,
    payload: Value,
    session_id: Option<String>,
) -> Result<Value, String> {
    let conn = conn(&state);
    let existing = util::challan_by_id(&conn, &id).ok_or_else(|| "Not found".to_string())?;
    let existing_created = existing.get("createdAt").cloned();

    let mut record = payload;
    if let Value::Object(map) = &mut record {
        map.insert("id".to_string(), json!(id));
        if let Some(created) = existing_created {
            map.insert("createdAt".to_string(), created);
        }
    }

    upsert_challan(&conn, &record).map_err(|e| e.to_string())?;
    record_scan_corrections(&conn, session_id.as_deref(), &id, &record);
    Ok(enrich_challan(&conn, &record))
}

fn distinct_opt<'a>(values: impl Iterator<Item = Option<&'a str>>) -> Vec<String> {
    util::distinct_sorted(values.flatten().map(|s| s.to_string()))
}

#[tauri::command]
pub fn get_challan_filter_options(state: State<'_, DbState>, document_type: Option<String>) -> Result<Value, String> {
    let conn = conn(&state);
    let items: Vec<Value> = match &document_type {
        Some(dt) => util::all_challans(&conn)
            .into_iter()
            .filter(|c| acc(c, "documentType") == Some(dt.as_str()))
            .collect(),
        None => util::all_challans(&conn),
    };

    let unique_line = |field: &str| -> Vec<String> {
        let mut all: Vec<String> = items.iter().flat_map(|c| util::distinct_line_item_values(c, field)).collect();
        all.sort();
        all.dedup();
        all
    };

    Ok(json!({
        "totalCount": items.len(),
        "vehicleNo": distinct_opt(items.iter().map(|c| header_field(c, "vehicleNo"))),
        "customer": distinct_opt(items.iter().map(|c| party_field(c, "billing", "name"))),
        "destination": distinct_opt(items.iter().map(|c| party_field(c, "shipping", "name"))),
        "weight": util::distinct_sorted(items.iter().map(|c| util::challan_total_weight(c).to_string())),
        "hsn": unique_line("hsnCode"),
        "colour": unique_line("colour"),
        "depth": unique_line("depth"),
        "status": util::distinct_sorted(items.iter().map(|c| util::effective_status(&conn, c))),
    }))
}

#[tauri::command]
pub fn list_invoices(
    state: State<'_, DbState>,
    q: Option<String>,
    status: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<Value, String> {
    let conn = conn(&state);
    let q = q.unwrap_or_default().trim().to_lowercase();
    let page = page.unwrap_or(1).max(1) as usize;
    let page_size = page_size.unwrap_or(10).max(1) as usize;

    let mut items: Vec<Value> = util::all_invoices(&conn);
    if let Some(s) = &status {
        items.retain(|i| acc(i, "status") == Some(s.as_str()));
    }
    if !q.is_empty() {
        items.retain(|i| {
            i.get("invoiceNo").and_then(|v| v.as_str()).unwrap_or("").to_lowercase().contains(&q)
                || i.get("header")
                    .and_then(|h| h.get("billing"))
                    .and_then(|b| b.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
        });
    }
    items.sort_by(|a, b| acc(b, "createdAt").unwrap_or("").cmp(acc(a, "createdAt").unwrap_or("")));

    let total = items.len();
    let start = ((page - 1) * page_size).min(total);
    let end = (start + page_size).min(total);
    let page_items: Vec<Value> = items[start..end].to_vec();

    Ok(json!({ "items": page_items, "total": total, "page": page, "pageSize": page_size }))
}

#[tauri::command]
pub fn get_invoice(state: State<'_, DbState>, id: String) -> Result<Value, String> {
    let conn = conn(&state);
    util::invoice_by_id(&conn, &id).ok_or_else(|| "Not found".to_string())
}

#[tauri::command]
pub fn generate_invoices(state: State<'_, DbState>, challan_ids: Vec<String>) -> Result<Value, String> {
    let conn = conn(&state);
    if challan_ids.is_empty() {
        return Err("Select at least one Outgoing Challan".to_string());
    }

    let mut challans: Vec<Value> = Vec::new();
    for cid in &challan_ids {
        let c = util::challan_by_id(&conn, cid).ok_or_else(|| format!("Challan(s) not found: {cid}"))?;
        challans.push(c);
    }
    for c in &challans {
        if acc(c, "documentType") != Some("outgoing") {
            let cid = acc(c, "id").unwrap_or("").to_string();
            return Err(format!("Only Outgoing Challans can be billed: {cid}"));
        }
    }
    for cid in &challan_ids {
        if util::is_challan_billed(&conn, cid, None) {
            return Err(format!("Challan(s) already billed: {cid}"));
        }
    }

    let refs: Vec<&Value> = challans.iter().collect();
    let invoice = build_invoice(&conn, &refs)?;
    util::upsert_invoice(&conn, &invoice).map_err(|e| e.to_string())?;
    Ok(invoice)
}

fn build_invoice(conn: &Connection, challans: &[&Value]) -> Result<Value, String> {
    let id = nanoid::nanoid!(10);
    let invoice_date = today();
    let invoice_no = util::next_invoice_number(conn, &invoice_date).map_err(|e| e.to_string())?;
    let first = challans[0];
    let billing = first.get("header").and_then(|h| h.get("billing")).cloned().unwrap_or(Value::Null);
    let shipping = first
        .get("header")
        .and_then(|h| h.get("shipping"))
        .cloned()
        .filter(|v| !v.is_null())
        .or_else(|| Some(billing.clone()))
        .unwrap_or(Value::Null);
    let line_data = util::compute_invoice_line_data(conn, challans);

    Ok(json!({
        "id": id,
        "invoiceNo": invoice_no,
        "invoiceDate": invoice_date,
        "status": "draft",
        "challanIds": challans.iter().map(|c| c.get("id").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
        "header": { "billing": billing, "shipping": shipping },
        "lineGroups": line_data["lineGroups"].clone(),
        "warnings": line_data["warnings"].clone(),
        "taxLines": line_data["taxLines"].clone(),
        "totals": line_data["totals"].clone(),
        "createdAt": now_iso(),
    }))
}

#[tauri::command]
pub fn update_invoice_status(state: State<'_, DbState>, id: String, status: String) -> Result<Value, String> {
    let conn = conn(&state);
    let current = util::invoice_by_id(&conn, &id).ok_or_else(|| "Not found".to_string())?;
    let current_status = acc(&current, "status").unwrap_or("").to_string();
    let allowed: Vec<&str> = match current_status.as_str() {
        "draft" => vec!["sent"],
        "sent" => vec!["paid"],
        _ => vec![],
    };
    if !allowed.contains(&status.as_str()) {
        return Err(format!("Cannot move invoice from \"{current_status}\" to \"{status}\""));
    }
    let mut updated = current;
    if let Value::Object(map) = &mut updated {
        map.insert("status".to_string(), json!(status));
    }
    util::upsert_invoice(&conn, &updated).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub fn update_invoice_details(state: State<'_, DbState>, id: String, payload: Value) -> Result<Value, String> {
    let conn = conn(&state);
    let current = util::invoice_by_id(&conn, &id).ok_or_else(|| "Not found".to_string())?;
    let current_status = acc(&current, "status").unwrap_or("").to_string();
    if current_status != "draft" {
        return Err("Only draft invoices can be edited.".to_string());
    }

    let mut updated = current;
    if let Some(Value::String(d)) = payload.get("invoiceDate") {
        updated["invoiceDate"] = json!(d);
    }
    if let Some(header) = payload.get("header") {
        updated["header"] = header.clone();
    }

    if let Some(ids) = payload.get("challanIds").and_then(|v| v.as_array()) {
        let challan_ids: Vec<String> = ids
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if challan_ids.is_empty() {
            return Err("Select at least one Outgoing Challan".to_string());
        }

        let mut challans: Vec<Value> = Vec::new();
        for cid in &challan_ids {
            let c = util::challan_by_id(&conn, cid).ok_or_else(|| format!("Challan(s) not found: {cid}"))?;
            challans.push(c);
        }
        for c in &challans {
            if acc(c, "documentType") != Some("outgoing") {
                return Err(format!(
                    "Only Outgoing Challans can be billed: {}",
                    acc(c, "id").unwrap_or("")
                ));
            }
        }
        for cid in &challan_ids {
            if util::is_challan_billed(&conn, cid, Some(&id)) {
                return Err(format!("Challan(s) already billed: {cid}"));
            }
        }

        let refs: Vec<&Value> = challans.iter().collect();
        let line_data = util::compute_invoice_line_data(&conn, &refs);
        if let Value::Object(map) = &mut updated {
            map.insert("challanIds".to_string(), json!(challan_ids));
            map.insert("lineGroups".to_string(), line_data["lineGroups"].clone());
            map.insert("warnings".to_string(), line_data["warnings"].clone());
            map.insert("taxLines".to_string(), line_data["taxLines"].clone());
            map.insert("totals".to_string(), line_data["totals"].clone());
        }
    }

    util::upsert_invoice(&conn, &updated).map_err(|e| e.to_string())?;
    Ok(updated)
}

// ─────────────────────────── DASHBOARD / ACTIVITY / SEARCH ───────────────────────────

#[tauri::command]
pub fn get_dashboard_stats(state: State<'_, DbState>) -> Result<Value, String> {
    let conn = conn(&state);
    let today = today();
    let all = util::all_challans(&conn);
    let invoices = util::all_invoices(&conn);

    let incoming_today: Vec<&Value> = all
        .iter()
        .filter(|c| acc(c, "documentType") == Some("incoming") && header_field(c, "challanDate") == Some(today.as_str()))
        .collect();
    let outgoing_today: Vec<&Value> = all
        .iter()
        .filter(|c| acc(c, "documentType") == Some("outgoing") && header_field(c, "challanDate") == Some(today.as_str()))
        .collect();

    let pending_billing = all
        .iter()
        .filter(|c| {
            acc(c, "documentType") == Some("outgoing")
                && !util::is_challan_billed(&conn, acc(c, "id").unwrap_or(""), None)
        })
        .count();

    let year = chrono::Utc::now().year();
    let month = chrono::Utc::now().month() as u32;
    let invoices_this_month: Vec<&Value> = invoices
        .iter()
        .filter(|i| {
            acc(i, "createdAt")
                .and_then(|d| {
                    if d.len() >= 10 {
                        Some((d[0..4].parse::<i32>().unwrap_or(0), d[5..7].parse::<u32>().unwrap_or(0)))
                    } else {
                        None
                    }
                })
                .map(|(cy, cm)| cy == year && cm == month)
                .unwrap_or(false)
        })
        .collect();

    let billed_this_month_value: f64 = invoices_this_month
        .iter()
        .map(|i| i.get("totals").and_then(|t| t.get("grandTotal")).and_then(|v| v.as_f64()).unwrap_or(0.0))
        .sum();

    let mut status_counts = [0i64, 0, 0]; // draft, saved, billed
    for c in &all {
        match util::effective_status(&conn, c).as_str() {
            "draft" => status_counts[0] += 1,
            "saved" => status_counts[1] += 1,
            _ => status_counts[2] += 1,
        }
    }

    Ok(json!({
        "totalChallans": all.len(),
        "incomingToday": { "count": incoming_today.len(), "pendingReview": incoming_today.iter().filter(|c| acc(c, "status") == Some("draft")).count() },
        "outgoingToday": { "count": outgoing_today.len(), "awaitingDispatch": outgoing_today.iter().filter(|c| acc(c, "status") == Some("draft")).count() },
        "pendingBilling": pending_billing,
        "billedThisMonth": { "count": invoices_this_month.len(), "totalValue": billed_this_month_value },
        "statusBreakdown": [
            { "status": "draft", "count": status_counts[0] },
            { "status": "saved", "count": status_counts[1] },
            { "status": "billed", "count": status_counts[2] }
        ],
    }))
}

#[tauri::command]
pub fn get_activity_feed(state: State<'_, DbState>, limit: Option<i64>) -> Result<Value, String> {
    let conn = conn(&state);
    let limit = limit.unwrap_or(8).max(1) as usize;
    let actor: String = conn
        .query_row("SELECT name FROM users ORDER BY id LIMIT 1", [], |r| r.get(0))
        .unwrap_or_else(|_| "Haninder Singh".to_string());

    let mut entries: Vec<Value> = Vec::new();
    for c in util::all_challans(&conn) {
        let is_outgoing = acc(&c, "documentType") == Some("outgoing");
        let label = if is_outgoing { "Outgoing Challan" } else { "Incoming Challan" };
        let id = acc(&c, "id").unwrap_or("").to_string();
        let ref_val = c
            .get("header")
            .and_then(|h| h.get("challanNo"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(acc(&c, "id").unwrap_or("Untitled"))
            .to_string();
        entries.push(json!({
            "id": format!("challan-{id}"),
            "type": if is_outgoing { "outgoing_challan" } else { "incoming_challan" },
            "recordId": id,
            "description": format!("{label} {ref_val} created"),
            "actor": actor,
            "timestamp": acc(&c, "createdAt").unwrap_or("").to_string(),
        }));
    }
    for i in util::all_invoices(&conn) {
        let id = acc(&i, "id").unwrap_or("").to_string();
        let no = i.get("invoiceNo").and_then(|v| v.as_str()).unwrap_or("").to_string();
        entries.push(json!({
            "id": format!("invoice-{id}"),
            "type": "invoice",
            "recordId": id,
            "description": format!("Invoice {no} generated"),
            "actor": actor,
            "timestamp": acc(&i, "createdAt").unwrap_or("").to_string(),
        }));
    }
    entries.sort_by(|a, b| acc(b, "timestamp").unwrap_or("").cmp(acc(a, "timestamp").unwrap_or("")));
    entries.truncate(limit);
    Ok(json!({ "items": entries }))
}

#[tauri::command]
pub fn global_search(state: State<'_, DbState>, q: String) -> Result<Value, String> {
    let conn = conn(&state);
    let q = q.trim().to_lowercase();
    if q.is_empty() {
        return Ok(json!({ "challans": { "items": [], "total": 0 }, "customers": { "items": [], "total": 0 } }));
    }

    let matching: Vec<Value> = util::all_challans(&conn)
        .into_iter()
        .filter(|c| {
            [
                c.get("header").and_then(|h| h.get("challanNo")).and_then(|v| v.as_str()),
                c.get("header").and_then(|h| h.get("vehicleNo")).and_then(|v| v.as_str()),
                c.get("header").and_then(|h| h.get("billing")).and_then(|b| b.get("name")).and_then(|v| v.as_str()),
                c.get("header").and_then(|h| h.get("shipping")).and_then(|b| b.get("name")).and_then(|v| v.as_str()),
            ]
            .into_iter()
            .flatten()
            .any(|s| s.to_lowercase().contains(&q))
                || c.get("lineItems")
                    .and_then(|v| v.as_array())
                    .map(|items| items.iter().any(|li| li.get("lotNo").and_then(|v| v.as_str()).unwrap_or("").to_lowercase().contains(&q)))
                    .unwrap_or(false)
        })
        .collect();

    let challan_items: Vec<Value> = matching
        .iter()
        .take(5)
        .map(|c| {
            let id = acc(c, "id").unwrap_or("").to_string();
            let vehicle = header_field(c, "vehicleNo").unwrap_or("").to_string();
            let no = c.get("header").and_then(|h| h.get("challanNo")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let customer = party_field(c, "billing", "name").unwrap_or("").to_string();
            let subtitle = [no.clone(), customer]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            json!({
                "id": id,
                "title": if !vehicle.is_empty() { vehicle } else if !no.is_empty() { no } else { "Untitled challan".to_string() },
                "subtitle": subtitle,
                "href": format!("/challans/{id}"),
            })
        })
        .collect();

    let mut counts: Vec<(String, i64)> = Vec::new();
    for c in util::all_challans(&conn) {
        for name in [party_field(&c, "billing", "name"), party_field(&c, "shipping", "name")]
            .into_iter()
            .flatten()
        {
            if name.to_lowercase().contains(&q) {
                if let Some((_, count)) = counts.iter_mut().find(|(n, _)| n == name) {
                    *count += 1;
                } else {
                    counts.push((name.to_string(), 1));
                }
            }
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    let customer_items: Vec<Value> = counts
        .iter()
        .take(5)
        .map(|(name, count)| {
            json!({
                "id": name,
                "title": name,
                "subtitle": format!("{count} challan{}", if *count == 1 { "" } else { "s" }),
                "href": format!("/challans?q={}", urlencode(name)),
            })
        })
        .collect();

    Ok(json!({
        "challans": { "items": challan_items, "total": matching.len() },
        "customers": { "items": customer_items, "total": counts.len() },
    }))
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ─────────────────────────── SCAN / OCR MOCK ───────────────────────────

/// Canned demo OCR pipeline (mirrors `simulateOcrPipeline` in server.ts): emits
/// `challan:processing`, `challan:type-detected`, then `challan:fields-updated`.
#[tauri::command]
pub fn process_scan_capture(state: State<'_, DbState>, app: AppHandle, session_id: String) -> Result<(), String> {
    let conn = conn(&state);
    conn.execute(
        "INSERT INTO scan_sessions (session_id, created_at, extracted_json)
         VALUES (?1,?2,NULL)
         ON CONFLICT(session_id) DO NOTHING",
        params![session_id.as_str(), now_iso()],
    )
    .map_err(|e| e.to_string())?;

    app.emit("challan:processing", ()).map_err(|e| e.to_string())?;

    let header = json!({
        "vehicleNo": "GJ-05-CX-7743",
        "eWayNo": "441209887225",
        "billing": {
            "name": "Om Textiles Pvt Ltd",
            "address": "12, Ring Road Market, Surat, Gujarat",
            "gstin": "24AABCO1234M1ZQ",
            "state": "Gujarat",
            "stateCode": "24",
            "mobile": ""
        },
        "shipping": {
            "name": "Om Textiles Pvt Ltd",
            "address": "12, Ring Road Market, Surat, Gujarat",
            "gstin": "24AABCO1234M1ZQ",
            "state": "Gujarat",
            "stateCode": "24",
            "mobile": "9825098250"
        }
    });
    let line_items = json!([{
        "id": "ocr-li-1",
        "particulars": "Dyed Fabric",
        "hsnCode": "540752",
        "lotNo": "LOT-3001",
        "colour": "Mustard",
        "depth": "Medium",
        "processName": "Dyeing",
        "roll": 12,
        "weight": 480,
        "rate": 46,
        "ribRoll": null,
        "ribWeight": null
    }]);
    let confidence = json!({
        "header.vehicleNo": 0.94,
        "header.eWayNo": 0.61,
        "header.billing.name": 0.98,
        "header.billing.address": 0.86,
        "header.billing.gstin": 0.95,
        "header.billing.state": 0.99,
        "header.billing.stateCode": 0.99,
        "header.billing.mobile": 0.55,
        "header.shipping.name": 0.98,
        "header.shipping.address": 0.86,
        "header.shipping.gstin": 0.95,
        "header.shipping.state": 0.99,
        "header.shipping.stateCode": 0.99,
        "header.shipping.mobile": 0.82,
        "lineItems.0.particulars": 0.97,
        "lineItems.0.hsnCode": 0.88,
        "lineItems.0.lotNo": 0.93,
        "lineItems.0.colour": 0.81,
        "lineItems.0.depth": 0.79,
        "lineItems.0.processName": 0.9,
        "lineItems.0.roll": 0.82,
        "lineItems.0.weight": 0.92,
        "lineItems.0.rate": 0.98,
        "lineItems.0.ribRoll": 0.64,
        "lineItems.0.ribWeight": 0.64
    });
    let patch = json!({ "header": header, "lineItems": line_items, "confidence": confidence });

    conn.execute(
        "UPDATE scan_sessions SET extracted_json=?1 WHERE session_id=?2",
        params![patch.to_string(), session_id],
    )
    .map_err(|e| e.to_string())?;

    let app_events = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        let _ = app_events.emit("challan:type-detected", json!({ "type": "incoming" }));
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = app_events.emit(
            "challan:fields-updated",
            json!({ "header": header, "lineItems": line_items, "confidence": confidence }),
        );
    });

    Ok(())
}

/// Returns the remembered extraction for a scan session (as FieldsUpdatedPayload) or null.
#[tauri::command]
pub fn get_scan_extraction(state: State<'_, DbState>, session_id: String) -> Result<Option<Value>, String> {
    let conn = conn(&state);
    let value: Option<String> = conn
        .query_row("SELECT extracted_json FROM scan_sessions WHERE session_id=?1", params![session_id], |r| {
            r.get(0)
        })
        .ok()
        .flatten();
    Ok(value.and_then(|s| serde_json::from_str::<Value>(&s).ok()))
}

/// Diff the AI extraction against what the user saved and log each divergence — mirrors
/// `diffChallanCorrections` + `recordScanCorrections` (#101).
fn record_scan_corrections(conn: &Connection, session_id: Option<&str>, challan_id: &str, saved: &Value) {
    let session_id = match session_id {
        Some(s) if !s.is_empty() => s,
        _ => return,
    };
    let extraction: Option<String> = conn
        .query_row("SELECT extracted_json FROM scan_sessions WHERE session_id=?1", [session_id], |r| r.get(0))
        .ok()
        .flatten();
    let Some(raw) = extraction else { return };
    let Ok(patch) = serde_json::from_str::<Value>(&raw) else { return };
    let Some(confidence) = patch.get("confidence").and_then(|c| c.as_object()).cloned() else {
        return;
    };
    let Some(header) = patch.get("header").cloned() else { return };
    let saved_header = saved.get("header").cloned().unwrap_or(Value::Null);

    let saved_leaves: std::collections::HashMap<String, Value> = flatten(&saved_header).into_iter().collect();
    for (leaf, ai_value) in flatten(&header) {
        let full_path = format!("header.{leaf}");
        if !confidence.contains_key(&full_path) {
            continue;
        }
        let saved_value = saved_leaves.get(&leaf).cloned().unwrap_or(Value::Null);
        if normalized(&saved_value) != normalized(&ai_value) {
            let conf = confidence.get(&full_path).and_then(|v| v.as_f64());
            log_correction(conn, session_id, challan_id, &full_path, &ai_value, &saved_value, conf);
        }
    }

    if let Some(ai_items) = patch.get("lineItems").and_then(|v| v.as_array()) {
        let saved_items = saved.get("lineItems").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for (index, ai_item) in ai_items.iter().enumerate() {
            let Some(ai_obj) = ai_item.as_object() else { continue };
            let saved_item = saved_items.get(index).cloned().unwrap_or(Value::Null);
            for (field, ai_value) in ai_obj {
                if field == "id" {
                    continue;
                }
                let full_path = format!("lineItems.{index}.{field}");
                if !confidence.contains_key(&full_path) {
                    continue;
                }
                let saved_value = saved_item.get(field).cloned().unwrap_or(Value::Null);
                if normalized(&saved_value) != normalized(ai_value) {
                    let conf = confidence.get(&full_path).and_then(|v| v.as_f64());
                    log_correction(conn, session_id, challan_id, &full_path, ai_value, &saved_value, conf);
                }
            }
        }
    }
}

fn normalized(v: &Value) -> String {
    match v {
        Value::Null => "".to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn flatten(obj: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if let Value::Object(map) = obj {
        for (k, v) in map {
            match v {
                Value::Object(_) => {
                    for (sub, subv) in flatten(v) {
                        out.push((format!("{k}.{sub}"), subv));
                    }
                }
                other => out.push((k.clone(), other.clone())),
            }
        }
    }
    out
}

fn log_correction(
    conn: &Connection,
    session_id: &str,
    challan_id: &str,
    path: &str,
    ai_value: &Value,
    saved_value: &Value,
    confidence: Option<f64>,
) {
    let id = nanoid::nanoid!(10);
    let _ = conn.execute(
        "INSERT INTO correction_logs (id, session_id, challan_id, path, ai_value_json, saved_value_json, confidence, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            session_id,
            challan_id,
            path,
            ai_value.to_string(),
            saved_value.to_string(),
            confidence,
            now_iso()
        ],
    );
}