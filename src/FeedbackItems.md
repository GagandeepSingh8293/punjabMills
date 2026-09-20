# Dyeing ERP — Project Requirements & OpenCode Build Specification

## 1. Purpose

This document is the primary product and implementation reference for extending the existing Dyeing ERP application.

The application already contains working functionality for:

* Incoming Challan
* Outgoing Challan
* Billing
* Challan/document scanning and OCR

**Do NOT rebuild these modules from scratch.**

The first responsibility is to inspect the existing codebase and understand what is already implemented. Extend the existing architecture wherever possible.

The goal is to evolve the application into a practical Dyeing / Job-Work ERP used by a real dyeing business.

---

# 2. Critical OpenCode Instructions

Before writing or modifying code:

1. Inspect the complete existing project structure.
2. Identify:

   * Frontend technology
   * Backend technology
   * Database
   * ORM/data-access layer
   * Authentication
   * Existing API structure
   * Existing components
   * Existing models/entities
   * Existing migrations
   * Existing scan/OCR implementation
   * Existing Incoming workflow
   * Existing Outgoing workflow
   * Existing Billing workflow
   * Existing print/PDF functionality
3. Understand existing naming conventions.
4. Understand existing database relationships.
5. Reuse existing components/services/models where appropriate.
6. Do not introduce a new framework or architectural pattern unless there is a strong technical reason.
7. Do not duplicate existing functionality.
8. Do not break existing functionality.
9. Do not make large architectural changes before understanding the current application.
10. Before modifying an existing module, explain what currently exists and what will be changed.

---

# 3. Existing Functionality

The following functionality already exists and should be treated as existing product functionality:

## 3.1 Incoming Challan

Existing functionality includes Incoming Challan creation and management.

Before modifying it, inspect:

* Incoming entity/model
* Incoming item model
* Party/customer relationship
* Challan numbering
* Date handling
* Item/quantity/weight fields
* Existing master relationships
* Existing status workflow
* Existing print/PDF
* Existing API
* Existing UI

Do not replace existing implementation unnecessarily.

---

## 3.2 Outgoing Challan

Existing Outgoing Challan functionality exists.

Inspect:

* Relationship with Incoming Challan
* Item handling
* Quantity
* Weight
* Party
* Vehicle
* Process
* Color
* Depth
* HSN
* Printing
* Existing APIs

The long-term desired workflow is:

Incoming Challan
→ Material/Lot/Roll
→ Outgoing Challan
→ Billing

If this relationship already exists, preserve it.

If partially implemented, improve it rather than creating a second implementation.

---

## 3.3 Billing

Billing already exists.

Inspect:

* Invoice model
* Invoice numbering
* Challan-to-invoice relationship
* GST fields
* Billing party
* Shipping party
* Invoice PDF
* Payment status
* Financial year logic

Do not assume the existing billing implementation is wrong.

First understand it.

---

## 3.4 Scan / OCR

Scanning/OCR functionality already exists.

The desired workflow is:

Document/photo
↓
OCR / extraction
↓
Populate form
↓
User reviews
↓
User edits
↓
Save

The system must NEVER blindly save OCR results without allowing user verification.

OCR-extracted data must remain editable.

---

# 4. Product Vision

The application should eventually provide this operational workflow:

Physical Challan
↓
Scan / OCR
↓
Incoming Challan
↓
Material / Lot / Roll Tracking
↓
Outgoing Challan
↓
Billing
↓
E-invoice / E-way workflow
↓
Payment
↓
Ledger / Receivables

The key business objective is:

> Reduce manual data entry and repetitive work while preserving the existing dyeing-business workflow.

The application should feel like a dyeing-industry operational system, not a generic accounting application.

---

# 5. Development Philosophy

## 5.1 Preserve Existing Work

Existing Incoming, Outgoing, Billing and Scan functionality is valuable.

Prefer:

* Extend
* Refactor carefully
* Reuse
* Improve

instead of:

* Rewrite
* Replace
* Duplicate

---

## 5.2 Everything Important Should Be Editable

Users need flexibility because physical challans and operational information can vary.

Editable fields should include, where applicable:

