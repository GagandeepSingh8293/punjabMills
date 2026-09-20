use rusqlite::{Connection, params};
use serde_json::{json, Value};

/// Round a float to 2 decimal places, JavaScript-style (`Math.round(x*100)/100`).
pub fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// Mirror of the frontend's `getFinancialYear` (GST FY runs Apr 1 - Mar 31).
pub fn financial_year(iso_date: &str) -> String {
    let year: i32 = iso_date.split('-').next().and_then(|s| s.parse().ok()).unwrap_or(2026);
    let month: i32 = iso_date
        .split('-')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(4);
    let start_year = if month >= 4 { year } else { year - 1 };
    let end_short = format!("{:02}", (start_year + 1) % 100);
    format!("{start_year}-{end_short}")
}

/// Mirror of `assignInvoiceNumber` — sequential, gap-free per settings.
pub fn assign_invoice_number(
    invoice_date: &str,
    prefix: &str,
    series_mode: &str,
    padding_digits: i64,
    state: &mut (String, i64),
) -> String {
    let fy = financial_year(invoice_date);
    if series_mode == "reset-yearly" && state.0 != fy {
        state.1 = 0;
    }
    state.0 = fy.clone();
    state.1 += 1;
    let running = format!("{:0>width$}", state.1, width = padding_digits as usize);
    format!("{prefix}/{fy}/{running}")
}

/// Build the `data_json` for a challan from parts, mirroring types/challan.ts shapes.
pub fn build_challan_json(
    id: &str,
    status: &str,
    document_type: &str,
    created_at: &str,
    challan_no: &str,
    challan_date: &str,
    e_way_no: &str,
    vehicle_no: &str,
    dispatch_date: &str,
    transporter: &str,
    linked_incoming: &[String],
    billing: &Value,
    shipping: &Value,
    line_items: Vec<Value>,
) -> Value {
    json!({
        "id": id,
        "status": status,
        "documentType": document_type,
        "createdAt": created_at,
        "header": {
            "challanNo": if challan_no.is_empty() { Value::Null } else { Value::String(challan_no.to_string()) },
            "challanDate": challan_date,
            "eWayNo": e_way_no,
            "vehicleNo": vehicle_no,
            "dispatchDate": dispatch_date,
            "transporter": transporter,
            "linkedIncomingChallanIds": linked_incoming,
            "billing": billing.clone(),
            "shipping": shipping.clone(),
        },
        "lineItems": line_items,
    })
}

pub fn party(name: &str, address: &str, gstin: &str, state: &str, state_code: &str, mobile: &str) -> Value {
    json!({
        "name": name,
        "address": address,
        "gstin": gstin,
        "state": state,
        "stateCode": state_code,
        "mobile": mobile,
    })
}

pub fn line_item(
    id: &str,
    particulars: &str,
    hsn_code: &str,
    lot_no: &str,
    colour: &str,
    depth: &str,
    process_name: &str,
    roll: f64,
    weight: f64,
    rate: f64,
    rib_roll: f64,
    rib_weight: f64,
) -> Value {
    let opt = |v: f64| if v == 0.0 { Value::Null } else { json!(v) };
    json!({
        "id": id,
        "particulars": particulars,
        "hsnCode": hsn_code,
        "lotNo": lot_no,
        "colour": colour,
        "depth": depth,
        "processName": process_name,
        "roll": opt(roll),
        "weight": opt(weight),
        "rate": opt(rate),
        "ribRoll": opt(rib_roll),
        "ribWeight": opt(rib_weight),
    })
}

/// One PAN-India job-work customer with the full incoming -> outgoing lot, so the customer
/// record, both challans, and rate card stay derived from a single set of numbers — mirrors
/// `CustomerJobProfile` in lib/mock-data.ts.
struct CustomerJob {
    name: &'static str,
    gstin: &'static str,
    state: &'static str,
    state_code: &'static str,
    address: &'static str,
    mobile: &'static str,
    process: &'static str,
    hsn_in: &'static str,
    hsn_out: &'static str,
    particulars_in: &'static str,
    particulars_out: &'static str,
    colour_in: &'static str,
    colour_out: &'static str,
    depth: &'static str,
    lot_no: &'static str,
    roll: f64,
    weight: f64,
    rate: f64,
    incoming_date: &'static str,
    outgoing_date: &'static str,
    vehicle_in: &'static str,
    vehicle_out: &'static str,
    eway_in: &'static str,
    eway_out: &'static str,
    transporter: &'static str,
    challan_no_in: &'static str,
    challan_no_out: &'static str,
}

