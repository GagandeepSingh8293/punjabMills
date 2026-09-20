# DyeAI Codebase Audit

Date: 2026-09-20
Audit type: Phase 0 — understand before changing (per `FeedbackItems.md`, Section 43).
Scope: whole repository. **No production code was modified to produce this audit.**

---

## 1. Technology Stack

| Layer | Technology |
| --- | --- |
| Shell / runtime | Tauri v2 desktop app (Rust backend, webview shell) |
| Frontend | React 19, Vite 6, TypeScript 5.7 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`, `@custom-variant dark`), shadcn-style Radix primitives, `tw-animate-css` |
| State | Zustand 5 (UI + domain stores) |
| Routing | React Router 7 |
| Forms / validation | Plain controlled forms + `zod` schemas |
| Data access (backend) | `rusqlite` — raw SQL, no ORM |
| Backend API | Tauri commands (invoke bridge) + a small LAN HTTP server for phone sync |
| Misc libs | fuse.js (global search), cmdk (command dialog), recharts (dashboard), qrcode.react, nanoid, date/number/INR utilities |
| Testing | **None present** (no unit/integration test framework) |

## 2. Project Structure

```
DyeAI/
├── src/                       # React + TypeScript frontend
│   ├── components/{layout,scan,ui}
│   ├── lib/                   # api.ts, billing.ts, tax.ts, challan-helpers, copilot, etc.
│   ├── pages/                 # one file per route
│   ├── stores/                # Zustand stores
│   ├── types/                 # zod schemas + TS types
│   ├── styles/globals.css
│   ├── App.tsx, main.tsx
│   └── FeedbackItems.md       # ← spec lives at src/FeedbackItems.md (should move to docs/)
├── src-tauri/
│   └── src/{main,lib,commands,db,sync,ocr,util}.rs
├── .github/workflows/release.yml   # Windows NSIS installer build
├── package.json / tsconfig.json / vite.config.ts
```

## 3. Frontend Architecture

- **Routing** (`App.tsx`): `/login`, `/dashboard`, `/challans`, `/challans/outgoing`, `/challans/:id` (edit, typeable via `?type=`), `/challans/:id/print`, `/billing`, `/billing/:id`, `/billing/:id/edit`, `/billing/:id/print`, `/billing/generate`, `/masters`, `/scan`, `/sync`, `/profile`, `/copilot`.
- **Layout**: `AppShell` = `Sidebar` + `Header` + `<Outlet/>`; global `CommandDialog` (⌘K global search); `CopilotPanel` opened via a bottom-right floating FAB; global toast (top-right auto-dismiss).
- **State**: `stores/` — `user`, `billing`, `challan`, `masters`, `search`, `sidebar`, `ui-state` (customers, rate cards, colours, depths, shades, processors, HSNs, pending incoming), `theme`, `copilot`.
- **Auth guard**: unauthenticated users are redirected to `/login`; route permissions via `lib/permissions.ts` (`canAccessModule`).
- **Theme**: `stores/theme.ts` applies `.dark` on `<html>` (light/dark/system), persisted to `localStorage`, `color-scheme` set in `globals.css`.

## 4. Backend Architecture

- Single Rust crate `src-tauri`. State = `DbState(Mutex<sqlite::Connection>)`.
- **API surface** = 30+ Tauri commands registered in `lib.rs` (`commands.rs`), e.g. `login`, `list_masters`, `create_master`, `lookup_gst`, `list_challans`, `get_challan`, `create_challan`, `update_challan`, `get_challan_filter_options`, `generate_invoices`, `update_invoice_status`, `update_invoice_details`, `get_dashboard_stats`, `get_activity_feed`, `global_search`, `process_scan_capture`, `get_scan_extraction`, `get_scan_photo`, `set_gemini_api_key`, `get_gemini_config`, `set_gst_api_key`, `get_gst_config`, `get_sync_status`, settings commands.
- **LAN server** (`sync.rs`): tiny HTTP server on UDP-discovered LAN IP, **port 3784**. Routes: `GET /health`, `GET /` (phone web UI), `POST /api/scan` (photo+challan upload), `GET /api/scan/status`, `GET /api/scan/result`, `POST /api/challans` (create challan from phone). Emits `challan:synced` / `sync:status` Tauri events.
- **OCR** (`ocr.rs`): Gemini vision (`gemini-2.5-flash`) extraction pipeline; key stored in `app_settings`; photos saved under `app_data_dir/scan-photos`; rows recorded in `scan_sessions` + `scan_photos`; OCR-driven edits logged to `correction_logs`.

## 5. Database Architecture (SQLite)

File: `~/Library/Application Support/in.raavisynapse.dyeai/dyeai.db`

| Table | Purpose | Key columns (data_json pattern) |
| --- | --- | --- |
| `users` | Login/roles | name, role, email, phone, avatar_url, password |
| `customers` | Party master | name, gstin, address, state, state_code |
| `challans` | Incoming/Outgoing docs | document_type, status, challan_date, **data_json** (full snapshot) |
| `invoices` | Bills | status, invoice_date, **data_json** |
| `colours` | Colour master | name, hex |
| `depth` | Depth master | name (Dark, Medium, Light, -, Super Dark, Extra Dark) |
| `shades` | Combined Colour·Depth | name, depth, hex |
| `processors` | Process master (no UI tab; feeds datalist) | name, contact_name, phone |
| `hsn_codes` | HSN master | code, description, tax_rate |
| `rate_cards` / `rates` | Rate suggestion lookup | value, process, depth, etc. |
| `tenant_settings` | Company profile | gstin, address, state, state_code, phone |
| `job_work_settings` | Billing GST config | sac_code, gst_rate |
| `invoice_numbering_settings` + `invoice_sequence_state` | Number series | prefix, series_mode, padding_digits / financial_year, last_number |
| `app_settings` | Key/value (Gemini key, GST API key) | key, value |
| `scan_sessions` / `scan_photos` | OCR pipeline | extracted_json / photo blobs |
| `correction_logs` | Audit of OCR field edits | ai_value_json, saved_value_json, confidence |

Design notes:
- **Snapshot pattern**: challans/invoices store the full document (header + parties + line items) as JSON. Parties, rates and GST details are frozen per-document, which neatly satisfies the "preserve historical snapshot" requirement (§33).
- No migrations framework — schema is created/upgraded idempotently on app boot in `db.rs` (plus a seed migration for depths/shades).
- Foreign keys are implied (ids inside JSON), not enforced.

## 6. Existing Incoming Challan

- **Model**: `challans` row with `document_type='incoming'`; header = challanNo (auto on save), challanDate, vehicleNo, eWayNo, billing/shipping parties; line items = lotNo, particulars, colour, depth, processName, HSN, rolls, weight, rate, ribRolls, ribWeight.
- **Flow**: list (`pendingIncoming`), create/edit form (`ChallanFormPage`, `?type=incoming`), status draft/saved, print (`ChallanPrintPage`), scan-from-phone (`ScanFlowDialog`).
- **Scan integration**: incoming forms show "Scan from phone", prefilled scan values are editable, corrections logged in `correction_logs`.
- Incoming detail already used as a source for outgoing: `linkedIncomingChallanIds` + cross-document details surfaced on outgoing.

## 7. Existing Outgoing Challan

- Same form, `document_type='outgoing'`; adds dispatchDate, transporter, auto-weight (~20 kg/roll toggle), rate auto-suggestion from rate cards, and a top-of-form "Link Incoming Challan" search that prefills parties and records the source link.
- List shows Process, Depth, and an Incoming (no + date) column.
- Status → billing lifecycle (`unbilled`/`billed` gates `BillingGeneratePage`).

## 8. Existing Billing

- `BillingListPage` (filterable), `BillingDetailPage` (status advance draft→sent→paid, print), `BillingEditPage`, `BillingPrintPage`, `BillingGeneratePage`.
- Generation: one invoice per selected outgoing challan; invoice number reuses the outgoing challan number by default (fallback to configured series). GST = job-work SAC + rate, CGST/SGST or IGST by state code; intra/inter-state detection. `tax.ts` + `billing.ts` compute line groups and totals.
- Numbering: configurable prefix/series/padding with financial-year-aware sequence state (`invoice-numbering.ts`, backend tables).

## 9. Existing Scan / OCR

- Phone → desktop: phone opens `http://<lan-ip>:3784/` (portable web UI), captures/selects a photo, posts to `/api/scan`, desktop tags it to a session, uploads and calls Gemini, extraction returned via `/api/scan/result` and shown for **user review + edit** before save.
- `ScanFlowDialog` + `PhoneScanPanel` (embedded phone preview), `SyncPage` (server status + Gemini key), `ScanPage` (scanned-sessions list).
- No silent saves: extraction results are always suggestions.

