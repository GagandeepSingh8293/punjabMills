# DyeAI — Python Backend Analysis

Source of truth analysed: the existing Tauri/Rust + React app in `DyeAI/` (Rust commands in
`src-tauri/src/commands.rs`, `lib.rs`, `sync.rs`; API client `src/lib/api.ts`; types `src/types/*`).

This document lists (A) every application flow → the REST APIs required to reproduce it, and
(B) the PostgreSQL schema mapping from the current SQLite schema.

---

## A. Flows and Required REST APIs

### 1. Authentication & Profile  (5 endpoints)
Current: `login`, `get_user`, `update_profile`, `update_avatar`, `change_password`.
Users: Haninder Singh (Admin), Arjun Patel (Supervisor), Vikram Singh (Operator), Anita Desai (Accounts).
Roles gate modules in the UI (`permissions.ts`).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Login with email/phone + password → JWT + user |
| GET | `/auth/me` | Current user from token |
| PATCH | `/users/me` | Update name/email/phone |
| PUT | `/users/me/avatar` | Update avatar url |
| PUT | `/users/me/password` | Change password (verify current) |

### 2. Masters  (3 generic endpoints)
Current: `list_masters`, `create_master`, `update_master` over kinds:
`customers, colours, depth, shades, processors, hsn-codes, rate-cards`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/masters/{kind}` | List / search masters (customers, items, colours, colour-groups, dyeing-types, processes, categories, tax-accounts, hsn-codes, depths, rate-cards) |
| POST | `/masters/{kind}` | Create master record |
| PUT | `/masters/{kind}/{id}` | Update master record |

### 3. Incoming Challan / Dyeing RECEIPT  (8 endpoints)
Current: `list_challans`, `get_challan`, `create_challan`, `update_challan`,
`get_challan_filter_options` (vehicleNo, customer, destination, weight, hsn, colour, depth, status).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/documents?type=RECEIPT&q=...&dateFrom=&dateTo=&customer=&vehicleNo=&lot=&item=&colour=&page=&pageSize=` | List/search receipts |
| GET | `/documents/{id}` | Get receipt with all items |
| POST | `/documents` | Create receipt (transactional, totals recalculated server-side) |
| PUT | `/documents/{id}` | Update receipt |
| DELETE | `/documents/{id}` | Delete receipt + cascade items |
| GET | `/documents/{id}/items` | Items only (parity with get_with_items) |
| GET | `/documents/filter-options` | Dropdown/distinct values for filters |
| GET | `/documents/{id}/photos` | Scanned photos for the document |

### 4. Outgoing Challan / Dyeing ISSUE  (10 endpoints)
Current: everything in flow 3 + `linkedIncomingChallanIds`, `get_linked_incoming_details`
(roll/weight availability per incoming line for partial dispatch), print.

| Method | Path | Purpose |
| --- | --- | --- |
| (all receipt endpoints with `type=ISSUE`) | | List/get/create/update/delete issues |
| GET | `/documents/incoming/available?customer=&q=` | Linked-incoming search for the form |
| GET | `/documents/incoming/availability?ids=...&excludeDocumentId=` | Per-line remaining rolls/weight (partial dispatch) |
| POST | `/documents/{id}/dispatch-allocations` | Save roll/weight allocations vs incoming lines |
| PATCH | `/documents/{id}/status` | draft → saved (billing gate) |

### 5. Billing  (6 endpoints)
Current: `list_invoices`, `get_invoice`, `generate_invoices`, `update_invoice_status` (draft→sent→paid),
`update_invoice_details`; print is front-end only.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/invoices?q=&status=&page=&pageSize=` | Invoice list (draft/sent/paid) |
| GET | `/invoices/{id}` | Invoice detail |
| POST | `/invoices/generate` | Generate invoices from selected ISSUE documents (one per challan, challan-no reuse) |
| PATCH | `/invoices/{id}/status` | Transition draft→sent→paid |
| PATCH | `/invoices/{id}` | Edit draft invoice details |
| POST | `/invoices/{id}/print` | (future PDF) — currently browser print |

### 6. Dashboard & Activity  (2 endpoints)
Current: `get_dashboard_stats`, `get_activity_feed`.
Stats: total challans, incoming/outgoing today (+pending review/awaiting dispatch),
pending billing, billed this month (count+value), status breakdown draft/saved/billed.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dashboard/stats` | Operational cards |
| GET | `/dashboard/activity?limit=` | Activity feed (challans + invoices) |

### 7. Global Search  (1 endpoint)
Current: `global_search` (challans + customers).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/search?q=` | Cross-challan + customer search |

### 8. Scan / OCR (desktop)  (5 endpoints)
Current: `process_scan_capture`, `get_scan_extraction`, `get_scan_photo`,
`set_gemini_api_key`, `get_gemini_config`. Extraction is always reviewed by the user before save.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/scan/process` | Run Gemini extraction on a session's photo |
| GET | `/scan/sessions/{id}/extraction` | Pending extraction for review |
| GET | `/scan/photos/{id}` | Full image (base64) |
| GET | `/scan/config` | Gemini config (configured/model) |
| PUT | `/scan/config` | Set Gemini API key |