* Party
* Billing Party
* Shipping Party
* Address
* HSN
* Quantity
* Roll count
* Weight
* Rate
* Vehicle
* Lot
* Color
* Depth
* Process
* E-way information
* OCR-extracted values

---

# 6. Core Domain

The application should eventually support:

* Customers / Parties
* Suppliers
* Incoming Challans
* Outgoing Challans
* Items
* Rolls
* Lots
* HSN Codes
* Colors
* Depth
* Processes
* Units
* Billing
* E-way Documents
* E-invoices
* Payments
* Ledger
* Cheques
* Bank Vouchers
* Receivables
* Payables
* Returns
* Unit Transfers
* Documents / Attachments
* OCR results

Do not implement all of these at once.

Implement incrementally.

---

# 7. Master Data

## 7.1 Customer / Party Master

Customer information should support:

* Name
* GSTIN
* Address
* Billing address
* Shipping address
* State
* City
* PIN
* Contact person
* Phone
* Active/inactive

Desired future workflow:

GSTIN
↓
Fetch available business information
↓
Show user
↓
User can edit
↓
Save

Do not assume fetched GST information is always the operational address.

---

# 8. Bill To / Ship To

The system must support cases where:

Bill To != Ship To

Example:

Bill To:
Party A

Ship To:
Party B

Therefore do not tightly couple billing party and shipping party.

Support:

* Billing Party
* Shipping Party
* Billing Address
* Shipping Address
* Destination

---

# 9. HSN Master

Create or improve an HSN master.

Potential fields:

* HSN
* Description
* GST %
* Purchase HSN applicability
* Billing HSN applicability
* Item
* Active

Important:

Purchase HSN and billing HSN may be different.

Do not hardcode HSN values.

---

# 10. Color Master

Create a reusable Color master.

Example:

* Black
* Navy
* White
* Pink
* Blue

Color should be a master entity rather than free text wherever practical.

---

# 11. Depth Master

Depth is separate from Color.

Example values:

* No Depth
* Light
* Medium
* Dark
* Extra Dark
* Super Dark

Important:

The same color can have different depths.

Example:

Black + Light
Black + Medium
Black + Dark
Black + Extra Dark

Therefore store:

ColorId
DepthId

rather than combining them into a single text field.

---

# 12. Process Master

Process should be a reusable master.

At minimum:

* Process ID
* Process Name
* Active

Process should be usable in:

* Incoming
* Outgoing
* Filters
* Reports
* Billing where applicable

---

# 13. Incoming → Outgoing Relationship

This is one of the most important business relationships.

Outgoing should be able to reference its source Incoming Challan.

Desired workflow:

Select Incoming Challan
↓
Load Incoming details
↓
User edits required fields
↓
Create Outgoing Challan

Outgoing should retain:

* Incoming Challan Number
* Incoming Challan Date
* Source relationship

This allows users to answer:

> Which incoming material did this outgoing material come from?

---

# 14. Roll / Weight Tracking

The system should support partial outgoing movement.

Example:

Incoming:

9 rolls
900 KG

Outgoing:

5 rolls
500 KG

The system should eventually support selecting individual rolls or quantities and calculating totals.

Potential structure:

Incoming
└── Lot
└── Rolls

Outgoing
└── Selected Incoming Rolls

Required validations should eventually include:

* Outgoing quantity should not exceed available quantity.
* Outgoing weight should not exceed available weight unless explicitly overridden.
* Already-dispatched rolls should not be available again.
* Remaining quantity should be visible.

Example:

Incoming:
9 rolls / 900 KG

Outgoing:
5 rolls / 500 KG

Remaining:
4 rolls / 400 KG

Do not implement complex inventory assumptions unless the existing business data supports them.

---

# 15. Challan Search and Filters

Incoming and Outgoing lists should eventually support filters for:

* Challan number
* Date range
* Customer
* Vehicle number
* Destination
* Weight
* HSN
* Color
* Depth
* Process
* Lot number

Filters should be composable.

Example:

Party = ABC
Process = Dyeing
Color = Black
Depth = Dark
Date = Current Month

---

# 16. Billing

Billing already exists.

Enhance it carefully to support business workflows.

Potential billing sources:

## Job Work / Dyeing

Incoming
→ Processing
→ Outgoing
→ Job-work Invoice

## Sale