## 10. Existing Authentication

- Local users table (seeded demo accounts, one shared demo password), `login`/`get_user`/`update_profile`/`update_avatar`/`change_password` commands; role-based module gating (`canAccessModule`). No external identity provider.

## 11. Existing Printing / PDF

- Print pages render a dedicated document layout and call `window.print()` (system print dialog / save-as-PDF). No server-side PDF generation.

## 12. Existing Master Data

- Tabbed `MastersPage`: Customers, HSN Codes, Colours, Rates, Rate Cards, Depths, Colour & Depth (shades). GST lookup button on the customer dialog (local first, then online via gstinapi.in when a free key is configured in Profile).
- Processors table *removed from the UI* but retained in DB and used as the line-item Process datalist.

## 13. Existing APIs

- Tauri invoke commands (single process, no HTTP auth needed).
- Phone-facing HTTP on 3784 (unauthenticated LAN; phone UI has no login — noted risk).

## 14. Existing Migrations

- None as files. `db.rs` boot-time `CREATE TABLE IF NOT EXISTS` + idempotent seed migrations only. Evolving schema = new `CREATE`/`ALTER` statements in `db.rs`.

## 15. Existing Tests

- **No automated tests.** Verification today = `npm run typecheck`, `npm run build`, `cargo check`, manual smoke.