const CUSTOMER_JOBS: &[CustomerJob] = &[
    CustomerJob { name: "Om Textiles Pvt Ltd", gstin: "24AABCO1234M1ZQ", state: "Gujarat", state_code: "24", address: "12, Ring Road Market, Surat, Gujarat", mobile: "9825098250", process: "Dyeing", hsn_in: "5407", hsn_out: "540752", particulars_in: "Grey Fabric", particulars_out: "Dyed Fabric", colour_in: "Grey", colour_out: "Mustard", depth: "Medium", lot_no: "LOT-3001", roll: 12.0, weight: 480.0, rate: 46.0, incoming_date: "2026-08-18", outgoing_date: "2026-08-24", vehicle_in: "GJ-05-BT-4821", vehicle_out: "GJ-05-CX-7743", eway_in: "441209887224", eway_out: "441209887225", transporter: "Shree Ram Transport Co.", challan_no_in: "CH-1001", challan_no_out: "CH-2001" },
    CustomerJob { name: "Kalpana Fabrics", gstin: "27AACFK5678L1Z9", state: "Maharashtra", state_code: "27", address: "Plot 9, Textile Park, Ichalkaranji, Maharashtra", mobile: "9822033445", process: "Dyeing", hsn_in: "5208", hsn_out: "5208", particulars_in: "Grey Fabric", particulars_out: "Dyed Fabric", colour_in: "Grey", colour_out: "Maroon", depth: "Dark", lot_no: "LOT-3002", roll: 15.0, weight: 600.0, rate: 54.0, incoming_date: "2026-08-20", outgoing_date: "2026-08-27", vehicle_in: "MH-12-AB-7734", vehicle_out: "MH-12-CD-5521", eway_in: "441209887202", eway_out: "441209887203", transporter: "Jai Bhavani Roadlines", challan_no_in: "CH-1002", challan_no_out: "CH-2002" },
    CustomerJob { name: "Shree Ganesh Textiles", gstin: "08AABCS4321N1Z2", state: "Rajasthan", state_code: "08", address: "Industrial Area Phase 2, Bhilwara, Rajasthan", mobile: "9414055667", process: "Dyeing+Finishing", hsn_in: "5512", hsn_out: "5512", particulars_in: "Grey Fabric", particulars_out: "Dyed & Finished Fabric", colour_in: "Grey", colour_out: "Charcoal", depth: "Extra Dark", lot_no: "LOT-3003", roll: 10.0, weight: 400.0, rate: 68.0, incoming_date: "2026-08-21", outgoing_date: "2026-08-29", vehicle_in: "RJ-14-CD-2201", vehicle_out: "RJ-14-EF-6634", eway_in: "441209887204", eway_out: "441209887205", transporter: "Shree Ram Transport Co.", challan_no_in: "CH-1003", challan_no_out: "CH-2003" },
    CustomerJob { name: "Sri Lakshmi Textiles", gstin: "33AABCS9988L1Z4", state: "Tamil Nadu", state_code: "33", address: "45, Kumaran Road, Tiruppur, Tamil Nadu", mobile: "9843012345", process: "Bleaching", hsn_in: "6006", hsn_out: "6006", particulars_in: "Grey Fabric", particulars_out: "Bleached Fabric", colour_in: "Grey", colour_out: "White", depth: "", lot_no: "LOT-3004", roll: 20.0, weight: 700.0, rate: 34.0, incoming_date: "2026-08-22", outgoing_date: "2026-08-28", vehicle_in: "TN-37-GH-1123", vehicle_out: "TN-37-JK-9087", eway_in: "441209887206", eway_out: "441209887207", transporter: "Ganga Transport Corporation", challan_no_in: "CH-1004", challan_no_out: "CH-2004" },
    CustomerJob { name: "Vardhman Weaves", gstin: "03AAACV5566P1Z8", state: "Punjab", state_code: "03", address: "B-12, Industrial Area A, Ludhiana, Punjab", mobile: "9814023456", process: "Dyeing", hsn_in: "5111", hsn_out: "5111", particulars_in: "Grey Fabric", particulars_out: "Dyed Fabric", colour_in: "Grey", colour_out: "Firozi", depth: "Medium", lot_no: "LOT-3005", roll: 8.0, weight: 320.0, rate: 48.0, incoming_date: "2026-08-24", outgoing_date: "2026-08-30", vehicle_in: "PB-10-LM-3345", vehicle_out: "PB-10-NP-4456", eway_in: "", eway_out: "", transporter: "Ludhiana Roadways", challan_no_in: "CH-1005", challan_no_out: "CH-2005" },
    CustomerJob { name: "Bengal Silk Mills", gstin: "19AABCB7788S1Z0", state: "West Bengal", state_code: "19", address: "18, Foreshore Road, Howrah, West Bengal", mobile: "9830034567", process: "Dyeing", hsn_in: "5007", hsn_out: "5007", particulars_in: "Grey Fabric", particulars_out: "Dyed Fabric", colour_in: "Grey", colour_out: "Wine", depth: "Dark", lot_no: "LOT-3006", roll: 6.0, weight: 150.0, rate: 58.0, incoming_date: "2026-08-25", outgoing_date: "2026-09-01", vehicle_in: "WB-06-QR-7789", vehicle_out: "WB-06-ST-8890", eway_in: "441209887210", eway_out: "441209887211", transporter: "Ganga Transport Corporation", challan_no_in: "CH-1006", challan_no_out: "CH-2006" },
    CustomerJob { name: "Malwa Textile Processors", gstin: "23AAACM3344T1Z6", state: "Madhya Pradesh", state_code: "23", address: "22, Sanwer Road Industrial Area, Indore, Madhya Pradesh", mobile: "9826045678", process: "Bleaching", hsn_in: "5209", hsn_out: "5209", particulars_in: "Grey Fabric", particulars_out: "Bleached Fabric", colour_in: "Grey", colour_out: "White", depth: "", lot_no: "LOT-3007", roll: 18.0, weight: 720.0, rate: 33.0, incoming_date: "2026-08-27", outgoing_date: "2026-09-02", vehicle_in: "MP-09-UV-2234", vehicle_out: "MP-09-WX-3345", eway_in: "441209887212", eway_out: "441209887213", transporter: "Ganga Transport Corporation", challan_no_in: "CH-1007", challan_no_out: "CH-2007" },
    CustomerJob { name: "Bangalore Knit Fab", gstin: "29AABCB2211K1Z3", state: "Karnataka", state_code: "29", address: "Plot 5, Peenya Industrial Estate, Bengaluru, Karnataka", mobile: "9845056789", process: "Dyeing", hsn_in: "6006", hsn_out: "6006", particulars_in: "Grey Fabric", particulars_out: "Dyed Fabric", colour_in: "Grey", colour_out: "Sky Blue", depth: "Light", lot_no: "LOT-3008", roll: 14.0, weight: 490.0, rate: 42.0, incoming_date: "2026-08-28", outgoing_date: "2026-09-03", vehicle_in: "KA-05-YZ-1122", vehicle_out: "KA-05-AB-2233", eway_in: "441209887214", eway_out: "441209887215", transporter: "Ganga Transport Corporation", challan_no_in: "CH-1008", challan_no_out: "CH-2008" },
    CustomerJob { name: "Ganges Garments", gstin: "09AABCG6655G1Z7", state: "Uttar Pradesh", state_code: "09", address: "14, Panki Industrial Area, Kanpur, Uttar Pradesh", mobile: "9838067890", process: "Dyeing", hsn_in: "610910", hsn_out: "610910", particulars_in: "Grey T-Shirts", particulars_out: "Dyed T-Shirts", colour_in: "Grey", colour_out: "Rani Pink", depth: "Medium", lot_no: "LOT-3009", roll: 25.0, weight: 625.0, rate: 47.0, incoming_date: "2026-08-30", outgoing_date: "2026-09-05", vehicle_in: "UP-78-CD-4567", vehicle_out: "UP-78-EF-5678", eway_in: "441209887216", eway_out: "441209887217", transporter: "Ganga Transport Corporation", challan_no_in: "CH-1009", challan_no_out: "CH-2009" },
    CustomerJob { name: "Capital Fabtex", gstin: "07AABCC4433D1Z2", state: "Delhi", state_code: "07", address: "Shed 7, Narela Industrial Area, Delhi", mobile: "9811078901", process: "Dyeing", hsn_in: "5806", hsn_out: "5806", particulars_in: "Grey Narrow Fabric", particulars_out: "Dyed Narrow Fabric", colour_in: "Grey", colour_out: "Black", depth: "Dark", lot_no: "LOT-3010", roll: 30.0, weight: 300.0, rate: 52.0, incoming_date: "2026-09-01", outgoing_date: "2026-09-07", vehicle_in: "DL-01-GH-6789", vehicle_out: "DL-01-JK-7890", eway_in: "441209887218", eway_out: "441209887219", transporter: "Ganga Transport Corporation", challan_no_in: "CH-1010", challan_no_out: "CH-2010" },
    CustomerJob { name: "Deccan Dyeing Mills", gstin: "36AABCD8899D1Z5", state: "Telangana", state_code: "36", address: "Plot 30, Powerloom Estate, Sircilla, Telangana", mobile: "9848089012", process: "Printing", hsn_in: "5407", hsn_out: "540752", particulars_in: "Grey Fabric", particulars_out: "Printed Fabric", colour_in: "Grey", colour_out: "Chocolate Brown", depth: "Extra Dark", lot_no: "LOT-3011", roll: 16.0, weight: 640.0, rate: 72.0, incoming_date: "2026-09-03", outgoing_date: "2026-09-09", vehicle_in: "TS-08-LM-8901", vehicle_out: "TS-08-NP-9012", eway_in: "441209887220", eway_out: "441209887221", transporter: "Jai Bhavani Roadlines", challan_no_in: "CH-1011", challan_no_out: "CH-2011" },
    CustomerJob { name: "Panipat Home Textiles", gstin: "06AABCP1122P1Z9", state: "Haryana", state_code: "06", address: "Sector 29, HUDA Industrial Area, Panipat, Haryana", mobile: "9812090123", process: "Dyeing+Finishing", hsn_in: "580190", hsn_out: "580190", particulars_in: "Grey Fabric", particulars_out: "Dyed & Finished Fabric", colour_in: "Grey", colour_out: "Beige", depth: "Light", lot_no: "LOT-3012", roll: 9.0, weight: 360.0, rate: 62.0, incoming_date: "2026-09-05", outgoing_date: "2026-09-11", vehicle_in: "HR-26-QR-0123", vehicle_out: "HR-26-ST-1234", eway_in: "441209887222", eway_out: "441209887223", transporter: "Ludhiana Roadways", challan_no_in: "CH-1012", challan_no_out: "CH-2012" },
];

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    create_schema(conn)?;
    seed(conn)?;
    migrate_additional_seed(conn)
}