Purchase/Stock
→ Sale
→ Sales Invoice

The system should distinguish transaction types rather than assuming every invoice is the same.

Potential transaction types:

* JOB_WORK
* SALE
* PURCHASE
* TRANSFER
* RETURN

Do not introduce these enums if an equivalent structure already exists.

Reuse the existing implementation when possible.

---

# 17. Invoice Numbering

Invoice/challan numbering is important.

The business may want:

Challan 2235
→ Invoice 2235

However, numbering should be configurable and financial-year aware.

Do not hardcode this behavior.

Support configuration such as:

* Financial Year
* Prefix
* Number series
* Whether invoice follows challan number

---

# 18. Financial Year

The system must support financial years such as:

2026-27
2027-28

Numbering and reporting must be aware of financial year.

Historical data must remain accessible.

---

# 19. E-way Workflow

The application should assist with e-way workflows.

Do not assume the application should replace the government portal.

Potential functionality:

* Store E-way number
* Store E-way date
* Store document reference
* Open/redirect to relevant government workflow where appropriate
* Upload E-way PDF
* Parse E-way PDF
* Group items by HSN
* Calculate totals
* Generate internal summary/print

---

# 20. E-way PDF Processing

Desired workflow:

Upload E-way PDF
↓
Extract rows
↓
Read HSN
↓
Group rows by HSN
↓
SUM quantity
↓
SUM weight
↓
SUM amount
↓
Generate compact internal summary

Example:

Input:

HSN 2200 → 100 KG
HSN 2200 → 150 KG
HSN 2200 → 200 KG

Output:

HSN 2200
Total = 450 KG

The grouping should be deterministic and testable.

Do not rely on an LLM for simple mathematical aggregation.

Use normal application code for:

* Grouping
* SUM
* Validation
* Totals

Use AI/OCR only where it adds value for extraction/interpretation.

---

# 21. E-invoice

Support the distinction between:

* Job-work movement
* Job-work billing
* Actual sale
* E-invoice
* E-way

Do not assume every movement follows the same government process.

Government/API integration requirements must be verified before implementation.

Do not invent APIs or credentials.

---

# 22. Finance — Future Phase

Finance should eventually include:

## Ledger

* Date
* Particular
* Bill number
* Debit
* Credit
* Balance
* Cheque number where applicable

## Receivables

Show:

* Total outstanding
* Current outstanding
* Overdue
* Ageing

Potential ageing:

0–30 days
31–60 days
60+ days

## Payments

Track:

* Party
* Amount
* Date
* Payment mode
* Reference

## Cheques

Potential fields:

* Bank
* Cheque number
* Date
* Party
* Amount
* Amount in words
* Signature area

Do not build Finance before the core operational workflow is stable unless specifically instructed.

---

# 23. Data Migration

Data migration is a major requirement.

The old system contains historical information.

Migration should preserve:

* Incoming challans
* Outgoing challans
* Billing
* Party data
* Processes
* Historical records
* Pending data
* Number series
* Financial-year history

Migration should be:

Old System
↓
Backup
↓
Extract
↓
Map
↓
Validate
↓
Import
↓
Reconcile

Never directly modify production data during migration without backup and validation.

---

# 24. Existing Number Series

Historical numbering must be preserved.

Example:

Old system last invoice:
3016

New system:
3017

Do not reset numbering to 1.

Migration must preserve existing document numbers unless the business explicitly approves a new numbering scheme.

---

# 25. Printing

Printing is an important part of the application.

Eventually support templates for:

* Incoming Challan
* Outgoing Challan
* Invoice
* E-way Summary
* Ledger
* Cheque
* Reports

Before creating a new print design, inspect existing templates.

Do not replace existing print layouts unnecessarily.

---

# 26. Dashboard

The dashboard should eventually show operational information.

Potential cards:

* Incoming Today
* Outgoing Today
* Pending Billing
* Invoices Today
* Unbilled Challans
* Pending Receivables
* Overdue > 60 Days
* E-way Pending

Keep the dashboard practical.

Avoid unnecessary charts.

---

# 27. AI / Automation — Future Phase

AI should be used where it reduces repetitive manual work.

Potential features:

## Challan OCR

Photo
→ OCR
→ Structured fields
→ User review
→ Save

