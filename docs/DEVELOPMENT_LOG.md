# Development Log

Format per `FeedbackItems.md` §40. Append one entry per significant implementation.

---

## 2026-09-20 — Phase 2: Roll/Lot material tracking (dispatch allocations)
- **Existing behavior:** outgoing challans could link incoming challans at the header level; `dispatchedWeight`/`pendingWeight` counted the entire outgoing weight regardless of how much actually moved.
- **Problem/Decision:** spec §14 requires partial outgoing movement with visible remaining rolls/weight, already-dispatched protection, and incoming→outgoing traceability per line. Store per-line allocations inside the outgoing challan's snapshot (`header.dispatchAllocations`) so incoming `data_json` stays immutable.
- **Implementation:**
  - Types: `DispatchAllocation`, `LineAvailability`, `LinkedIncomingDetails` (existing `Party` export accidentally dropped then restored).
  - Rust `util.rs`: `dispatched_by_line`, `incoming_line_availability`, `validate_allocations`, `line_total_rolls/weight`; `dispatched_weight` now prefers per-line allocations (fallback to legacy full-weight).
  - Rust `commands.rs`: new `get_linked_incoming_details`; `create_challan`/`update_challan` now validate allocations up front (fail before insert), excluding the challan being edited.
  - UI (`ChallanFormPage`): "Allocate Rolls from Incoming" section per linked challan — per-line remaining/available display, rolls + weight dispatch inputs (auto weight ≈ per-roll average), "Allow weight beyond available" override, roll-exceed limits, save-time validation; search cards now show remaining kg; unlinking an incoming drops its allocations.
- **DB changes:** none (allocations live in outgoing `data_json`).
- **API changes:** `get_linked_incoming_details` command registered in `lib.rs`; `api.challans.linkedIncomingDetails`.
- **Tests:** `cargo test` — 2 new unit tests (`partial_dispatch_remaining_and_validation`, `dispatched_weight_prefers_allocations`). Pass.
- **Verification:** `npx tsc --noEmit` clean, `cargo check` clean, `npm run build` clean, app restarted, `/health` OK. New command present in running binary.
- **Known limitations:** allocations are count/weight entry (not per-roll pick); weight override is a single global switch.
- **Next step:** surface remaining rolls on incoming list page; commit/push on request.

---

## 2026-09-20 — Codebase audit (Phase 0)
- **Existing behavior:** none audited before.
- **Problem:** spec requires understanding before changing any code.
- **Decision:** produce `docs/CODEBASE_AUDIT.md`, `docs/REQUIREMENTS_CHECKLIST.md`, `docs/DEVELOPMENT_LOG.md`; no code changes in this step.
- **Implementation:** documented stack, architecture, DB schema, module inventory, risks, gaps.
- **Known limitations:** audit is based on code inspection and live DB schema, not runtime profiling.
- **Next step:** pick the first implementation phase (recommended: tests + material/roll tracking).

---

## 2026-09-20 — Phone → desktop challan sync + invoice shipping crash fix (committed `f393b0f`)
- **Existing behavior:** desktop-only data entry.
- **Problem/Decision:** allow phone (LAN webview) to create challans; fix invoice crash when a billing party had no shipping party.
- **Implementation:** LAN HTTP server on port 3784 (`sync.rs`) with `/api/challans`, phone UI at `/`; Rust events `challan:synced`; invoices fall back to billing party for shipping.
- **DB changes:** none.
- **API/UI changes:** new sync routes; SyncPage status + URL; `api.sync.*`.
- **Next step:** see OCR entry.

## 2026-09-20 — Gemini OCR scan pipeline (uncommitted)
- **Existing behavior:** incoming form had no photo capture/extraction.
- **Problem/Decision:** real scan-from-phone → Gemini extraction → user review/save, per spec §3.4 (never save silently).
- **Implementation:** `ocr.rs` (`gemini-2.5-flash`), `/api/scan` + `/api/scan/status` + `/api/scan/result` routes, `set_gemini_api_key`/`get_gemini_config`/`get_scan_photo` commands, `scan_sessions`/`scan_photos`/`correction_logs` tables, `ScanFlowDialog` + `PhoneScanPanel`.
- **DB changes:** `scan_sessions`, `scan_photos`, `correction_logs`, `app_settings` (gemini key).
- **API/UI changes:** sync routes + invoke commands + ScanPage/SyncPage/ChallanFormPage.
- **Known limitations:** real extraction unverified — needs a valid Gemini API key (BLOCKED). HTTP path validated with a real HTTP 400 from an invalid key.
- **Next step:** verify end-to-end with a real key.

## 2026-09-20 — Theme (dark/light/system) + 11 feedback points (uncommitted)
- **Existing behavior:** light theme only; listed gaps (incoming amount hidden, process/depth columns, incoming-link autofill, auto-weight, bulk billing one-per-challan, GST lookup, extra depths, combined colour·depth, copilot FAB, back button).
- **Decision:** implement per user feedback; user clarifications: one bill per challan; hide amount only (keep rate) for incoming; GST = local + online lookup.
- **Implementation:** `theme.ts` store + ProfilePage Appearance + header toggle; `shades` master (Super Dark / "-"); `linkedIncoming` enrichment on outgoing; `generate_invoices` → one invoice per challan, invoiceNo = challanNo; `lookup_gst` (local + gstinapi.in when key configured); ChallanListPage Process/Depth/Incoming columns; ChallanFormPage search-only incoming link at top, combined Colour·Depth picker, auto-weight toggle, card-based line-item editor (no horizontal scroll); billing detail back button; processors tab removed; `color-scheme` fix for dark mode; copilot FAB.
- **DB changes:** `shades` table + seeds; depths "Super Dark"/"-".
- **API changes:** `lookup_gst` rewrite (dead endpoints removed), `set_gst_api_key`/`get_gst_config` added.
- **UI changes:** multiple (see implementation).
- **Tests:** `npx tsc -b` clean, `npm run build` clean, `cargo check` clean, dev app restarted (`/health` OK).
- **Known limitations:** online GST lookup needs a free gstinapi.in key; older free endpoints (sheet.gstincheck.co.in, gst-msme-lookup.vercel.app) confirmed dead (404).
- **Next step:** commit + push so the Windows installer picks everything up (pending).

---

## Conventions
- Run `npm run typecheck`, `npm run build`, `cargo check` after changes.
- Never commit/push unless explicitly requested.
- Never rebuild Incoming/Outgoing/Billing/Scan from scratch — extend.