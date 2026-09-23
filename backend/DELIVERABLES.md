# DyeAI — Python Backend: Dyeing RECEIPT / ISSUE Deliverables

Stack: **FastAPI + SQLAlchemy 2.0 (async) + Alembic + PostgreSQL 17 + pytest** · Python 3.14
Location: `DyeAI/backend/` · Source-of-truth analysis: `backend/ANALYSIS.md`

---

## 1. What was built

A REST backend that reproduces the DyeAI app's **auth**, **masters** and **Dyeing
RECEIPT/ISSUE document** flows, with the challan JSON snapshots normalised into a relational
schema (`dyeing_documents` 1:N `dyeing_document_items`) and totals always computed server-side.

## 2. Files

```
backend/
├── ANALYSIS.md                     # full flow → API + SQLite → Postgres mapping
├── DELIVERABLES.md                 # this document
├── alembic.ini
├── alembic/
│   ├── env.py                      # sync engine from Settings, autogenerate + compare_type
│   └── versions/da7e9c61d8fd_...py # initial migration + 4 seeded users
├── pyproject.toml                  # deps + pytest config
├── .env / .gitignore
├── app/
│   ├── main.py                     # app + CORS + /health; mounts auth/masters/documents routers
│   ├── config.py                   # pydantic-settings (DATABASE_URL, SECRET_KEY, JWT)
│   ├── db.py                       # async engine + session factory + get_db
│   ├── deps.py                     # get_current_user (JWT bearer)
│   ├── security.py                 # PBKDF2-SHA256 hashing + JWT create/decode
│   ├── models/                     # base, user, master, document + __init__ registry
│   ├── schemas/                    # auth, master, document (Pydantic v2)
│   ├── services/
│   │   ├── auth_service.py         # login, change_password, profile
│   │   └── document_service.py     # transactional create/update + recalc + validation + search
│   └── api/routers/                # auth.py, masters.py, documents.py
└── tests/                          # conftest + test_documents.py (11 tests)
```

## 3. Runbook

```bash
cd DyeAI/backend
uv venv .venv && uv pip install -e ".[dev]"
createdb -h localhost dyeai            # if not present
.venv/bin/alembic upgrade head         # creates schema + seeds 4 users
.venv/bin/uvicorn app.main:app --port 8000   # serve (http://127.0.0.1:8000/docs)
.venv/bin/pytest                       # 11 tests, isolated dyeai_test DB
```

Seeded users (password `Password123!`): Haninder Singh (Admin), Arjun Patel (Supervisor),
Vikram Singh (Operator), Anita Desai (Accounts).

## 4. Schema overview

```
users ─┬─ created_by/updated_by ── dyeing_documents ─ 1:N ─ dyeing_document_items
       └─ created_by/updated_by ── masters (customers, categories, items, dyeing_types,
                                   colours, colour_groups, processes, tax_accounts,
                                   hsn_codes, depths, shades, rate_cards)
```

`dyeing_documents` key constraints:
- `document_type` CHECK (`RECEIPT` | `ISSUE`); `status` CHECK (`draft` | `saved`)
- UNIQUE `(document_type, challan_no)`
- Indexes on `document_date, document_type, customer_id, vehicle_no, challan_no`
- Totals `total_rolls/total_qty` NUMERIC(18,3); money NUMERIC(18,2); `document_date` DATE;
  `created_at/updated_at` TIMESTAMPTZ; `created_by/updated_by` FK → users

`dyeing_document_items` key constraints:
- UNIQUE `(dyeing_document_id, line_no)`; FK `dyeing_document_id` **ON DELETE CASCADE**
- Indexes on `dyeing_document_id, lot_no, item_id, colour_id`
- `rolls/quantity` NUMERIC(18,3); `rate/amount` NUMERIC(18,2)
- Every line keeps 5 master FKs (item, dyeing_type, colour, colour_group, process)

## 5. Server-side recalc (clients cannot set amounts)

```
line amount  = quantity × rate          (rounded to 0.01, HALF_UP)
total_rolls  = Σ rolls                  total_qty = Σ quantity
gross_amount = Σ (quantity × rate)      net_amount = gross_amount + round_off
```
Applied on every create and update; item replacement in update is re-verified (fix:
deletes are flushed before new inserts to avoid the `(doc_id, line_no)` unique violation).

## 6. Validation & errors

- `challan_no` and `document_date` required; ≥ 1 item; `line_no` unique per document
- `rolls/quantity/rate` ≥ 0; `round_off` any numeric
- Every `*_id` FK must exist → `400` listing unknown masters
- Duplicate `(document_type, challan_no)` → `409`
- Schema violations → `422`; unknown master kind → `404`
- Create/update are **transactional** (single commit, rollback on any failure)

## 7. Endpoints implemented

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | → JWT + user |
| GET | `/auth/me`, PATCH `/auth/users/me`, PUT `/auth/users/me/avatar`, PUT `/auth/users/me/password` | profile |
| GET/POST/PUT/DELETE | `/masters/{kind}[/{id}]` | 12 kinds, search `?q=` |
| POST | `/documents` | create RECEIPT/ISSUE (`201`) |
| GET | `/documents` | list/search filters: `documentType, q, dateFrom, dateTo, customer, vehicleNo, status, lot, item, colour, page, pageSize` |
| GET | `/documents/filter-options` | customers/items/colours/vehicleNos/lotNos/statuses |
| GET | `/documents/{id}`, `/documents/{id}/items` | detail with nested `{id,name}` refs |
| PUT | `/documents/{id}` | partial update + full item replacement |
| DELETE | `/documents/{id}` | cascades items |

Document response shape wraps every FK as `{"id": …, "name": …}` (customers, category,
items' item/dyeing_type/colour/colour_group/process, tax_account) — 3 bulk queries max.

Example (create):
```json
POST /documents
{
  "document_type": "RECEIPT",
  "challan_no": "RC-0001",
  "document_date": "2026-09-23",
  "customer_id": "…uuid…",
  "vehicle_no": "PB11AB1234",
  "items": [
    {"line_no": 1, "lot_no": "LOT-1", "item_id": "…", "rolls": 25, "quantity": "1200.5", "rate": "18.75"}
  ]
}
→ 201 {"id": "…", "total_rolls": "25.000", "total_qty": "1200.500",
        "gross_amount": "22509.38", "net_amount": "22509.38", "items": [{"amount": "22509.38", …}]}
```

## 8. Decisions / assumptions
- **Money** uses NUMERIC(18,2)/NUMERIC(18,4) discipline — zero floats anywhere.
- Passwords: PBKDF2-SHA256 (stdlib) — no external password lib; JWT via PyJWT.
- `challan_no` uniqueness is scoped per document type (the app reuses challan numbers
  between Incoming and Outgoing flows).
- Seed users live in the migration so a fresh `upgrade head` is fully self-contained.
- Item replacement on update is delete-and-reinsert (matches the app's save-whole-form model).
- The spec's `Journal/Billing` and dispatch-allocations parity remain **next phase**
  (see ANALYSIS §B table for their target tables).

## 9. Verified
- `alembic upgrade head` / `downgrade base` cycle + 4 users re-seeded
- 11/11 pytest cases pass in an isolated `dyeai_test` DB
- Live smoke: create both doc types, totals recalc, duplicate→409, missing master→400,
  duplicate line→400, update-replace→recalc, delete→cascade (0 orphan lines)