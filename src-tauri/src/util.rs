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
    conn.execute(
        "INSERT INTO challans (id, document_type, status, challan_date, data_json, created_at)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET document_type=?2, status=?3, challan_date=?4, data_json=?5",
        params![id, document_type, status, challan_date, record.to_string(), created_at],
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
        .map(sum_line_item_weights)
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