/// Idempotent follow-up seed for databases created before these entries existed, so the
/// already-seeded dev DB picks up the new depth options and the combined Colour & Depth master.
fn migrate_additional_seed(conn: &Connection) -> rusqlite::Result<()> {
    let depth_count: i64 = conn.query_row("SELECT COUNT(*) FROM depths WHERE name=?1", ["Super Dark"], |r| r.get(0)).unwrap_or(0);
    if depth_count == 0 {
        conn.execute("INSERT INTO depths (id, name, created_at) VALUES (?1,'Super Dark',?2)", params![nanoid::nanoid!(10), now_iso()])?;
    }
    let none_count: i64 = conn.query_row("SELECT COUNT(*) FROM depths WHERE name=?1", ["-"], |r| r.get(0)).unwrap_or(0);
    if none_count == 0 {
        conn.execute("INSERT INTO depths (id, name, created_at) VALUES (?1,'-',?2)", params![nanoid::nanoid!(10), now_iso()])?;
    }

    let shade_count: i64 = conn.query_row("SELECT COUNT(*) FROM shades", [], |r| r.get(0)).unwrap_or(0);
    if shade_count == 0 {
        let now = now_iso();
        for (name, depth, hex) in [
            ("Black", "Super Dark", "#000000"),
            ("Black", "Dark", "#1F1F1F"),
            ("Charcoal", "Extra Dark", "#36454F"),
            ("Grey Melange", "Dark", "#5A5A5C"),
            ("White", "-", "#FFFFFF"),
            ("Off White", "-", "#F6F1E7"),
            ("Maroon", "Dark", "#800000"),
            ("Wine", "Dark", "#722F37"),
            ("Mustard", "Medium", "#E1AD01"),
            ("Rama Green", "Medium", "#17A452"),
            ("Bottle Green", "Dark", "#006A4E"),
            ("Royal Blue", "Medium", "#4169E1"),
            ("Navy Blue", "Dark", "#1E3A8A"),
            ("Sky Blue", "Light", "#87CEEB"),
            ("Firozi", "Light", "#40E0D0"),
            ("Rani Pink", "Dark", "#D6006D"),
            ("Beige", "Light", "#F5F5DC"),
            ("Peach", "Light", "#FFCBA4"),
            ("Coral", "Medium", "#FF7F50"),
            ("Lemon Yellow", "Light", "#FFF44F"),
            ("Chocolate Brown", "Extra Dark", "#7B3F00"),
        ] {
            conn.execute(
                "INSERT INTO shades (id, name, depth, hex, created_at) VALUES (?1,?2,?3,?4,?5)",
                params![nanoid::nanoid!(10), name, depth, hex, now],
            )?;
        }
    }
    Ok(())
}

fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            avatar_url TEXT,
            password TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tenant_settings (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            tagline TEXT NOT NULL,
            gstin TEXT NOT NULL,
            address TEXT NOT NULL,
            state TEXT NOT NULL,
            state_code TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS job_work_settings (
            id TEXT PRIMARY KEY,
            sac_code TEXT NOT NULL,
            gst_rate REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoice_numbering_settings (
            id TEXT PRIMARY KEY,
            prefix TEXT NOT NULL,
            series_mode TEXT NOT NULL,
            padding_digits INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoice_sequence_state (
            id TEXT PRIMARY KEY,
            financial_year TEXT NOT NULL,
            last_number INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hsn_codes (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            description TEXT NOT NULL,
            tax_rate REAL NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            gstin TEXT NOT NULL,
            address TEXT NOT NULL,
            state TEXT NOT NULL,
            state_code TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS colours (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            hex TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS processors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            contact_name TEXT,
            phone TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rates (
            id TEXT PRIMARY KEY,
            value REAL NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rate_cards (
            id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            process TEXT NOT NULL,
            depth TEXT NOT NULL,
            fabric_quality TEXT NOT NULL,
            value REAL NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS depths (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shades (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            depth TEXT NOT NULL,
            hex TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS challans (
            id TEXT PRIMARY KEY,
            document_type TEXT NOT NULL,
            status TEXT NOT NULL,
            challan_date TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            invoice_date TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS correction_logs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            challan_id TEXT NOT NULL,
            path TEXT NOT NULL,
            ai_value_json TEXT NOT NULL,
            saved_value_json TEXT NOT NULL,
            confidence REAL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_sessions (
            session_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            extracted_json TEXT
        );

        CREATE TABLE IF NOT EXISTS scan_photos (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            challan_id TEXT,
            filename TEXT NOT NULL,
            mime TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_challans_type ON challans(document_type);
        CREATE INDEX IF NOT EXISTS idx_challans_status ON challans(status);
        CREATE INDEX IF NOT EXISTS idx_invoices_satus ON invoices(status);
        CREATE INDEX IF NOT EXISTS idx_scan_photos_session ON scan_photos(session_id);
        CREATE INDEX IF NOT EXISTS idx_scan_photos_challan ON scan_photos(challan_id);
        "#,
    )
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn seed(conn: &Connection) -> rusqlite::Result<()> {
    let user_count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    if user_count > 0 {
        return Ok(());
    }

    let now = now_iso();

    // ── users ────────────────────────────────────────────────
    let users: [(&str, &str, &str, &str, &str); 4] = [
        ("u-1", "Haninder Singh", "Admin", "haninder.singh@punjabdyeingmills.in", "+91 98250 54321"),
        ("u-2", "Arjun Patel", "Supervisor", "arjun.patel@punjabdyeingmills.in", "+91 98250 11223"),
        ("u-3", "Vikram Singh", "Operator", "vikram.singh@punjabdyeingmills.in", "+91 98250 33445"),
        ("u-4", "Anita Desai", "Accounts", "anita.desai@punjabdyeingmills.in", "+91 98250 55667"),
    ];
    for (id, name, role, email, phone) in users {
        conn.execute(
            "INSERT INTO users (id, name, role, email, phone, avatar_url, password, created_at) VALUES (?1,?2,?3,?4,?5,NULL,'Password123!',?6)",
            params![id, name, role, email, phone, now],
        )?;
    }

    // ── tenant settings ─────────────────────────────────────
    conn.execute(
        "INSERT INTO tenant_settings (id, company_name, tagline, gstin, address, state, state_code, email, phone) VALUES ('tenant','Punjab Dyeing Mills [Demo]','Dyeing, Printing & Textile Processing','03AAAAA0000A1Z5','Plot No. 7, Focal Point Phase VIII-B, Mohali, Punjab 160059','Punjab','03','accounts@punjabdyeingmills.in','+91 98140 22334')",
        [],
    )?;

    // ── job-work + invoice numbering settings ────────────────
    conn.execute(
        "INSERT INTO job_work_settings (id, sac_code, gst_rate) VALUES ('job-work','9988',5)",
        [],
    )?;
    conn.execute(
        "INSERT INTO invoice_numbering_settings (id, prefix, series_mode, padding_digits) VALUES ('invnum','HP','reset-yearly',4)",
        [],
    )?;
    conn.execute(
        "INSERT INTO invoice_sequence_state (id, financial_year, last_number) VALUES ('seq','',0)",
        [],
    )?;

    // ── HSN master list ──────────────────────────────────────
    let hsns: [(&str, &str, f64); 11] = [
        ("5007", "Woven fabrics of silk or of silk waste", 5.0),
        ("5111", "Woven fabrics of carded wool or of carded fine animal hair", 5.0),
        ("5208", "Woven fabrics of cotton, ≥85% cotton by weight, ≤200 g/m²", 5.0),
        ("5209", "Woven fabrics of cotton, ≥85% cotton by weight, >200 g/m²", 5.0),
        ("5407", "Woven fabrics of synthetic filament yarn (grey/unprocessed)", 5.0),
        ("540752", "Other woven fabrics, dyed, ≥85% textured polyester filaments", 5.0),
        ("5512", "Woven fabrics of synthetic staple fibres, ≥85% by weight", 5.0),
        ("5806", "Narrow woven fabrics, other than goods of heading 5807", 5.0),
        ("580190", "Woven pile fabrics and chenille fabrics, other than of cotton or man-made fibres", 5.0),
        ("6006", "Other knitted or crocheted fabrics", 12.0),
        ("610910", "T-shirts, singlets and other vests, of cotton, knitted or crocheted", 12.0),
    ];
    for (code, desc, tax) in hsns {
        conn.execute(
            "INSERT INTO hsn_codes (id, code, description, tax_rate, created_at) VALUES (?1,?2,?3,?4,?5)",
            params![nanoid::nanoid!(10), code, desc, tax, now],
        )?;
    }

    // ── customers from the job profiles ──────────────────────
    for job in CUSTOMER_JOBS {
        conn.execute(
            "INSERT INTO customers (id, name, gstin, address, state, state_code, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![nanoid::nanoid!(10), job.name, job.gstin, job.address, job.state, job.state_code, now],
        )?;
    }

    // ── colours ──────────────────────────────────────────────
    let colours: [(&str, &str); 20] = [
        ("Navy Blue", "#1E3A8A"),
        ("Maroon", "#800000"),
        ("Rama Green", "#17A452"),
        ("Mustard", "#E1AD01"),
        ("White", "#FFFFFF"),
        ("Charcoal", "#36454F"),
        ("Firozi", "#40E0D0"),
        ("Rani Pink", "#D6006D"),
        ("Bottle Green", "#006A4E"),
        ("Beige", "#F5F5DC"),
        ("Black", "#000000"),
        ("Royal Blue", "#4169E1"),
        ("Wine", "#722F37"),
        ("Mehendi Green", "#6B8E23"),
        ("Peach", "#FFCBA4"),
        ("Coral", "#FF7F50"),
        ("Lemon Yellow", "#FFF44F"),
        ("Grey Melange", "#B0B0B0"),
        ("Sky Blue", "#87CEEB"),
        ("Chocolate Brown", "#7B3F00"),
    ];
    for (name, hex) in colours {
        conn.execute(
            "INSERT INTO colours (id, name, hex, created_at) VALUES (?1,?2,?3,?4)",
            params![nanoid::nanoid!(10), name, hex, now],
        )?;
    }

    // ── processors ───────────────────────────────────────────
    let processors: [(&str, &str, &str); 8] = [
        ("Shree Ram Transport Co.", "Ramesh Bhai Patel", "+91 98250 11122"),
        ("Jai Bhavani Roadlines", "Sanjay Deshmukh", "+91 98230 44556"),
        ("Ludhiana Roadways", "Gurpreet Singh", "+91 98140 55667"),
        ("Ganga Transport Corporation", "Rajeev Awasthi", "+91 94150 66778"),
        ("Sagar Dyeing Works", "Sagar Patel", "+91 98250 33221"),
        ("Rajdhani Textile Processors", "Mahendra Rathore", "+91 94140 77889"),
        ("Tiruppur Knit Processors", "Karthik Raja", "+91 90420 88990"),
        ("Siddhi Vinayak Calendering Works", "Vinod Bansal", "+91 98120 99001"),
    ];
    for (name, contact, phone) in processors {
        conn.execute(
            "INSERT INTO processors (id, name, contact_name, phone, created_at) VALUES (?1,?2,?3,?4,?5)",
            params![nanoid::nanoid!(10), name, contact, phone, now],
        )?;
    }

    // ── flat rates ───────────────────────────────────────────
    for value in [33.0, 42.0, 48.0, 58.0, 62.0, 72.0] {
        conn.execute(
            "INSERT INTO rates (id, value, created_at) VALUES (?1,?2,?3)",
            params![nanoid::nanoid!(10), value, now],
        )?;
    }

    // ── depths ───────────────────────────────────────────────
    for name in ["Light", "Medium", "Dark", "Extra Dark"] {
        conn.execute(
            "INSERT INTO depths (id, name, created_at) VALUES (?1,?2,?3)",
            params![nanoid::nanoid!(10), name, now],
        )?;
    }

    // ── rate cards (one per dyed job) ────────────────────────
    for job in CUSTOMER_JOBS {
        if !job.depth.is_empty() {
            conn.execute(
                "INSERT INTO rate_cards (id, customer_name, process, depth, fabric_quality, value, created_at) VALUES (?1,?2,?3,?4,'',?5,?6)",
                params![nanoid::nanoid!(10), job.name, job.process, job.depth, job.rate, now],
            )?;
        }
    }

    // ── challans: incoming + outgoing for every job ──────────
    let mut incoming_ids: Vec<String> = Vec::new();
    for job in CUSTOMER_JOBS {
        let id = nanoid::nanoid!(10);
        incoming_ids.push(id.clone());
        let data = build_challan_json(
            &id,
            "saved",
            "incoming",
            &now,
            job.challan_no_in,
            job.incoming_date,
            job.eway_in,
            job.vehicle_in,
            "",
            "",
            &[],
            &party(job.name, job.address, job.gstin, job.state, job.state_code, ""),
            &party(job.name, job.address, job.gstin, job.state, job.state_code, job.mobile),
            vec![line_item(
                &nanoid::nanoid!(8),
                job.particulars_in,
                job.hsn_in,
                job.lot_no,
                job.colour_in,
                "",
                job.process,
                job.roll,
                job.weight,
                job.rate,
                0.0,
                0.0,
            )],
        );
        conn.execute(
            "INSERT INTO challans (id, document_type, status, challan_date, data_json, created_at) VALUES (?1,'incoming','saved',?2,?3,?4)",
            params![id, job.incoming_date, data.to_string(), now],
        )?;
    }

    for (i, job) in CUSTOMER_JOBS.iter().enumerate() {
        let id = nanoid::nanoid!(10);
        let linked = vec![incoming_ids[i].clone()];
        let data = build_challan_json(
            &id,
            "saved",
            "outgoing",
            &now,
            job.challan_no_out,
            job.outgoing_date,
            job.eway_out,
            job.vehicle_out,
            job.outgoing_date,
            job.transporter,
            &linked,
            &party(job.name, job.address, job.gstin, job.state, job.state_code, ""),
            &party(job.name, job.address, job.gstin, job.state, job.state_code, job.mobile),
            vec![line_item(
                &nanoid::nanoid!(8),
                job.particulars_out,
                job.hsn_out,
                job.lot_no,
                job.colour_out,
                job.depth,
                job.process,
                job.roll,
                job.weight,
                job.rate,
                0.0,
                0.0,
            )],
        );
        conn.execute(
            "INSERT INTO challans (id, document_type, status, challan_date, data_json, created_at) VALUES (?1,'outgoing','saved',?2,?3,?4)",
            params![id, job.outgoing_date, data.to_string(), now],
        )?;
    }

    // ── seed invoices from the first five dispatched lots ────
    // Mirrors the five buildSeedInvoice calls in lib/mock-data.ts. Outgoing challans are
    // ordered by challan date (same five lots the original picks: Om, Kalpana, Sri Lakshmi,
    // Shree Ganesh, Vardhman) and each invoice is issued with its own date and status.
    let invoice_specs: [(&str, &str); 5] = [
        ("2026-08-26", "paid"), // Om Textiles (interstate → IGST)
        ("2026-08-29", "paid"), // Kalpana Fabrics
        ("2026-08-30", "sent"), // Sri Lakshmi Textiles
        ("2026-08-31", "sent"), // Shree Ganesh Textiles
        ("2026-09-01", "draft"), // Vardhman Weaves (intra-state → CGST+SGST)
    ];
    seed_first_invoices(conn, &invoice_specs)?;
    drop(incoming_ids);
    Ok(())
}

fn seed_first_invoices(conn: &Connection, specs: &[(&str, &str)]) -> rusqlite::Result<()> {
    let mut stmt = conn
        .prepare("SELECT id, data_json FROM challans WHERE document_type='outgoing' ORDER BY challan_date")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let tenant_state_code: String = conn.query_row(
        "SELECT state_code FROM tenant_settings WHERE id='tenant'",
        [],
        |r| r.get(0),
    )?;
    let (sac_code, gst_rate): (String, f64) = conn.query_row(
        "SELECT sac_code, gst_rate FROM job_work_settings WHERE id='job-work'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (prefix, series_mode, padding_digits): (String, String, i64) = conn.query_row(
        "SELECT prefix, series_mode, padding_digits FROM invoice_numbering_settings WHERE id='invnum'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let mut seq_state: (String, i64) = conn.query_row(
        "SELECT financial_year, last_number FROM invoice_sequence_state WHERE id='seq'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let mut challans: Vec<Value> = Vec::new();
    for (id, data) in rows.into_iter().take(specs.len()) {
        let mut v: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
        if let Value::Object(map) = &mut v {
            map.insert("__id__".to_string(), json!(id));
        }
        challans.push(v);
    }

    // Build one invoice per challan, sharing the sequence.
    for (ch, (invoice_date, status)) in challans.into_iter().zip(specs.iter()) {
        let id = ch.get("__id__").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let header = ch.get("header").cloned().unwrap_or_else(|| json!({}));
        let billing = header.get("billing").cloned().unwrap_or_else(|| json!({}));
        let line_items = ch.get("lineItems").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        let mut groups: Vec<Value> = Vec::new();
        for item in &line_items {
            let hsn = item.get("hsnCode").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let particulars = item.get("particulars").and_then(|v| v.as_str()).unwrap_or("—").to_string();
            let lot_no = item.get("lotNo").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let num = |k: &str| item.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let roll = num("roll") + num("ribRoll");
            let weight = num("weight") + num("ribWeight");
            let amount = round2(weight * num("rate"));
            groups.push(json!({
                "hsnCode": hsn,
                "particulars": particulars,
                "lotNos": if lot_no.is_empty() { vec![] } else { vec![lot_no] },
                "totalRoll": roll,
                "totalWeight": weight,
                "amount": amount,
            }));
        }

        let recipient_state = billing.get("stateCode").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let is_interstate = !recipient_state.is_empty() && tenant_state_code.trim() != recipient_state.trim();
        let taxable: f64 = groups.iter().map(|g| g["amount"].as_f64().unwrap_or(0.0)).sum();
        let taxable = round2(taxable);
        let tax = round2(taxable * gst_rate / 100.0);
        let (cgst, sgst, igst) = if is_interstate {
            (0.0, 0.0, tax)
        } else {
            (round2(tax / 2.0), round2(tax / 2.0), 0.0)
        };
        let tax_lines = vec![json!({
            "sacCode": sac_code,
            "gstRate": gst_rate,
            "taxableAmount": taxable,
            "isInterState": is_interstate,
            "cgst": cgst,
            "sgst": sgst,
            "igst": igst,
            "total": round2(taxable + cgst + sgst + igst),
        })];
        let total_tax = tax_lines.iter().map(|t| t["cgst"].as_f64().unwrap_or(0.0) + t["sgst"].as_f64().unwrap_or(0.0) + t["igst"].as_f64().unwrap_or(0.0)).sum::<f64>();
        let grand_total = round2(taxable + total_tax);

        let invoice_no = assign_invoice_number(invoice_date, &prefix, &series_mode, padding_digits, &mut seq_state);
        let invoice_id = nanoid::nanoid!(10);
        let invoice = json!({
            "id": invoice_id,
            "invoiceNo": invoice_no,
            "invoiceDate": invoice_date,
            "status": status,
            "challanIds": [id],
            "header": { "billing": billing },
            "lineGroups": groups,
            "warnings": [],
            "taxLines": tax_lines,
            "totals": {
                "totalRoll": groups.iter().map(|g| g["totalRoll"].as_f64().unwrap_or(0.0)).sum::<f64>(),
                "totalWeight": groups.iter().map(|g| g["totalWeight"].as_f64().unwrap_or(0.0)).sum::<f64>(),
                "taxableAmount": taxable,
                "totalTax": round2(total_tax),
                "grandTotal": grand_total,
            },
            "createdAt": now_iso(),
        });

        conn.execute(
            "INSERT INTO invoices (id, status, invoice_date, data_json, created_at) VALUES (?1,?2,?3,?4,?5)",
            params![invoice_id, status, invoice_date, invoice.to_string(), now_iso()],
        )?;
        conn.execute(
            "UPDATE invoice_sequence_state SET financial_year=?1, last_number=?2 WHERE id='seq'",
            params![seq_state.0, seq_state.1],
        )?;
    }
    Ok(())
}