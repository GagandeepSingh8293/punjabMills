# Requirements Checklist

Status legend: `NOT_STARTED`, `IN_PROGRESS`, `PARTIAL`, `COMPLETE`, `BLOCKED`.

Compiled from `docs/CODEBASE_AUDIT.md` (2026-09-20). Revisit after each implementation phase.

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 1 | Incoming Challan (create/edit/list/print) | COMPLETE | `ChallanFormPage` + `ChallanListPage`. |
| 2 | Outgoing Challan (create/edit/list/print) | COMPLETE | Adds dispatch/transporter/auto-weight, rate suggestions. |
| 3 | Incoming → Outgoing relationship | PARTIAL | Header link + per-line dispatch allocations + availability; per-roll selection not yet. |
| 4 | Scan / OCR (review before save) | PARTIAL | Gemini extraction end-to-end; needs real API key verification (BLOCKED). |
| 5 | Customer / Party Master | COMPLETE | With GSTIN + local/online lookup. |
| 6 | HSN Master | COMPLETE | code/description/tax_rate; used in forms & billing. |
| 7 | Colour Master | COMPLETE | |
| 8 | Depth Master | COMPLETE | Includes Super Dark + "-" (no depth). |
| 9 | Process Master | PARTIAL | Table exists + datalist; UI tab removed; no report/filter usage. |
| 10 | Roll / Lot tracking | PARTIAL | Per-line dispatch allocations with remaining rolls/weight, excluding already-dispatched; individual-roll selection not yet. |
| 11 | Weight tracking | PARTIAL | ~20 kg/roll auto + per-line allocated dispatched weight; weight override flag for beyond-available. |
| 12 | Search across challans | COMPLETE | ⌘K global search (fuse.js). |
| 13 | List filters (composable) | PARTIAL | Challan/billing list filters exist; colour/depth/process/lot filters missing. |
| 14 | Printing | COMPLETE | Challan + invoice print pages (`window.print`). |
| 15 | Billing (challan → invoice) | COMPLETE | One invoice per challan, challanNo reuse, draft/sent/paid. |
| 16 | Job-work billing | COMPLETE | SAC + GST on outgoing; can extend types later. |
| 17 | Sales billing | NOT_STARTED | No sale/inventory source. |
| 18 | Invoice numbering (series, FY-aware) | PARTIAL | prefix/series/padding + FY sequence; "invoice follows challan" done. |
| 19 | Financial Year handling | PARTIAL | FY in numbering sequence; no FY filtering/reporting. |
| 20 | E-way data capture | PARTIAL | `eWayNo` field only. |
| 21 | E-way PDF processing + HSN grouping | NOT_STARTED | Deterministic aggregation code required. |
| 22 | E-invoice | NOT_STARTED | Requires verified government API (none invented). |
| 23 | Finance — Ledger | NOT_STARTED | Phase 5. |
| 24 | Finance — Payments | NOT_STARTED | |
| 25 | Finance — Receivables (with ageing) | NOT_STARTED | |
| 26 | Finance — Cheques / Bank vouchers | NOT_STARTED | |
| 27 | Bill To / Ship To separation | COMPLETE | Independent billing + shipping parties with GSTIN. |
| 28 | GST lookup (local + online) | PARTIAL | Local complete; online needs user free API key (gstinapi.in). |
| 29 | Data migration + number-series preservation | NOT_STARTED | Phase 6. |
| 30 | Dashboard (operational cards) | PARTIAL | Incoming/outgoing/billing cards present; receivables/overdue/e-way pending. |
| 31 | AI automation (matching, duplicate detection, NLP search) | PARTIAL | OCR extraction + review only; suggestions/validation missing. |
| 32 | AI safety / review-before-save | COMPLETE | Extraction never saves silently; edits logged. |
| 33 | Auditability (created/updated by) | PARTIAL | `correction_logs` for OCR; no CreatedBy/UpdatedBy on docs. |
| 34 | Automated tests | PARTIAL | First Rust unit tests added (dispatch allocation + remaining + validation). |
| 35 | Performance (pagination, indexed search) | PARTIAL | Lists paginated; no N+1 mitigation review. |
| 36 | Unit transfers / Returns / Attachments | NOT_STARTED | |

## Suggested next steps
1. Roll/lot tracking with remaining-quantity validation (Phase 2).
2. Tests for billing math + numbering + OCR logging.
3. E-way PDF workflow (Phase 4).
4. Finance module after core stabilizes (Phase 5).