## Party Recognition

Extracted document data
→ Match customer master

## HSN Recognition

Extract description
→ Suggest HSN
→ User confirms

## Process Recognition

Extract process description
→ Match process master

## Duplicate Detection

Potential duplicate based on:

* Challan number
* Party
* Vehicle
* Date
* Lot

## Data Validation

Example:

Incoming:
520 KG

Outgoing:
650 KG

Show:

"Possible weight mismatch."

AI should suggest, not silently change financial/business data.

---

# 28. AI Safety / Reliability

AI-generated values must be treated as suggestions.

Never allow an AI model to silently:

* Change invoice amounts
* Change GST
* Change customer
* Change HSN
* Change quantity
* Change weight
* Change payment status
* Submit government documents

unless an explicit user confirmation workflow exists.

For deterministic calculations, use normal application code.

---

# 29. Mobile / Camera Workflow

The main ERP can remain desktop/web focused.

Mobile functionality can prioritize:

* Open application
* Scan challan
* Capture image
* OCR
* Review extracted data
* Edit
* Save
* Search/view records

Do not build a full separate mobile ERP unless required.

---

# 30. Recommended Development Order

## Phase 0 — Understand Existing Application

Inspect first.

Do not code immediately.

Create a short report:

* Current architecture
* Existing modules
* Existing database
* Existing APIs
* Existing models
* Existing workflows
* Existing technical debt
* Reusable components
* Missing requirements

---

## Phase 1 — Stabilize Core Workflow

Focus on:

Incoming
→ Outgoing
→ Scan
→ Search
→ Filters
→ Masters
→ Print

Verify that these work together.

---

## Phase 2 — Improve Material Tracking

Add/improve:

* Lot
* Roll
* Partial outgoing
* Weight tracking
* Remaining quantity
* Incoming-to-outgoing traceability

---

## Phase 3 — Billing Improvements

Improve:

* Challan → Invoice
* Job-work billing
* Sales billing
* Numbering
* Financial year
* Bill-to / Ship-to

---

## Phase 4 — E-way / E-invoice

Implement:

* E-way data
* PDF processing
* HSN grouping
* Summary
* E-invoice workflow where technically supported

---

## Phase 5 — Finance

Implement:

* Ledger
* Payments
* Receivables
* Payables
* Ageing
* Cheques

---

## Phase 6 — Migration

Build:

* Import
* Mapping
* Validation
* Reconciliation
* Number-series preservation

---

## Phase 7 — Advanced AI

Implement:

* Better OCR
* Intelligent field extraction
* Master matching
* Duplicate detection
* Natural-language search
* Document understanding

---

# 31. Definition of Done

A feature is NOT complete merely because the UI exists.

Every feature should include, where applicable:

* UI
* API
* Database
* Validation
* Error handling
* Loading state
* Empty state
* Success state
* Auditability
* Tests
* Print/export
* Permission considerations
* Migration considerations

---

# 32. Testing Requirements

Before modifying existing functionality:

1. Understand current behavior.
2. Add/execute tests for important existing behavior.
3. Make the change.
4. Verify old functionality still works.
5. Test new functionality.

For important workflows test:

### Incoming

Create
→ Edit
→ Save
→ Search
→ Print

### Outgoing

Select Incoming
→ Populate
→ Edit
→ Save
→ Print

### Billing

Outgoing
→ Invoice
→ Print

### OCR

Scan
→ Extract
→ Review
→ Edit
→ Save

---

# 33. Database Principles

Use normalized relationships for reusable masters.

Prefer:

ColorId
DepthId
ProcessId
HSNId
CustomerId

instead of repeatedly storing arbitrary strings.

However, preserve historical snapshot data where necessary.

For example, an invoice may need to retain the customer/address information applicable at the time of the invoice even if the master changes later.

Do not change the database structure without understanding existing production/historical data.

---

# 34. Auditability

For financial and operational records, eventually support:

* CreatedAt
* CreatedBy
* UpdatedAt
* UpdatedBy

Potentially:

* DeletedAt
* DeletedBy
* AuditLog

Avoid hard deletion of important financial documents unless the existing application/business rules explicitly allow it.

---

# 35. Error Handling

Errors must be understandable to business users.