### 9. Phone Sync (LAN HTTP server)  (6 endpoints — optional to mirror)
Current (Rust `sync.rs`): the desktop is the server; the phone is a browser hitting it.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/` | Phone capture web UI |
| POST | `/api/scan` | Upload photo + session |
| GET | `/api/scan/status?session=` | Poll processing status |
| GET | `/api/scan/result?session=` | Fetch extraction result |
| POST | `/api/challans` | Create a challan from the phone |

### 10. GST Lookup  (3 endpoints)
Current: `lookup_gst` (local customers first, then gstinapi.in with a user-provided key),
`set_gst_api_key`, `get_gst_config`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/gst/lookup/{gstin}` | Local + online lookup |
| GET | `/gst/config` | Provider config |
| PUT | `/gst/config` | Set API key |

### 11. Settings  (6 endpoints)
Current: tenant, job-work (SAC/GST rate), invoice numbering (prefix/series/padding + FY sequence).

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PUT | `/settings/tenant` | Company profile (name, tagline, gstin, address, state, state_code, email, phone) |
| GET/PUT | `/settings/job-work` | SAC + GST rate for job-work billing |
| GET/PUT | `/settings/invoice-numbering` | prefix, series_mode, padding_digits, financial-year sequence |

**Total: ≈ 51 endpoints across 11 flows.**

---

## B. PostgreSQL Schema Mapping (current SQLite → Postgres)

The current app stores challans/invoices as JSON snapshots (`data_json`). The new backend must
*normalise* them (per `TASK`: `dyeing_documents` 1:N `dyeing_document_items`), keeping the current
masters as reference/FK targets. Existing tables map as follows:

| Current SQLite table | Postgres table | Notes |
| --- | --- | --- |
| `users` | `users` | + UUID pk, unique email, hashed password |
| `customers` | `customers` | name, gstin, address, state, state_code |
| `colours`, `depth`, `shades` | `colours`, `depths`, `colour_groups`, `shades` | spec item grid uses colour_id + colour_group_id; keep depths/shades for parity |
| `processors` | `processes` | spec calls it Process; keep contact_name/phone for parity |
| `hsn_codes` | `hsn_codes` | code, description, tax_rate; HSN moves onto Item later |
| `rate_cards`, `rates` | `rate_cards` | (customer, process, depth, value) |
| — | `categories`, `items`, `dyeing_types`, `tax_accounts` | new masters required by the RECEIPT/ISSUE domain |
| `challans` (data_json) | `dyeing_documents` + `dyeing_document_items` | **the normalisation target** (this task) |
| header parties/bill-ship | `dyeing_document_parties` (future) or on header | current app has billing+shipping parties w/ GSTIN; spec header only has customer_id — keep as future add on header fields |
| `dispatchAllocations` (in outgoing data_json) | `dispatch_allocations` | (outgoing_document_id, incoming_document_id, incoming_item_id, rolls, weight) — Phase 2 parity |
| `invoices` (data_json) | `invoices` + `invoice_items` (future) | tax lines, status, challan_ids – next phase |
| `tenant_settings` | `tenant_settings` | |
| `job_work_settings` | `job_work_settings` | sac_code, gst_rate |
| `invoice_numbering_settings` + `invoice_sequence_state` | `invoice_numbering_settings` | folded into one row |
| `app_settings` | `app_settings` | key/value (gemini_api_key, gst_api_key) |
| `scan_sessions`, `scan_photos` | `scan_sessions`, `scan_photos` | photo bytes on disk, metadata in DB |
| `correction_logs` | `correction_logs` | OCR-edit audit |

### Implementation scope (this task)
Per the task brief: **masters + users + auth + `dyeing_documents`/`dyeing_document_items`** end-to-end.
Billing, scan, sync, dashboard, GST and settings routers are listed above for the full API map and are
mirrored later without schema redesign (tables already mapped).

---

## C. Key Domain Decisions / Assumptions (from the TASK)
- `document_type` CHECK (`RECEIPT`, `ISSUE`); `challan_no` unique per document type.
- Totals (`total_rolls`, `total_qty`, `gross_amount`, `net_amount`) are always recalculated
  server-side and immutable from the client.
- `amount = quantity * rate` for line items; `gross = Σ amount`; `net = gross + round_off`.
- `dyeing_document_items` deleted by `ON DELETE CASCADE` from the parent document.
- Histories: current app snapshots master names inside `data_json`; the new schema stores FKs per the
  task (snapshot strategy per-master to be added in a later phase).
- Audit columns `created_at/updated_at/created_by/updated_by` backed by `users` + JWT.