## 16. Potential Technical Risks

1. **Large uncommitted change set** — the OCR pipeline, theme, 11-point feedback batch, and the latest fixes are all uncommitted; CI/Windows installer only runs on push to `main`.
2. **No test coverage** on billing math, number series, or OCR correction logging — regressions are silent.
3. **No schema-migration framework** — future production/data changes need hand-written, idempotent boot migrations.
4. **LAN sync server is unauthenticated** — acceptable on trusted LAN, but no rate limiting or auth on upload endpoints.
5. **Third-party integrity** — online GST lookup depends on a user-provided free key; OCR depends on a Gemini key. Both degrade gracefully but are "not configured" in current DB.
6. **Bundle size** — Vite warns >500 kB chunk (could code-split later).
7. `docs/` is empty and the spec file sits at `src/FeedbackItems.md` (should move to `docs/`).
8. Windows installer artifact is stale relative to the new features.

## 17. Missing Requirements (from FeedbackItems.md)

- Lot / Roll-level inventory: roll-level selection, partial dispatch, "remaining quantity" visibility, already-dispatched roll protection.
- E-way workflow beyond storing `eWayNo`: e-way document upload, PDF parse, HSN grouping + totals.
- E-invoice workflow (job-work vs sale distinction, no invented APIs).
- Finance: ledger, receivables/payables with ageing, payments, cheques, bank vouchers.
- Data migration tooling + number-series preservation + reconciliation.
- Unit transfers, returns, attachments/documents (beyond scan photos).
- Process master restored as a first-class master (UI removed), report/filter usage.
- Advanced AI: duplicate detection, party/HSN/process matching, natural-language search, weight-mismatch validation.
- Tests; auditability (CreatedBy/UpdatedBy); server-side pagination for large datasets.

## 18. Recommended Implementation Order

Aligns with the spec's phases; revisit in this order:

1. **Stabilize core workflow** — the Incoming→Outgoing→Scan→Billing→Print chain already links end-to-end; harden with tests for billing/numbering/OCR-correction.
2. **Material tracking** — roll/lot selection from linked incomings with remaining-quantity validation (§14).
3. **Billing refinements** — financial-year numbering already partially present; add transaction-type distinction later.
4. **E-way** — upload/parse/group/print; deterministic grouping code, no LLM for sums.
5. **Finance** — ledger/payments/receivables/ageing/cheques (only after core is stable).
6. **Migration** — import/map/validate/reconcile, preserve number series.
7. **Advanced AI** — master matching, duplicate detection, validation suggestions.

---

## Summary

### What Already Works
- Incoming / Outgoing challan create–edit–save–search–print, with party/GST/HSN/colour/depth/process/rate fields.
- Incoming → Outgoing linking (search + autofill + date/party carry-over).
- Automatic weight per roll (~20 kg), rate-card rate suggestion, bulk billing (one invoice per challan reusing the challan number, GST inter/intra-state).
- Phone → desktop scan/OCR with user review before save, audit via `correction_logs`.
- Masters (customers, HSN, colours, rates, rate cards, depths, shades) + local/online GST lookup.
- Dashboard, global search (⌘K), copilot panel, light/dark/system theme.
- Windows NSIS CI build.

### What Needs Improvement
- Automated tests (billing math, numbering, OCR logging).
- Migration discipline (idempotent boot migrations only, no versioned migration files).
- Phone LAN endpoint hardening.
- Bundle code-splitting; docs hygiene (`docs/`, move spec file).

### What Is Missing
- Roll/lot-level tracking with partial dispatch + remaining quantities.
- E-way document workflow and PDF aggregation.
- E-invoice/sale-vs-jobwork distinction; finance module (ledger/payments/receivables/cheques).
- Data migration tooling with number-series preservation.
- Advanced AI suggestions (duplicate detection, master matching).

### What Should NOT Be Changed
- The document JSON snapshot model for challans/invoices (deliberate, preserves history).
- The existing print layouts (inspect before touching).
- Local auth + permission model.
- The phone sync/OCR review-before-save flow (product-critical design).
- Do not "rebuild" Incoming/Outgoing/Billing/Scan — extend them.