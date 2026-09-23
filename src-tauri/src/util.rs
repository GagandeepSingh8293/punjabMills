use rusqlite::{Connection, params};
use serde_json::{json, Value};

use crate::db::round2;

/// All challan records as parsed JSON values (data_json), including id/createdAt.
pub fn all_challans(conn: &Connection) -> Vec<Value> {
    let mut stmt = conn
        .prepare("SELECT data_json FROM challans ORDER BY created_at DESC")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|s| s.ok())
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect()
}

pub fn challan_by_id(conn: &Connection, id: &str) -> Option<Value> {
    conn.query_row(
        "SELECT data_json FROM challans WHERE id=?1",
        [id],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn upsert_challan(conn: &Connection, record: &Value) -> rusqlite::Result<()> {
    let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let document_type = record.get("documentType").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let status = record.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let challan_date = record
        .get("header")
        .and_then(|h| h.get("challanDate"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let created_at = record
        .get("createdAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // A write from the desktop app marks the row as pending cloud sync.
    let updated_at = crate::syncengine::now_iso();
    let data_json = record.to_string();
    conn.execute(
        "INSERT INTO challans (id, document_type, status, challan_date, data_json, created_at, updated_at, pending_sync)
         VALUES (?1,?2,?3,?4,?5,?6,?7,1)
         ON CONFLICT(id) DO UPDATE SET document_type=?2, status=?3, challan_date=?4, data_json=?5, updated_at=?7, pending_sync=1",
        params![id, document_type, status, challan_date, data_json, created_at, updated_at],
    )?;
    Ok(())
}

/// All invoices as parsed JSON values (data_json).
pub fn all_invoices(conn: &Connection) -> Vec<Value> {
    let mut stmt = conn
        .prepare("SELECT data_json FROM invoices ORDER BY created_at DESC")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|s| s.ok())
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect()
}

pub fn invoice_by_id(conn: &Connection, id: &str) -> Option<Value> {
    conn.query_row(
        "SELECT data_json FROM invoices WHERE id=?1",
        [id],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn upsert_invoice(conn: &Connection, invoice: &Value) -> rusqlite::Result<()> {
    let id = invoice.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let status = invoice.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let invoice_date = invoice.get("invoiceDate").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let created_at = invoice.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string();
    conn.execute(
        "INSERT INTO invoices (id, status, invoice_date, data_json, created_at)
         VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET status=?2, invoice_date=?3, data_json=?4",
        params![id, status, invoice_date, invoice.to_string(), created_at],
    )?;
    Ok(())
}

/// True once a challan has been included in any generated invoice (mirrors `isChallanBilled`).
pub fn is_challan_billed(conn: &Connection, challan_id: &str, exclude_invoice_id: Option<&str>) -> bool {
    all_invoices(conn).iter().any(|inv| {
        if let Some(ex) = exclude_invoice_id {
            if inv.get("id").and_then(|v| v.as_str()) == Some(ex) {
                return false;
            }
        }
        inv.get("challanIds")
            .and_then(|v| v.as_array())
            .map(|ids| ids.iter().any(|id| id.as_str() == Some(challan_id)))
            .unwrap_or(false)
    })
}

/// Effective challan status: "billed" overrides draft/saved (mirrors `challanEffectiveStatus`).
pub fn effective_status(conn: &Connection, challan: &Value) -> String {
    let id = challan.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if is_challan_billed(conn, &id, None) {
        "billed".to_string()
    } else {
        challan
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("draft")
            .to_string()
    }
}

pub fn challan_total_weight(challan: &Value) -> f64 {
    sum_line_item_weights(challan)
}

/// Weight dispatched against an Incoming Challan by linked Outgoing Challans (mirrors `challanDispatchedWeight`).
/// When an outgoing challan records per-line `dispatchAllocations`, only the allocated weight counts;
/// otherwise the full outgoing line weight is used (legacy partial-link behaviour).
pub fn dispatched_weight(conn: &Connection, incoming_id: &str) -> f64 {
    all_challans(conn)
        .iter()
        .filter(|c| {
            c.get("documentType").and_then(|v| v.as_str()) == Some("outgoing")
                && c.get("header")
                    .and_then(|h| h.get("linkedIncomingChallanIds"))
                    .and_then(|v| v.as_array())
                    .map(|ids| ids.iter().any(|id| id.as_str() == Some(incoming_id)))
                    .unwrap_or(false)
        })
        .map(|c| {
            let allocations = c
                .get("header")
                .and_then(|h| h.get("dispatchAllocations"))
                .and_then(|v| v.as_array());
            match allocations {
                Some(list) if !list.is_empty() => list
                    .iter()
                    .filter(|a| a.get("incomingChallanId").and_then(|v| v.as_str()) == Some(incoming_id))
                    .map(|a| a.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.0))
                    .sum::<f64>(),
                _ => sum_line_item_weights(c),
            }
        })
        .sum()
}

fn sum_line_item_weights(challan: &Value) -> f64 {
    challan
        .get("lineItems")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let num = |k: &str| item.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
                    num("weight") + num("ribWeight")
                })
                .sum()
        })
        .unwrap_or(0.0)
}

fn line_num(item: &Value, key: &str) -> f64 {
    item.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

/// Total rolls on a line item (main + rib).
pub fn line_total_rolls(item: &Value) -> f64 {
    line_num(item, "roll") + line_num(item, "ribRoll")
}

/// Total weight on a line item (main + rib).
pub fn line_total_weight(item: &Value) -> f64 {
    line_num(item, "weight") + line_num(item, "ribWeight")
}

/// Per-line dispatch totals (line id, index, rolls, weight) made by all outgoing challans
/// against an incoming challan, optionally excluding one outgoing challan (the one being edited).
pub fn dispatched_by_line(conn: &Connection, incoming_id: &str, exclude_outgoing_id: Option<&str>) -> Vec<(String, usize, f64, f64)> {
    let mut out: Vec<(String, usize, f64, f64)> = Vec::new();
    for c in all_challans(conn) {
        if c.get("documentType").and_then(|v| v.as_str()) != Some("outgoing") {
            continue;
        }
        let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if exclude_outgoing_id == Some(id) {
            continue;
        }
        if let Some(allocations) = c
            .get("header")
            .and_then(|h| h.get("dispatchAllocations"))
            .and_then(|v| v.as_array())
        {
            for a in allocations {
                if a.get("incomingChallanId").and_then(|v| v.as_str()) != Some(incoming_id) {
                    continue;
                }
                let line_id = a.get("incomingLineId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let idx = a.get("incomingLineIdx").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
                let rolls = a.get("rolls").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let weight = a.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.0);
                out.push((line_id, idx, rolls, weight));
            }
        }
    }
    out
}

fn line_key(item: &Value, idx: usize) -> String {
    match item.get("id").and_then(|v| v.as_str()) {
        Some(id) if !id.is_empty() => format!("id:{id}"),
        _ => format!("idx:{idx}"),
    }
}

fn alloc_key_for(line_id: &str, idx: usize) -> String {
    if line_id.is_empty() {
        format!("idx:{idx}")
    } else {
        format!("id:{line_id}")
    }
}

/// Per-line availability of an incoming challan: totals minus other outgoings' dispatches.
pub fn incoming_line_availability(incoming: &Value, dispatched: &[(String, usize, f64, f64)]) -> Vec<Value> {
    incoming
        .get("lineItems")
        .and_then(|v| v.as_array())
        .map(|lines| {
            lines
                .iter()
                .enumerate()
                .map(|(idx, item)| {
                    let key = line_key(item, idx);
                    let (d_rolls, d_weight): (f64, f64) = dispatched
                        .iter()
                        .filter(|(line_id, i, _, _)| alloc_key_for(line_id, *i) == key)
                        .fold((0.0, 0.0), |(r, w), (_, _, a, b)| (r + a, w + b));
                    let total_rolls = line_total_rolls(item);
                    let total_weight = line_total_weight(item);
                    json!({
                        "id": item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        "idx": idx,
                        "lotNo": item.get("lotNo").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        "colour": item.get("colour").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        "depth": item.get("depth").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        "processName": item.get("processName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        "totalRolls": total_rolls,
                        "totalWeight": total_weight,
                        "dispatchRolls": round2(d_rolls),
                        "dispatchWeight": round2(d_weight),
                        "remainingRolls": round2((total_rolls - d_rolls).max(0.0)),
                        "remainingWeight": round2((total_weight - d_weight).max(0.0)),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Validate an outgoing challan's dispatch allocations: rolls must never exceed the rolls
/// remaining on the incoming line; weight must not exceed remaining weight unless overridden.
pub fn validate_allocations(conn: &Connection, record: &Value, exclude_outgoing_id: Option<&str>) -> Vec<String> {
    let Some(allocations) = record
        .get("header")
        .and_then(|h| h.get("dispatchAllocations"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    let allow_weight_override = record.get("allowWeightOverride").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut issues: Vec<String> = Vec::new();
    for a in allocations {
        let Some(incoming_id) = a.get("incomingChallanId").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(incoming) = challan_by_id(conn, incoming_id) else {
            continue;
        };
        let no = incoming
            .get("header")
            .and_then(|h| h.get("challanNo"))
            .and_then(|v| v.as_str())
            .unwrap_or(incoming_id);
        let line_id = a.get("incomingLineId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let idx = a.get("incomingLineIdx").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
        let wants_rolls = a.get("rolls").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let wants_weight = a.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.0);

        let dispatched = dispatched_by_line(conn, incoming_id, exclude_outgoing_id);
        let lines = incoming_line_availability(&incoming, &dispatched);
        let line = lines.iter().find(|l| {
            l["idx"].as_i64().unwrap_or(0) as usize == idx || (!line_id.is_empty() && l["id"].as_str() == Some(line_id.as_str()))
        });
        let Some(line) = line else {
            continue;
        };

        let rem_rolls = line["remainingRolls"].as_f64().unwrap_or(0.0);
        let rem_weight = line["remainingWeight"].as_f64().unwrap_or(0.0);
        if wants_rolls > rem_rolls + 1e-9 {
            issues.push(format!(
                "Incoming {} can spare {:.0} rolls (requested {:.0}).",
                no, rem_rolls, wants_rolls
            ));
        }
        if !allow_weight_override && wants_weight > rem_weight + 1e-9 {
            issues.push(format!(
                "Incoming {} can spare {:.0} kg (requested {:.0} kg). Tick 'Allow weight override' to proceed.",
                no, rem_weight, wants_weight
            ));
        }
    }
    issues
}

/// Distinct values helper mirroring the filter-options route.
pub fn distinct_sorted(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut set: Vec<String> = Vec::new();
    for v in values {
        if !v.trim().is_empty() && !set.contains(&v) {
            set.push(v);
        }
    }
    set.sort();
    set
}

/// Distinct values from a challan's line items for a given field.
pub fn distinct_line_item_values(challan: &Value, field: &str) -> Vec<String> {
    challan
        .get("lineItems")
        .and_then(|v| v.as_array())
        .map(|items| {
            distinct_sorted(
                items
                    .iter()
                    .filter_map(|item| {
                        item.get(field)
                            .and_then(|v| v.as_str())
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                    }),
            )
        })
        .unwrap_or_default()
}

/// Group line items across challans by HSN, mirroring `groupLineItemsByHsn` in lib/billing.ts.
pub fn group_line_items_by_hsn(challans: &[&Value]) -> (Vec<Value>, Vec<Value>) {
    let mut groups: Vec<Value> = Vec::new();
    let mut warnings: Vec<Value> = Vec::new();

    for challan in challans {
        let challan_id = challan.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if let Some(items) = challan.get("lineItems").and_then(|v| v.as_array()) {
            for item in items {
                let num = |k: &str| item.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
                let weight = num("weight") + num("ribWeight");
                let roll = num("roll") + num("ribRoll");
                let amount = weight * num("rate");
                let hsn = item.get("hsnCode").and_then(|v| v.as_str()).unwrap_or("").to_string();

                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let particulars = item.get("particulars").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let lot_no = item.get("lotNo").and_then(|v| v.as_str()).unwrap_or("").to_string();

                if hsn.trim().is_empty() {
                    warnings.push(json!({
                        "challanId": challan_id,
                        "lineItemId": item_id,
                        "particulars": if particulars.is_empty() { "—".to_string() } else { particulars.clone() },
                        "lotNo": if lot_no.is_empty() { "—".to_string() } else { lot_no.clone() },
                    }));
                    continue;
                }

                if let Some(existing) = groups.iter_mut().find(|g| g["hsnCode"] == hsn) {
                    existing["totalRoll"] = json!(existing["totalRoll"].as_f64().unwrap_or(0.0) + roll);
                    existing["totalWeight"] = json!(existing["totalWeight"].as_f64().unwrap_or(0.0) + weight);
                    existing["amount"] = json!(round2(existing["amount"].as_f64().unwrap_or(0.0) + amount));
                    if !lot_no.is_empty() {
                        let lots = existing["lotNos"].as_array_mut().unwrap();
                        if !lots.iter().any(|l| l.as_str() == Some(&lot_no)) {
                            lots.push(json!(lot_no));
                        }
                    }
                } else {
                    groups.push(json!({
                        "hsnCode": hsn,
                        "particulars": if particulars.is_empty() { "—".to_string() } else { particulars },
                        "lotNos": if lot_no.is_empty() { vec![] } else { vec![lot_no] },
                        "totalRoll": roll,
                        "totalWeight": weight,
                        "amount": round2(amount),
                    }));
                }
            }
        }
    }

    (groups, warnings)
}

/// Compute invoice line data (groups, warnings, tax lines, totals) from selected challans —
/// mirrors `computeInvoiceLineData` in lib/billing.ts.
pub fn compute_invoice_line_data(conn: &Connection, challans: &[&Value]) -> Value {
    let (groups, warnings) = group_line_items_by_hsn(challans);

    let tenant_state_code: String = conn
        .query_row("SELECT state_code FROM tenant_settings WHERE id='tenant'", [], |r| r.get(0))
        .unwrap_or_default();
    let (sac_code, gst_rate): (String, f64) = conn
        .query_row(
            "SELECT sac_code, gst_rate FROM job_work_settings WHERE id='job-work'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or_else(|_| ("9988".to_string(), 5.0));

    let recipient_state = challans
        .first()
        .and_then(|c| c.get("header"))
        .and_then(|h| h.get("billing"))
        .and_then(|b| b.get("stateCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_interstate = !recipient_state.is_empty()
        && tenant_state_code.trim() != recipient_state.trim()
        && !tenant_state_code.is_empty();

    let taxable: f64 = groups.iter().map(|g| g["amount"].as_f64().unwrap_or(0.0)).sum();
    let taxable = round2(taxable);
    let tax = round2(taxable * gst_rate / 100.0);
    let (cgst, sgst, igst) = if is_interstate {
        (0.0, 0.0, tax)
    } else {
        (round2(tax / 2.0), round2(tax / 2.0), 0.0)
    };

    let tax_lines = if groups.is_empty() {
        vec![]
    } else {
        vec![json!({
            "sacCode": sac_code,
            "gstRate": gst_rate,
            "taxableAmount": taxable,
            "isInterState": is_interstate,
            "cgst": cgst,
            "sgst": sgst,
            "igst": igst,
            "total": round2(taxable + cgst + sgst + igst),
        })]
    };

    let total_tax: f64 = tax_lines
        .iter()
        .map(|t| t["cgst"].as_f64().unwrap_or(0.0) + t["sgst"].as_f64().unwrap_or(0.0) + t["igst"].as_f64().unwrap_or(0.0))
        .sum();

    json!({
        "lineGroups": groups,
        "warnings": warnings,
        "taxLines": tax_lines,
        "totals": {
            "totalRoll": groups.iter().map(|g| g["totalRoll"].as_f64().unwrap_or(0.0)).sum::<f64>(),
            "totalWeight": groups.iter().map(|g| g["totalWeight"].as_f64().unwrap_or(0.0)).sum::<f64>(),
            "taxableAmount": taxable,
            "totalTax": round2(total_tax),
            "grandTotal": round2(taxable + total_tax),
        },
    })
}

/// Assign the next invoice number and persist the sequence (mirrors assignInvoiceNumber).
pub fn next_invoice_number(conn: &Connection, invoice_date: &str) -> rusqlite::Result<String> {
    let (prefix, series_mode, padding_digits, mut fy, mut last): (String, String, i64, String, i64) =
        conn.query_row(
            "SELECT n.prefix, n.series_mode, n.padding_digits, s.financial_year, s.last_number
             FROM invoice_numbering_settings n, invoice_sequence_state s WHERE n.id='invnum' AND s.id='seq'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
    let new_fy = crate::db::financial_year(invoice_date);
    if series_mode == "reset-yearly" && fy != new_fy {
        last = 0;
    }
    fy = new_fy;
    last += 1;
    let number = format!("{prefix}/{fy}/{:0>width$}", last, width = padding_digits as usize);
    conn.execute(
        "UPDATE invoice_sequence_state SET financial_year=?1, last_number=?2 WHERE id='seq'",
        params![fy, last],
    )?;
    Ok(number)
}

/// Load the invoice numbering settings as a camelCase record.
pub fn invoice_numbering_settings(conn: &Connection) -> Value {
    conn.query_row(
        "SELECT prefix, series_mode, padding_digits FROM invoice_numbering_settings WHERE id='invnum'",
        [],
        |r| {
            let prefix: String = r.get(0)?;
            let series_mode: String = r.get(1)?;
            let padding_digits: i64 = r.get(2)?;
            Ok(json!({ "prefix": prefix, "seriesMode": series_mode, "paddingDigits": padding_digits }))
        },
    )
    .unwrap_or(json!({ "prefix": "HP", "seriesMode": "reset-yearly", "paddingDigits": 4 }))
}

pub fn tenant_settings(conn: &Connection) -> Value {
    conn.query_row(
        "SELECT company_name, tagline, gstin, address, state, state_code, email, phone FROM tenant_settings WHERE id='tenant'",
        [],
        |r| {
            let company_name: String = r.get(0)?;
            let tagline: String = r.get(1)?;
            let gstin: String = r.get(2)?;
            let address: String = r.get(3)?;
            let state: String = r.get(4)?;
            let state_code: String = r.get(5)?;
            let email: String = r.get(6)?;
            let phone: String = r.get(7)?;
            Ok(json!({
                "companyName": company_name,
                "tagline": tagline,
                "gstin": gstin,
                "address": address,
                "state": state,
                "stateCode": state_code,
                "email": email,
                "phone": phone,
            }))
        },
    )
    .unwrap_or(Value::Null)
}

pub fn job_work_settings(conn: &Connection) -> Value {
    conn.query_row(
        "SELECT sac_code, gst_rate FROM job_work_settings WHERE id='job-work'",
        [],
        |r| {
            let sac_code: String = r.get(0)?;
            let gst_rate: f64 = r.get(1)?;
            Ok(json!({ "sacCode": sac_code, "gstRate": gst_rate }))
        },
    )
    .unwrap_or(json!({ "sacCode": "9988", "gstRate": 5 }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE challans (id TEXT PRIMARY KEY, document_type TEXT, status TEXT,
             challan_date TEXT, data_json TEXT, created_at TEXT);",
        )
        .unwrap();
        conn
    }

    fn line(id: &str, roll: f64, weight: f64) -> Value {
        json!({
            "id": id, "lotNo": format!("LOT-{id}"), "colour": "Navy", "depth": "Dark",
            "roll": roll, "weight": weight, "ribRoll": 0, "ribWeight": 0, "rate": 10.0
        })
    }

    fn base_challan(id: &str, document_type: &str, challan_no: &str) -> Value {
        let party = json!({ "name": "X", "address": "addr", "state": "Punjab", "stateCode": "03" });
        json!({
            "id": id, "status": "saved", "documentType": document_type,
            "createdAt": "2026-01-01T00:00:00Z",
            "header": {
                "challanNo": challan_no, "challanDate": "2026-01-10", "vehicleNo": "PB-1",
                "billing": party.clone(), "shipping": party,
            },
            "lineItems": [],
        })
    }

    fn incoming(id: &str, lines: Value) -> Value {
        let mut c = base_challan(id, "incoming", &format!("IN-{id}"));
        c["lineItems"] = lines;
        c
    }

    fn outgoing(id: &str, incoming_id: &str, allocations: Value) -> Value {
        let mut c = base_challan(id, "outgoing", &format!("OUT-{id}"));
        c["header"]["dispatchDate"] = json!("2026-01-12");
        c["header"]["transporter"] = json!("T");
        c["header"]["linkedIncomingChallanIds"] = json!([incoming_id]);
        c["header"]["dispatchAllocations"] = allocations;
        c
    }

    fn alloc(incoming_id: &str, line_id: &str, idx: usize, rolls: f64, weight: f64) -> Value {
        json!({
            "incomingChallanId": incoming_id, "incomingLineId": line_id,
            "incomingLineIdx": idx, "rolls": rolls, "weight": weight
        })
    }

    #[test]
    fn partial_dispatch_remaining_and_validation() {
        let conn = test_conn();
        upsert_challan(&conn, &incoming("inc1", json!([line("l1", 9.0, 900.0), line("l2", 5.0, 500.0)]))).unwrap();

        // First outgoing takes 5 of the 9 rolls on line 0.
        upsert_challan(&conn, &outgoing("out1", "inc1", json!([alloc("inc1", "l1", 0, 5.0, 500.0)]))).unwrap();

        // Availability for a second outgoing (excluding itself): 4 rolls / 400 kg remain on line 0.
        let avail = incoming_line_availability(&challan_by_id(&conn, "inc1").unwrap(), &dispatched_by_line(&conn, "inc1", Some("out2")));
        assert_eq!(avail[0]["remainingRolls"].as_f64().unwrap(), 4.0);
        assert_eq!(avail[0]["remainingWeight"].as_f64().unwrap(), 400.0);
        assert_eq!(avail[1]["remainingRolls"].as_f64().unwrap(), 5.0);

        // Second outgoing taking the remaining 4 rolls is valid.
        let out2 = outgoing("out2", "inc1", json!([alloc("inc1", "l1", 0, 4.0, 400.0)]));
        assert!(validate_allocations(&conn, &out2, None).is_empty());

        // Third outgoing over-allocates line 0 (all 9 already gone) -> rolls error.
        upsert_challan(&conn, &out2).unwrap();
        let out3 = outgoing("out3", "inc1", json!([alloc("inc1", "l1", 0, 5.0, 500.0)]));
        let issues = validate_allocations(&conn, &out3, None);
        assert!(issues.iter().any(|i| i.contains("rolls")));

        // Weight beyond remaining fails without override...
        let out4 = outgoing("out4", "inc1", json!([alloc("inc1", "l2", 1, 5.0, 999.0)]));
        assert!(validate_allocations(&conn, &out4, None).iter().any(|i| i.contains("kg")));
        // ...but passes with the explicit override.
        let mut out4o = out4;
        out4o["allowWeightOverride"] = json!(true);
        assert!(validate_allocations(&conn, &out4o, None).is_empty());

        // Editing out1: its own allocations must not count against itself (out2 holds 4 → 5 remain).
        let issues = validate_allocations(&conn, &outgoing("out1", "inc1", json!([alloc("inc1", "l1", 0, 5.0, 500.0)])), Some("out1"));
        assert!(issues.is_empty());
        // But editing out1 up to 9 rolls is impossible — out2 already owns 4 of the line.
        let over = validate_allocations(&conn, &outgoing("out1", "inc1", json!([alloc("inc1", "l1", 0, 9.0, 900.0)])), Some("out1"));
        assert!(over.iter().any(|i| i.contains("rolls")));
    }

    #[test]
    fn dispatched_weight_prefers_allocations() {
        let conn = test_conn();
        upsert_challan(&conn, &incoming("inc1", json!([line("l1", 9.0, 900.0)]))).unwrap();
        upsert_challan(&conn, &outgoing("out1", "inc1", json!([alloc("inc1", "l1", 0, 5.0, 500.0)]))).unwrap();
        // Partial dispatch: only the allocated 500 kg counts (not the full outgoing weight).
        assert_eq!(dispatched_weight(&conn, "inc1"), 500.0);
    }
}