Avoid messages like:

"500 Internal Server Error"

Prefer:

"Unable to create outgoing challan because the selected roll is already dispatched."

For OCR:

"Some fields could not be detected. Please review the highlighted fields."

---

# 36. Performance

The application will eventually contain large historical datasets.

Use:

* Pagination
* Server-side filtering
* Indexed search fields
* Efficient database queries
* No unnecessary full-table loading
* No N+1 queries
* Async APIs where appropriate

Do not optimize prematurely.

Measure first where possible.

---

# 37. Security

Protect:

* Customer data
* GST information
* Financial records
* Invoice data
* Credentials
* API keys
* OCR documents

Never hardcode:

* API keys
* Passwords
* Government credentials
* Database passwords

Use the existing configuration/secrets mechanism.

---

# 38. Important Business Principle

The system should adapt to the customer's workflow.

Do not force generic ERP assumptions.

If the customer currently has a workflow that is operationally important, first understand why it exists before changing it.

Where the existing workflow is inefficient, improve it gradually.

---

# 39. OpenCode Working Rules

For every task:

## Step 1

Inspect relevant existing code.

## Step 2

Identify existing implementation.

## Step 3

Identify missing functionality.

## Step 4

Explain proposed change.

## Step 5

Implement the smallest appropriate change.

## Step 6

Run relevant tests/build.

## Step 7

Check for regressions.

## Step 8

Update this project documentation.

---

# 40. Maintain a Development Log

Create:

`docs/DEVELOPMENT_LOG.md`

For every significant implementation, record:

```text
Date:
Feature:
Existing behavior:
Problem:
Decision:
Implementation:
Database changes:
API changes:
UI changes:
Tests:
Known limitations:
Next step:
```

This file becomes the long-term memory of the project.

---

# 41. Maintain a Requirements Checklist

Create:

`docs/REQUIREMENTS_CHECKLIST.md`

Track:

* [ ] Incoming Challan
* [ ] Outgoing Challan
* [ ] Incoming → Outgoing relationship
* [ ] Scan/OCR
* [ ] Customer Master
* [ ] HSN Master
* [ ] Color Master
* [ ] Depth Master
* [ ] Process Master
* [ ] Roll tracking
* [ ] Weight tracking
* [ ] Search
* [ ] Filters
* [ ] Printing
* [ ] Billing
* [ ] Job-work billing
* [ ] Sales billing
* [ ] E-way
* [ ] E-way PDF processing
* [ ] HSN grouping
* [ ] E-invoice
* [ ] Finance
* [ ] Ledger
* [ ] Payments
* [ ] Receivables
* [ ] Cheques
* [ ] Migration
* [ ] Historical data
* [ ] Number series
* [ ] AI automation

Mark each as:

* NOT_STARTED
* IN_PROGRESS
* PARTIAL
* COMPLETE
* BLOCKED

---

# 42. IMPORTANT — Do Not Overbuild

The first target is NOT a complete ERP.

The first target is:

> Scan → Incoming → Outgoing → Track Material → Billing → Print

Make this workflow extremely reliable and easy to use.

Only after this workflow is stable should advanced Finance, Migration, E-way automation and AI features be expanded.

---

# 43. First OpenCode Task

Before implementing anything, perform a codebase audit.

Do NOT modify code yet.

Produce:

`docs/CODEBASE_AUDIT.md`

with:

1. Technology stack
2. Project structure
3. Frontend architecture
4. Backend architecture
5. Database architecture
6. Existing Incoming implementation
7. Existing Outgoing implementation
8. Existing Billing implementation
9. Existing Scan/OCR implementation
10. Existing authentication
11. Existing printing/PDF
12. Existing master data
13. Existing APIs
14. Existing migrations
15. Existing tests
16. Potential technical risks
17. Missing requirements from this document
18. Recommended implementation order

At the end provide:

### "What Already Works"

### "What Needs Improvement"

### "What Is Missing"

### "What Should NOT Be Changed"

Do not implement features during this audit.

Wait for the next task after the audit.

---

# 44. Golden Rule

**Understand first. Change second.**

The existing application is already valuable.

The goal is to incrementally turn it into a robust Dyeing ERP without breaking the workflows that already work.
