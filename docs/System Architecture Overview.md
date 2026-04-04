# Modular Business Accounting Platform — System Architecture Overview

## 1. Vision and Goals

This document describes the architecture for a modular business accounting platform designed to compete with established packages such as QuickBooks, Xero, SAP, and NetSuite. The platform provides core accountancy services, stock control, and order management through a set of independent but interoperating modules.

The defining principle of the platform is **modularity**. Each functional area is delivered as a separate module that communicates with other modules exclusively through published APIs. This architecture enables the platform vendor to develop and release modules independently, third-party developers and businesses to build their own modules that integrate seamlessly with the platform, and individual businesses to adopt only the modules they need while retaining the ability to expand over time.

The APIs are the product as much as the modules themselves. By publishing stable, well-documented APIs, the platform becomes an ecosystem rather than a monolithic application.


## 2. The General Ledger Module — The Heart of the System

### 2.1 Role and Responsibility

The General Ledger (GL) module is the central, authoritative record of all financial transactions across the entire platform. Every module that has a financial consequence — invoicing, stock movements, payroll, bank transactions — ultimately records that consequence by posting a transaction to the GL.

The GL module's responsibilities are deliberately narrow and focused:

- Receiving and validating transaction submissions from other modules via API.
- Maintaining the immutable, cryptographically verified transaction chain.
- Maintaining a queryable database mirror for reporting and read access.
- Enforcing approval workflows for transactions that require human sign-off.
- Providing read APIs for reporting modules and other consumers of financial data.

The GL module explicitly does **not** interpret supporting documents (such as PDFs of invoices), manage inventory, understand customer or supplier relationships, or perform any business logic beyond financial recording and control. It is a precision instrument, not a Swiss army knife.

### 2.2 The Immutable Transaction Chain

#### Concept

The GL takes direct inspiration from blockchain technology, borrowing the properties that make blockchains trustworthy while discarding the decentralised consensus mechanisms that are unnecessary (and performance-limiting) in a controlled, single-authority system.

Every transaction posted to the GL is written to an **append-only file** using a bespoke format. Records are never updated or deleted. If an error is made, it is corrected by posting a new, counter-balancing transaction that references the original. The complete history of the ledger is always preserved.

#### Hash Chaining

Each transaction record includes a cryptographic hash of the previous transaction, creating an unbreakable sequential chain. If any historical record were altered — even by a single byte — every subsequent hash in the chain would become invalid, making tampering immediately detectable.

A transaction record in the chain contains:

- **Transaction ID** — a unique identifier.
- **Sequence number** — the position in the chain.
- **Timestamp** — when the transaction was committed to the chain.
- **Previous hash** — the chain hash of the immediately preceding record.
- **Transaction type** — the human-friendly type code (e.g., `CUSTOMER_INVOICE`).
- **Postings** — the set of individual debit and credit entries.
- **Payload hash** — a hash of the transaction's own content.
- **Chain hash** — computed from the combination of the payload hash and the previous hash.
- **Metadata** — source module, source reference, approval details, confidence scores, document references, and other contextual data.

#### JSON Transaction Data

Transaction data within the chain file is stored in **JSON format**. While this is less space-efficient than a binary format, it provides critical advantages: human readability for auditing and debugging, ease of parsing by third-party verification tools, and self-describing structure that reduces the risk of format misinterpretation.

Each record in the file consists of a fixed-size binary header (containing the sequence number, chain hash, previous hash, and record length) followed by the JSON transaction payload.

#### Period-Based Files

The chain is divided into files by **accounting period** (typically monthly). When a period is closed, its file is made **read-only** at the filesystem level, using operating system immutability protections. This means:

- Closing a period is a clear, physical action — the file is sealed.
- Archived period files can be backed up as simple, self-contained units.
- The current period's file is the only one that accepts new entries.

#### Periodic Checkpoints

At each period end, a **checkpoint hash** is computed representing the entire state of the ledger up to that point. These checkpoint hashes can be published, stored externally, or signed by a third party. They provide independent proof of the ledger's state at each period boundary, enabling verification even in the event of total system compromise.

#### Merkle Tree Enhancement

Within each period, transactions can be structured as a **Merkle tree** — a tree of hashes where each parent node is the hash of its children. This enables efficient verification of individual transactions without recalculating the entire chain. An auditor verifying a single invoice posting can receive a short "proof path" through the tree rather than processing every transaction in the period.

### 2.3 The Hybrid Storage Model

The platform uses a **dual-storage approach**:

1. **The authoritative chain files** — the bespoke, append-only, hash-chained files described above. These are the legal book of record. Their immutability is structural (the format doesn't support modification) rather than merely enforced by permissions.

2. **A conventional database mirror** — a relational database (such as PostgreSQL) that contains a fully indexed copy of the same data, optimised for queries and reporting.

Every time a transaction is committed to the chain file, the same data is written to the database. The chain file is always the source of truth. The database serves all read operations — balance enquiries, trial balances, transaction listings, reporting queries.

If the database is ever suspected of being compromised or corrupted, it can be **completely rebuilt** from the chain files. This recovery capability is a fundamental design guarantee.

The write path is:

1. Transaction arrives via API.
2. GL engine validates the transaction.
3. Approval rules are evaluated (see Section 2.5).
4. If approved (or auto-approved), the chain hash is computed.
5. The transaction is appended to the current period's chain file.
6. The file write is confirmed durable (fsynced to disk).
7. The same data is written to the database.
8. A confirmation is returned to the submitting module.

If step 7 fails but step 6 succeeded, the database can be recovered from the chain file. The chain file write is the commitment point.

### 2.4 Human-Friendly Transaction Types

Modules do not post raw debit-and-credit entries to the GL. Instead, they submit **business transactions** using a catalogue of meaningful, widely understood transaction types. The GL module translates each business transaction into the correct set of double-entry postings.

This is a critical design choice. It means that module developers don't need to understand double-entry bookkeeping — they work with business concepts. It also means the GL can enforce accounting correctness centrally.

#### Transaction Type Catalogue

**Sales and Receivables:**
- `CUSTOMER_INVOICE` — Record a sale to a customer.
- `CUSTOMER_CREDIT_NOTE` — Reverse or reduce a previous sale.
- `CUSTOMER_PAYMENT` — Record receipt of payment from a customer.
- `BAD_DEBT_WRITE_OFF` — Write off an amount owed by a customer.

**Purchasing and Payables:**
- `SUPPLIER_INVOICE` — Recognise an invoice received from a supplier.
- `SUPPLIER_CREDIT_NOTE` — Recognise a credit note from a supplier.
- `SUPPLIER_PAYMENT` — Record a payment made to a supplier.

**Stock and Inventory:**
- `STOCK_RECEIPT` — Goods received into inventory.
- `STOCK_DISPATCH` — Goods dispatched from inventory.
- `STOCK_WRITE_OFF` — Remove stock from the books (damaged, lost, obsolete).
- `STOCK_TRANSFER` — Move stock between locations (balance-sheet neutral).
- `STOCK_REVALUATION` — Adjust the carrying value of stock.

**Banking and Cash:**
- `BANK_RECEIPT` — Money received into a bank account.
- `BANK_PAYMENT` — Money paid from a bank account.
- `BANK_TRANSFER` — Transfer between the organisation's own accounts.

**Adjustments and Period End:**
- `JOURNAL_ENTRY` — A manual posting by an accountant (the catch-all).
- `PERIOD_END_ACCRUAL` — Recognise an expense or income not yet invoiced.
- `PREPAYMENT_RECOGNITION` — Release a portion of a prepaid expense.
- `DEPRECIATION` — Record the depreciation of a fixed asset.
- `FX_REVALUATION` — Adjust balances for foreign exchange rate movements.

#### Account Mapping

The rules that determine which general ledger accounts each transaction type debits and credits are **configurable**, not hardcoded. Each business sets up its own chart of accounts and maps transaction types to those accounts during implementation. Sensible defaults are provided, but the system accommodates the reality that different organisations use different account structures.

For example, `CUSTOMER_INVOICE` by default debits Trade Debtors and credits Sales Revenue, but a particular business might split sales credits across multiple accounts by product category, department, or region. The mapping configuration handles this.

### 2.5 The Approval Workflow

#### Centralised in the GL Module

The approval workflow for transactions that require human authorisation is built into the GL module itself, **not** in the individual posting modules. This is a deliberate and important architectural decision.

If approval logic were delegated to each module, the GL would have to trust every module's claim that a transaction had been properly approved. A poorly built or compromised third-party module could bypass approval entirely. By centralising approval in the GL, the control is applied uniformly and cannot be circumvented by any external module.

#### How It Works

When a transaction is submitted via the API, the GL validates it structurally (debits equal credits, accounts exist, period is open) and then evaluates it against the business's **approval rules**. The outcome is one of three states:

1. **POSTED** — the transaction meets the criteria for automatic posting. It is written to the chain and the database immediately. The submitting module receives a confirmation with the transaction ID.

2. **AWAITING_APPROVAL** — the transaction requires human sign-off. It is placed in a **staging area** (a conventional database table, separate from the immutable chain) and the submitting module receives a response indicating that approval is pending.

3. **REJECTED** — the transaction fails structural validation. Nothing is written anywhere. The submitting module receives an error with specific validation failure codes.

Critically, transactions awaiting approval are **never written to the immutable chain**. The staging area is a working space where records can be approved, rejected, or returned for amendment. Only upon approval does the transaction move from staging to the permanent chain.

#### Approval Rules Engine

The rules that determine whether a transaction requires approval are configured by the business and can consider:

- **Amount thresholds** — transactions above a certain value require approval.
- **Source module** — third-party modules might always require approval; trusted first-party modules might be auto-approved for routine entries.
- **Transaction type** — journal entries, as the most easily abused type, might always require approval.
- **Counterparty** — new suppliers or customers might require approval for initial transactions.
- **Pattern detection** — an unusually large transaction from a supplier that normally sends small invoices.
- **Confidence scores** — AI-generated transactions below a certain confidence threshold.

Even auto-approved transactions are recorded as having been **evaluated against the rules** and found to meet the criteria. This evaluation is part of the audit trail.

#### Approval Features

The approval system supports practical business needs:

- **Delegation** — an approver can delegate authority to a colleague during absence.
- **Escalation** — transactions sitting in the queue beyond a configurable period are escalated.
- **Multi-level approval** — high-value transactions can require sign-off from multiple approvers.
- **Segregation of duties** — the system can enforce that the person who raised a purchase order cannot approve the corresponding invoice. The GL can enforce this because it has visibility of both transactions.

#### The Approval Experience

When an approver reviews a pending transaction, the GL's approval interface assembles context from multiple modules. It displays the transaction details from the staging area, retrieves the source document from the Document Repository (see Section 3.1) for visual review, queries the relevant modules for linked records (purchase orders, goods received notes, etc.), and presents everything in one view. The GL orchestrates this by making API calls to other modules using the references attached to the pending transaction, but it does not store or manage the supporting data itself.

### 2.6 The GL Posting API

The posting API is the single most important interface in the platform. Every module that records a financial event calls this API. It is designed to be simple for straightforward cases while accommodating the full complexity of real-world accounting through optional fields.

#### Core Posting Endpoint

```
POST /api/v1/gl/transactions
```

#### Request Schema

```json
{
  "transaction_type": "CUSTOMER_INVOICE",
  "reference": "INV-2026-00142",
  "date": "2026-03-02",
  "period": null,
  "currency": "GBP",
  "exchange_rate": null,
  "counterparty": {
    "trading_account_id": "TA-CUST-0445-GBP",
    "contact_id": "CONTACT-0087"
  },
  "description": "Sale of Ford Mustang 2005 XYZ to Northern Building Supplies",
  "lines": [
    {
      "description": "Ford Mustang 2005 XYZ — Blue, Black Leather, Sunroof",
      "net_amount": 38500.00,
      "tax_code": "STANDARD_VAT_20",
      "tax_amount": 7700.00,
      "account_override": null,
      "cost_centre": "SALES_NORTH",
      "department": "VEHICLES",
      "dimensions": {
        "project": null,
        "region": "YORKSHIRE"
      },
      "line_metadata": {
        "product_type_id": "PT-FORD-MUST-2005-XYZ",
        "sku": "FMUST05XYZ-BLUE-BLKLTH-SUN",
        "quantity": 1,
        "unit_price": 38500.00
      }
    }
  ],
  "source": {
    "module_id": "sales-and-customer",
    "module_reference": "SO-2026-0891",
    "document_hash": "f8a21c4e...b332",
    "correlation_id": "saga-2026-03-02-00441"
  },
  "approval_context": {
    "confidence_score": null,
    "pre_approved_by": null,
    "approval_notes": null
  },
  "idempotency_key": "sales-INV-2026-00142"
}
```

**Key fields explained:**

- **transaction_type** (required) — drives the GL's account mapping and validation rules.
- **reference** — the submitting module's own identifier (invoice number, payment reference, etc.). Stored for traceability but not interpreted by the GL.
- **date** — the accounting date of the business event. Determines the accounting period. The optional **period** field allows explicit period specification for edge cases like year-end adjustments; if omitted, the GL derives the period from the date.
- **currency and exchange_rate** — for multi-currency transactions. If the currency matches the base currency, exchange rate is not required. For foreign currency transactions, the GL records both foreign and base currency amounts.
- **counterparty** — identifies the other party using two references: the **trading_account_id** (the specific commercial relationship in a specific currency, used for operational queries like "what is the balance on this account?") and the **contact_id** (the real-world entity, used for higher-level queries like "what is our total exposure to this company?"). Optional for transaction types like depreciation or journal entries. The GL stores both references but does not validate them against other modules.
- **lines** — the financial detail. Each line carries a net amount, tax code and tax amount, and optional fields for account overrides, cost centres, departments, and freeform dimensions. The **line_metadata** object stores non-financial context (product references, quantities, unit prices) that the GL preserves but does not act on.
- **source** — identifies the submitting module and the originating record. The **correlation_id** links related transactions (e.g., a `STOCK_DISPATCH` and `CUSTOMER_INVOICE` triggered by the same sales order fulfilment).
- **approval_context** — optional metadata that informs the GL's approval rules. Confidence scores from AI modules, pre-approval references, and notes for approvers.
- **idempotency_key** (required) — guarantees that the same transaction cannot be posted twice if a network failure causes a retry. If the GL receives a key it has already processed, it returns the original response without creating a duplicate.

#### GL Processing Sequence

When the GL receives a posting request, it processes it through a defined sequence:

1. **Authentication and authorisation** — verify the module's identity and confirm it is permitted to post this transaction type. Reject with `403 FORBIDDEN` if not.
2. **Schema validation** — check all required fields are present and correctly typed. Reject with `400 BAD_REQUEST` if invalid.
3. **Business validation** — check the date falls in an open period, amounts are consistent, any account overrides reference active accounts. Reject with `422 UNPROCESSABLE_ENTITY` if invalid.
4. **Posting generation** — expand the business transaction into double-entry postings using configured account mappings. Verify debits exactly equal credits.
5. **Approval evaluation** — evaluate against the business's approval rules based on type, amount, source, counterparty, and approval context.
6. **Commit or stage** — if auto-approved, write to the immutable chain and database mirror; if held, write to the staging area.

#### Response Schema — Posted

```json
{
  "status": "POSTED",
  "transaction_id": "TXN-20260302-00847",
  "sequence": 18472,
  "chain_hash": "e92d1f44b7...2203",
  "posted_at": "2026-03-02T14:23:01.447Z",
  "period": "2026-03",
  "postings": [
    {
      "account": "1100-TRADE_DEBTORS",
      "debit": 46200.00,
      "credit": 0,
      "cost_centre": null,
      "department": null
    },
    {
      "account": "4100-VEHICLE-SALES",
      "debit": 0,
      "credit": 38500.00,
      "cost_centre": "SALES_NORTH",
      "department": "VEHICLES"
    },
    {
      "account": "2200-VAT_OUTPUT",
      "debit": 0,
      "credit": 7700.00,
      "cost_centre": null,
      "department": null
    }
  ],
  "balance_check": "PASSED",
  "approval": {
    "method": "AUTO_APPROVED",
    "rule_evaluated": "TRUSTED_MODULE_UNDER_THRESHOLD",
    "approved_at": "2026-03-02T14:23:01.447Z"
  }
}
```

#### Response Schema — Awaiting Approval

```json
{
  "status": "AWAITING_APPROVAL",
  "staging_id": "STG-20260302-00091",
  "received_at": "2026-03-02T14:23:01.447Z",
  "approval": {
    "required_by": ["AP_SUPERVISOR"],
    "rule_triggered": "NEW_SUPPLIER_FIRST_INVOICE",
    "expires_at": "2026-03-09T23:59:59Z",
    "queue_position": 3
  },
  "estimated_postings": [
    {
      "account": "5000-PURCHASES_RAW_MATERIALS",
      "debit": 2500.00,
      "credit": 0
    },
    {
      "account": "2201-VAT_INPUT",
      "debit": 500.00,
      "credit": 0
    },
    {
      "account": "2100-TRADE_CREDITORS",
      "debit": 0,
      "credit": 3000.00
    }
  ]
}
```

The estimated postings show what will be written to the ledger if approved, but are not committed until approval is granted.

#### Error Responses

Errors are specific and actionable, enabling module developers to diagnose and fix issues programmatically:

```json
{
  "status": "REJECTED",
  "error_code": "PERIOD_CLOSED",
  "message": "Transaction date 2026-02-28 falls in period 2026-02 which is closed",
  "details": {
    "transaction_date": "2026-02-28",
    "derived_period": "2026-02",
    "period_status": "CLOSED",
    "last_open_period": "2026-03"
  },
  "suggestion": "Resubmit with a date in the current open period (2026-03) or request the period to be reopened"
}
```

Standard error codes include: `PERIOD_CLOSED`, `ACCOUNT_NOT_FOUND`, `DEBITS_CREDITS_MISMATCH`, `DUPLICATE_IDEMPOTENCY_KEY`, `UNAUTHORISED_TRANSACTION_TYPE`, `INVALID_TAX_CODE`, `EXCHANGE_RATE_REQUIRED`, `INVALID_AMOUNT`, and `MISSING_REQUIRED_FIELD`.

#### Supporting Endpoints

**Transaction retrieval:**
- `GET /api/v1/gl/transactions/{transaction_id}` — single transaction with full detail.
- `GET /api/v1/gl/transactions` — filtered listing by date range, period, account, counterparty, type, source module, or correlation ID.

**Account balances:**
- `GET /api/v1/gl/accounts/{account_code}/balance` — current balance or balance at a specified date.
- `GET /api/v1/gl/trial-balance` — complete trial balance for a period.

**Approval management:**
- `GET /api/v1/gl/approvals/pending` — list transactions awaiting approval.
- `POST /api/v1/gl/approvals/{staging_id}/approve` — approve a pending transaction.
- `POST /api/v1/gl/approvals/{staging_id}/reject` — reject a pending transaction.
- `GET /api/v1/gl/approvals/{staging_id}` — full detail on a pending item.

**Chain verification:**
- `GET /api/v1/gl/chain/verify` — run hash chain verification for a period.
- `GET /api/v1/gl/chain/checkpoint/{period}` — retrieve the checkpoint hash for a closed period.

**Transaction type discovery:**
- `GET /api/v1/gl/transaction-types` — catalogue of supported types with required and optional fields. A self-documenting API for module developers.

**Webhooks:**
- `POST /api/v1/gl/webhooks` — register callback URLs for events: transaction posted, transaction approved, transaction rejected, period closed.

#### Bulk Operations

For month-end processing, migration, or bulk imports, a batch endpoint accepts an array of transactions:

```
POST /api/v1/gl/transactions/bulk
```

Each transaction in the batch is validated and posted independently — a failure on one does not roll back the others. The response includes the result for each transaction, keyed by idempotency key.

#### API Versioning

The endpoint path includes `/v1/`. Breaking changes introduce a new version (e.g., `/v2/`) while the previous version continues for a defined deprecation period. Non-breaking additions (new optional fields, new transaction types) do not require a version bump.

### 2.7 Period Management and Closing

#### Purpose

Accounting periods must eventually be **closed** so that definitive financial statements can be produced. Period closing is a core GL function — it is the formal process that transitions a period's chain file from accepting new transactions to being permanently sealed.

This is one of the areas where the platform's immutable chain architecture provides a genuine advantage over traditional database-backed systems. When a period is closed, the chain file is physically sealed — a final checkpoint hash is computed, the Merkle root is finalised, and the file format structurally cannot accept further writes. This is not merely a flag in a database that an administrator could reverse; it is a property of the storage layer itself.

#### Period States

A period progresses through three states:

**OPEN** — Normal trading. Transactions flow in from modules, pass through the approval workflow (Section 2.5), and are committed to the chain file. This is the default state for the current trading period.

**SOFT CLOSE** — The period has passed its calendar end date and is winding down. Transactions can still be posted, but only with an explicit soft-close override permission. This state exists for the accountants working through month-end procedures — accruals, prepayments, depreciation runs, provisions, error corrections, and other adjusting entries. Routine module-originated transactions (new sales invoices, purchase recognitions) should be directed to the next open period. The GL enforces this by rejecting posts from modules that do not hold the soft-close override permission, returning a response that directs the module to resubmit against the next period.

**HARD CLOSE** — The period is permanently sealed. No further postings of any kind are accepted. The GL computes the final trial balance, generates the closing checkpoint hash, seals the chain file, and the period is done. At this point the opening balances for the next period are computed and stored — these are the closing balance sheet figures carried forward.

#### The Closing Process

When an authorised user initiates a hard close, the GL runs a series of mandatory validation checks before sealing the period:

1. **Trial balance verification** — total debits must equal total credits for the period. If not, the close is refused.
2. **Staging area clearance** — all transactions in the approval staging area for this period must be either committed or explicitly rejected. A period cannot close with pending items.
3. **Sub-ledger reconciliation** — each connected module is asked to confirm that its sub-ledger agrees with the GL control accounts for the period. The Sales module confirms that its accounts receivable detail matches the AR control account in the GL. The Purchasing module confirms accounts payable. This is achieved through a reconciliation API that modules call to signal agreement, and the GL checks that all expected confirmations have been received.
4. **Sequential ordering** — periods must be closed in order. March cannot be closed before February, because March's opening balances depend on February's final figures.

If all checks pass, the GL:

1. Computes the final Merkle root for the period.
2. Writes a closing checkpoint record to the chain file containing the period's final trial balance, the Merkle root, the timestamp, and the identity of the authorising user.
3. Seals the chain file (the file becomes structurally read-only).
4. Computes and stores the opening balances for the next period.
5. **Flags the database mirror data for this period as "closed — authoritative"**, distinguishing it from open-period data which is flagged as "open — provisional". This distinction flows through to all reporting queries, so that reports can clearly indicate whether the figures they present are final or still subject to change.
6. Publishes a `PERIOD_CLOSED` event via webhooks to all subscribed modules.

#### Post-Close Adjustments

A closed period is **never reopened**. The chain file is sealed and the architecture does not support modification. If an error is discovered after close, the correction is posted as a `PRIOR_PERIOD_ADJUSTMENT` transaction in the current open period. This transaction type carries mandatory fields:

```json
{
  "transaction_type": "PRIOR_PERIOD_ADJUSTMENT",
  "reference": "PPA-2026-001",
  "date": "2026-04-05",
  "adjustment_context": {
    "original_period": "2026-03",
    "original_transaction_id": "TXN-2026-03-00412",
    "reason": "Supplier invoice dated March posted to wrong expense category",
    "authorised_by": "finance.controller@ourcompany.com"
  },
  "lines": [
    {
      "description": "Correction: reclassify from Office Supplies to Equipment Maintenance",
      "account": "5020-EQUIPMENT_MAINTENANCE",
      "debit": 1250.00
    },
    {
      "description": "Correction: reclassify from Office Supplies to Equipment Maintenance",
      "account": "5010-OFFICE_SUPPLIES",
      "credit": 1250.00
    }
  ],
  "source": {
    "module_id": "general-ledger",
    "module_reference": "PPA-2026-001"
  },
  "idempotency_key": "gl-PPA-2026-001"
}
```

This preserves the immutability of the closed period while allowing corrections. The audit trail is unambiguous — anyone can see exactly what was changed, when, why, and by whom.

#### Year-End Closing

The final period of a financial year triggers an additional **year-end close** process. After the last period is hard-closed, the GL automatically generates a set of year-end journal entries that:

1. Zero out all revenue and expense (profit and loss) accounts.
2. Transfer the net result to a retained earnings account (or whatever appropriation structure the business has configured).
3. Post these entries as a `YEAR_END_CLOSE` transaction type in the first period of the new financial year.

The opening balances for the new year therefore reflect a clean balance sheet — all P&L accounts start at zero, and the accumulated result is rolled into equity.

#### Period Configuration

The GL supports configurable period structures. Monthly periods (12 per year) are the default, but the system also supports 4-4-5 week periods (common in retail), 13-period years, and custom period definitions. The period structure is defined at tenant setup and the closing mechanics work identically regardless of the period pattern chosen.

#### Inter-Module Period Coordination

The GL is the **single source of truth** for period status across the entire platform. It exposes period information through the API:

```
GET /api/v1/gl/periods
GET /api/v1/gl/periods/current
GET /api/v1/gl/periods/{period_id}/status
```

When a period transitions between states, the GL publishes webhook events (`PERIOD_SOFT_CLOSED`, `PERIOD_CLOSED`) so that all connected modules can adjust their behaviour — directing new transactions to the appropriate period and preventing submissions to closed periods before they reach the GL.


## 3. Supporting Modules

### 3.1 The Document Repository

#### Purpose

The Document Repository is a separate module that provides secure, immutable storage for all supporting documents across the platform — supplier invoice PDFs, bank statements, delivery notes, contracts, receipt images, and any other files that evidence or support financial transactions.

The GL module does **not** store supporting documents. It stores only a **document reference** (a content hash) as metadata on each transaction. The Document Repository is the authoritative store for the documents themselves.

#### Content-Addressed Storage

Documents are stored and retrieved by the **hash of their contents**. This provides several properties:

- **Integrity verification** — a document can be verified against its hash at any time to confirm it hasn't been altered.
- **Deduplication** — identical documents are automatically stored only once.
- **Universal referencing** — any module can reference a document by its hash, creating reliable cross-module links.

Documents in the repository are **immutable** once stored. Metadata (tags, classifications) can be added or amended, but the document content itself is permanent. If a corrected version of a document is needed, it is stored as a new document with a new hash.

#### API

Modules interact with the Document Repository through a simple API:

- **Deposit** — upload a file with metadata, receive a document reference (content hash).
- **Retrieve** — request a document by its hash, receive the file.
- **Search** — query documents by metadata (type, date, counterparty, tags).

#### Storage Tiering

The repository will grow substantially over time. A tiering strategy ensures recent documents are on fast storage while older documents migrate to cheaper archival storage. The hash-based reference works identically regardless of physical storage location. Retention policies must comply with jurisdictional requirements (typically six to ten years for financial records).

### 3.2 The Contacts Module

#### Purpose and Rationale

The Contacts module is a lightweight shared service that holds the **identity** of every business entity the organisation trades with. It exists because a single real-world entity — a company like Northern Building Supplies Ltd — may be both a customer and a supplier, and may trade in multiple currencies. Without a shared contact record, the same company's name, registration number, and VAT number would be duplicated across modules, with the inevitable risk of drift and inconsistency.

The Contacts module owns identity data only — who an entity is. It does not own commercial terms, ledger positions, or transactional data. Those belong to the **trading accounts** maintained by the Sales and Customer module and the Purchasing and Supplier module (see Sections 5 and 6).

#### The Three-Layer Model

The platform uses a three-layer model for counterparty data:

1. **Contact** (owned by the Contacts module) — the real-world entity. Company name, registration number, VAT number, primary address, and core identity. A contact exists once regardless of how many trading relationships it has with the business.

2. **Trading Account** (owned by the Sales or Purchasing module) — a specific commercial relationship in a specific currency and direction. Each trading account carries its own payment terms, credit limit, price list, GL mappings, contacts for that relationship, and an independent receivables or payables ledger position. A single contact can have multiple trading accounts — for example, one as a GBP customer, one as a EUR customer, and one as a GBP supplier.

3. **Transactions** (owned by the Sales or Purchasing module) — orders, invoices, and payments, each belonging to a specific trading account.

This structure solves several real-world problems. An entity that is both customer and supplier has one contact record but separate trading accounts with independent ledger positions. Contra-settlement between a customer and supplier position for the same entity is possible but explicit — a deliberate action, not an accidental muddling. An entity that trades in multiple currencies has separate trading accounts per currency, each with its own receivables or payables position, eliminating the complexity of mixed-currency ledger balances.

#### Contact Record Structure

```json
{
  "contact_id": "CONTACT-0087",
  "entity_type": "COMPANY",
  "status": "ACTIVE",
  "company_name": "Northern Building Supplies Ltd",
  "trading_name": "NBS Trade",
  "registration_number": "09876543",
  "vat_number": "GB 234 5678 90",
  "primary_address": {
    "line_1": "Unit 4, Riverside Business Park",
    "line_2": "Bridge Road",
    "city": "Leeds",
    "postcode": "LS1 4AP",
    "country": "GB"
  },
  "website": "https://www.nbs-trade.co.uk",
  "general_email": "info@nbs-trade.co.uk",
  "general_phone": "+44 113 496 0010",
  "notes": "Regional distributor, family-owned since 1985",
  "tags": ["building-supplies", "yorkshire"],
  "created_at": "2024-06-15T09:00:00Z"
}
```

The contact record is deliberately lean. It contains only information that is true of the entity regardless of whether you buy from them, sell to them, or both. Commercial terms, relationship-specific contacts, delivery addresses, GL mappings, and ledger positions all live on the trading accounts in the Sales and Purchasing modules.

Contact records are **version-controlled** like all master data in the platform. Changes to identity information (a company name change, a new VAT number) create a new version, and historical trading accounts and transactions reference the version that was current at the time.

#### Entity Types

Contacts can be typed as `COMPANY`, `INDIVIDUAL`, `GOVERNMENT`, or `OTHER`. This primarily affects validation (an individual won't have a company registration number) and reporting.

#### API

The Contacts module exposes a simple API:

- `POST /api/v1/contacts` — create a new contact.
- `GET /api/v1/contacts/{contact_id}` — retrieve a contact by ID (returns current version by default, or a specific version if requested).
- `PUT /api/v1/contacts/{contact_id}` — update a contact (creates a new version).
- `GET /api/v1/contacts` — search contacts by name, registration number, VAT number, tag, or freeform text.
- `GET /api/v1/contacts/{contact_id}/trading-accounts` — list all trading accounts across all modules for a given contact, providing a unified view of the total relationship with an entity.

The last endpoint is particularly valuable — it allows a user to see that Northern Building Supplies is both a customer (with £15,000 outstanding receivables in GBP) and a supplier (with £3,000 outstanding payables in GBP) in a single view, even though those positions are maintained by different modules.

### 3.3 Module Tiers and Ecosystem

Modules in the ecosystem can be understood in three tiers based on their relationship with the GL.

#### Tier 1 — Core Operational Modules (Post Frequently to the GL)

These modules generate the majority of ledger activity:

- **Contacts Module** — shared service holding the identity of all business entities (see Section 3.2). Referenced by the Sales and Purchasing modules via contact IDs. Does not post to the GL.
- **Sales and Customer Module** — customer trading accounts, sales orders, customer invoicing, credit notes, accounts receivable, payment allocation, and debt management (see Section 5). Posts `CUSTOMER_INVOICE`, `CUSTOMER_CREDIT_NOTE`, `CUSTOMER_PAYMENT`, and `BAD_DEBT_WRITE_OFF` transactions.
- **Purchasing and Supplier Module** — supplier trading accounts, purchase orders, supplier invoice recognition, credit notes, accounts payable, and payment runs (see Section 6). Posts `SUPPLIER_INVOICE`, `SUPPLIER_CREDIT_NOTE`, and `SUPPLIER_PAYMENT` transactions.
- **Product and Stock Module** — product catalogue, stock management, goods receipt, dispatch, transfers, write-offs, and revaluation (see Section 4). Posts `STOCK_RECEIPT`, `STOCK_DISPATCH`, `STOCK_WRITE_OFF`, `STOCK_TRANSFER`, and `STOCK_REVALUATION` transactions.
- **Bank and Cash Management** — bank feeds, reconciliation, and cash handling. Posts `BANK_RECEIPT`, `BANK_PAYMENT`, and `BANK_TRANSFER` transactions.
- **Tax Module** — shared service for tax code resolution, rate calculation, and compliance reporting (e.g., MTD). Consulted by the sales, purchasing, and GL modules during transaction processing.

#### Tier 2 — Reporting and Analysis Modules (Read Primarily from the GL)

These modules consume ledger data and post only occasionally:

- **Financial Reporting and Management Accounts** — trial balances, profit and loss statements, balance sheets, cash flow statements, and management dashboards.
- **Tax and Compliance** — VAT/GST return preparation, Making Tax Digital (MTD) submission, corporate tax computations, and regulatory reporting.
- **Budgeting and Forecasting** — budget entry, variance analysis against actuals from the GL, and forward projections.
- **Audit Tools** — hash chain verification, audit trail review, sampling and substantive testing, and audit working paper generation.

#### Tier 3 — Intelligent Processing Modules (Prepare and Enrich Data Before GL Posting)

These modules sit in front of Tier 1 modules, adding intelligence and automation:

- **AI Invoice Processor** — automated supplier invoice reading, interpretation, matching, and posting (see Section 7).
- **AI Bank Reconciliation** — automated matching of bank feed entries against expected transactions.
- **AI Expense Processing** — receipt scanning, categorisation, policy checking, and posting.
- **Purchase Order Matching** — three-way matching of orders, goods received notes, and invoices.
- **Automated Revenue Recognition** — contract analysis and phased revenue posting under IFRS 15 or similar standards.


## 4. The Product and Stock Module

Product records and stock records are held within a single module because they deal with fundamentally the same thing — the goods a business handles. Product records define **classes** of item (what a thing is), while stock records track **individual instances** of those items (the specific things the business has received, holds, moves, and dispatches). Combining them in one module ensures that the definition and the reality are always consistent and that the link between them is maintained internally rather than across an API boundary.

### 4.1 The Two-Layer Data Model

The fundamental structure is a **product type** (the platonic ideal) and **stock items** (the physical instances). The relationship between them is one-to-many, mediated through an intermediate concept of **SKUs** (stock-keeping units) when variants are involved.

The full hierarchy is:

- **Product Type** — defines a class of item with its fixed attributes, variable attribute template, and business configuration (GL mappings, costing method, tracking model).
- **SKU** — represents a specific combination of variant options within a product type. Each SKU has its own stock code, barcode, and pricing. For product types with no variants, there is a single implicit SKU.
- **Stock Item** — represents either an individual serialised item (with a unique serial number and its own event history) or a quantity of non-serialised items at a specific location.

### 4.2 The Product Type Record

The product type is the master definition of what a product is. It contains three categories of information.

**Fixed attributes** are facts that are true of every instance of this product type — manufacturer, model designation, physical dimensions, weight, commodity codes, and classification. These never vary between individual items.

**Variable attributes** (the attribute template) define characteristics where each individual item or SKU takes one value from a defined set of options. The product type declares the attribute name, its data type, whether it is required, and the permitted values. For example, a product type for a car might declare that `exterior_colour` is a required enumeration with options Red, Blue, Black, Silver, and White. Each stock item must have one of these values and cannot have a value outside the list.

**Business configuration** includes the GL account mappings (which accounts are debited and credited when stock of this type is received, dispatched, written off, or revalued), the costing method (FIFO, weighted average, standard cost, or specific identification), the stock tracking model (serialised, batch-tracked, or simple quantity), and the serial number format if applicable.

Example product type record:

```json
{
  "product_type_id": "PT-FORD-MUST-2005-XYZ",
  "stock_code": "FMUST05XYZ",
  "description": "Ford Mustang 2005 Model XYZ",
  "manufacturer": "Ford Motor Company",
  "category_path": ["VEHICLES", "CARS", "SPORTS"],
  "base_unit": "EACH",
  "fixed_attributes": {
    "model_year": 2005,
    "engine_capacity_cc": 4600,
    "fuel_type": "PETROL",
    "transmission": "AUTOMATIC",
    "doors": 2,
    "weight_kg": 1650,
    "length_mm": 4775,
    "width_mm": 1877
  },
  "variable_attributes": [
    {
      "name": "exterior_colour",
      "type": "ENUM",
      "required": true,
      "options": ["Red", "Blue", "Black", "Silver", "White"]
    },
    {
      "name": "interior_trim",
      "type": "ENUM",
      "required": true,
      "options": ["Black Leather", "Tan Leather", "Grey Cloth"]
    },
    {
      "name": "optional_sunroof",
      "type": "BOOLEAN",
      "required": true
    }
  ],
  "tracking_model": "SERIALISED",
  "serial_number_format": "VIN",
  "costing_method": "SPECIFIC_IDENTIFICATION",
  "default_gl_mappings": {
    "stock_account": "1300-VEHICLE-STOCK",
    "cost_of_sales_account": "5100-VEHICLE-COGS",
    "revenue_account": "4100-VEHICLE-SALES"
  }
}
```

### 4.3 Variants and SKUs

#### The Variant Matrix

When a product type has variable attributes that represent customer selection options, the combinations of those options form a **variant matrix**. Each cell in the matrix is a SKU — a specific, orderable, stockable configuration of the product.

For a "Classic Cotton T-Shirt" with variant axes of size (XS, S, M, L, XL, XXL) and colour (Navy, Red, Black, White, Grey), the matrix produces 30 SKUs. Each SKU has its own stock code, barcode, and potentially its own pricing, but all SKUs share the parent product type's fixed attributes, description, category, supplier information, and GL account mappings.

```json
{
  "product_type_id": "PT-BASIC-TEE-2026",
  "description": "Classic Cotton T-Shirt",
  "variant_axes": [
    {
      "axis_name": "size",
      "type": "ENUM",
      "options": ["XS", "S", "M", "L", "XL", "XXL"],
      "affects_pricing": false,
      "affects_stock_code": true
    },
    {
      "axis_name": "colour",
      "type": "ENUM",
      "options": ["Navy", "Red", "Black", "White", "Grey"],
      "affects_pricing": false,
      "affects_stock_code": true
    }
  ]
}
```

#### Distinguishing Variants from Separate Products

Not every variable attribute should be modelled as a variant. The system provides guidance and guardrails to help businesses make the right modelling decision. Five practical tests help determine whether differences should be expressed as variants within one product type or as separate product types:

1. **Pricing independence** — if two configurations have fundamentally different price points reflecting genuinely different value (not just a small option premium), they are probably separate products. A V6 engine and a V8 engine differ by thousands and target different market segments.

2. **Supply chain independence** — variants typically share a supply chain (same supplier, same purchase orders, same lead times). If two configurations come from different manufacturers with different cost structures, they are probably separate products.

3. **Customer interchangeability** — when a customer asks for one variant and it's unavailable, would you naturally offer another variant as a substitute? If so, they're variants. If the customer would have no interest in the alternative, they're separate products.

4. **Reporting aggregation** — when management asks "how is this product selling?", does it make sense to aggregate the variants? If the business views all sizes and colours of a t-shirt as one product line with one sales story, those are variants. If two configurations have different target markets and sales strategies, they warrant separate products.

5. **The catalogue page test** — would these items appear on the same catalogue page or website listing, with the differences presented as options to select? If yes, they're variants. If they warrant separate listings with their own descriptions and imagery, they're separate products.

#### System Guardrails

The system encourages correct usage through several mechanisms. The number of resulting SKUs is displayed when variant axes are configured, with a soft warning at approximately 50 SKUs and a stronger prompt at 500, since very large matrices usually indicate that the product type is overloaded. If SKUs within the same product type begin diverging significantly in attributes that should be shared (different suppliers, wildly different costs, different GL mappings), the system suggests that separate product types may be more appropriate.

#### Variant Templates

When many product types share the same variant structure (a paint colour range, standard clothing sizes, common packaging options), a **variant template** can be defined once and applied to multiple product types. Updating the template (adding a new colour to the range, for example) propagates the change to all product types that use it, ensuring consistency and reducing setup effort.

### 4.4 Stock Item Records

#### Serialised Items

For products where the tracking model is `SERIALISED`, each physical item gets its own stock item record with a unique serial number. The record carries the item's specific variable attribute values (validated against the product type's attribute template), its current status, location, condition, and its cost.

```json
{
  "stock_item_id": "SI-2026-003871",
  "product_type_id": "PT-FORD-MUST-2005-XYZ",
  "serial_number": "1ZVFT82H455100234",
  "variable_attribute_values": {
    "exterior_colour": "Blue",
    "interior_trim": "Black Leather",
    "optional_sunroof": true
  },
  "current_status": "IN_STOCK",
  "current_location": "LOC-SHOWROOM-NORTH",
  "current_condition": "NEW",
  "cost_price": 28500.00,
  "cost_currency": "GBP",
  "cost_breakdown": {
    "method": "SPECIFIC_IDENTIFICATION",
    "purchase_order": "PO-2026-0234",
    "landed_cost_elements": [
      {"type": "PURCHASE_PRICE", "amount": 26000.00},
      {"type": "SHIPPING", "amount": 1800.00},
      {"type": "IMPORT_DUTY", "amount": 700.00}
    ]
  }
}
```

#### Batch-Tracked Items

For products like pharmaceuticals, food, or chemicals, individual items are not tracked but **batches** are. Each batch has a batch number, manufacturing date, expiry date, and quantity. This enables traceability (which batch did a customer receive?) without the overhead of individual serial tracking.

#### Non-Serialised (Quantity-Tracked) Items

For commodity items (bolts, paper, cleaning supplies), stock is tracked as a **quantity at a location per SKU**. The stock record for "M8 stainless steel bolt, box of 100" at the main warehouse simply holds a count. Events increase or decrease this count.

The product type's `tracking_model` field declares which model applies: `SERIALISED`, `BATCH`, or `QUANTITY`.

### 4.5 The Stock Item Event History

Each stock item (or quantity pool, for non-serialised items) maintains an **immutable event history** — an append-only log of every event that has affected it. The current state of a stock item is derived from its history. This echoes the GL's immutability philosophy and ensures complete traceability.

Events include:

- `GOODS_RECEIVED` — item entered the business's possession. References: purchase order, goods received note, GL transaction ID.
- `INTERNAL_TRANSFER` — item moved between locations within the business. May or may not have a GL impact depending on whether locations cross legal entity boundaries.
- `RESERVED` — item earmarked for a customer order. No GL impact; the item is still physically in stock but no longer available to promise.
- `RESERVATION_RELEASED` — a previous reservation cancelled.
- `DISPATCHED` — item shipped to a customer. References: sales order, dispatch note, GL transaction ID (for cost of goods sold posting).
- `RETURNED` — item received back from a customer. References: return authorisation, GL transaction ID.
- `WRITTEN_OFF` — item removed from stock (damaged, lost, obsolete). References: write-off authorisation, GL transaction ID.
- `STOCK_COUNT_ADJUSTMENT` — quantity corrected following a physical count. References: count reference, GL transaction ID.
- `REVALUATION` — carrying value adjusted. References: revaluation reason, GL transaction ID.
- `CONDITION_CHANGE` — item's condition updated (e.g., NEW to USED or DAMAGED).

Example event history for a serialised item:

```json
{
  "stock_item_id": "SI-2026-003871",
  "history": [
    {
      "event_id": "EVT-001",
      "timestamp": "2026-02-15T09:30:00Z",
      "event_type": "GOODS_RECEIVED",
      "location": "LOC-WAREHOUSE-MAIN",
      "purchase_order": "PO-2026-0234",
      "grn_reference": "GRN-2026-0142",
      "condition": "NEW",
      "cost_at_event": 28500.00,
      "gl_transaction_id": "TXN-20260215-00234",
      "performed_by": "warehouse-module"
    },
    {
      "event_id": "EVT-002",
      "timestamp": "2026-02-16T14:00:00Z",
      "event_type": "INTERNAL_TRANSFER",
      "from_location": "LOC-WAREHOUSE-MAIN",
      "to_location": "LOC-SHOWROOM-NORTH",
      "gl_transaction_id": null,
      "performed_by": "logistics-module"
    },
    {
      "event_id": "EVT-003",
      "timestamp": "2026-03-02T11:15:00Z",
      "event_type": "RESERVED",
      "sales_order": "SO-2026-0891",
      "trading_account_id": "TA-CUST-0445-GBP",
      "reserved_until": "2026-03-09T23:59:59Z",
      "performed_by": "sales-module"
    }
  ]
}
```

Events that have a financial impact carry the GL transaction ID, creating a bidirectional cross-reference between the stock module and the general ledger.

### 4.6 Stock Costing

The costing method declared on the product type determines how the cost of goods sold is calculated when stock is dispatched.

- **Specific identification** — used for serialised, high-value items. The exact cost of the individual item (including landed costs) is used. This is the natural choice for vehicles, expensive equipment, and similar goods.
- **FIFO (first in, first out)** — assumes the oldest stock is sold first. The cost of the earliest unreleased receipt is used for the next dispatch.
- **Weighted average** — recalculates the average unit cost each time new stock is received. All dispatches use the current average cost.
- **Standard costing** — uses a predetermined cost per unit. Differences between the standard cost and actual purchase cost are posted as purchase price variances.

The stock module calculates the appropriate cost at dispatch time and includes the figure in the `STOCK_DISPATCH` transaction submitted to the GL. The costing methodology and calculation details are recorded in the event history for audit transparency.

### 4.7 Stock Availability

One of the most operationally critical functions is the **available-to-promise (ATP)** calculation: how many units of a given SKU can be committed to new customer orders right now?

ATP is calculated as: physical quantity on hand, minus quantity reserved for existing orders, plus quantity on order from suppliers that has not yet arrived. This calculation must be fast and accurate because sales teams and e-commerce systems query it constantly.

The module maintains a **materialised availability summary** that is updated on every stock event, rather than recalculating from the full event history on each query. This summary is an internal optimisation — the event history remains the source of truth, and the summary can be rebuilt from it at any time.

### 4.8 GL Integration

The product and stock module posts transactions to the GL for all events with a financial impact. The product type's GL account mappings determine which accounts are used:

- **Stock receipt** — debit Stock (balance sheet), credit Goods Received Not Invoiced or Trade Creditors.
- **Stock dispatch (sale)** — debit Cost of Goods Sold (P&L), credit Stock (balance sheet). The revenue side is posted separately by the invoicing module.
- **Stock write-off** — debit Write-Off Expense (P&L), credit Stock (balance sheet).
- **Stock revaluation** — debit or credit Stock (balance sheet), with the contra entry to a revaluation reserve or P&L account depending on the accounting policy.

The GL does not need to understand variants or SKUs. It receives well-formed transactions with amounts and account codes. The intelligence of determining which accounts to use and what cost to apply lives entirely in the stock module.

### 4.9 API Surfaces

The module exposes two distinct API surfaces for different consumers:

**The Product Catalogue API** handles product type management — creating, updating, and querying product types; managing variant axes, variant templates, and SKUs; browsing category hierarchies; and searching product information. This is relatively slow-moving data used by product managers, procurement teams, and catalogue interfaces.

**The Stock Operations API** handles the fast-moving reality of physical goods — goods receipt, dispatch, reservation, transfer, stock count adjustments, availability queries, and event history retrieval. This API is used by warehouse systems, sales modules, e-commerce platforms, and logistics operations.

Both APIs are part of the same module because product definitions and stock records are deeply intertwined, but the separation of API surfaces reflects the different audiences and usage patterns.


## 5. The Sales and Customer Module

Customer records, sales orders, customer invoicing, and accounts receivable are combined into a single module because they represent one continuous commercial workflow. In a small retail or distribution business, the process of managing a customer, taking their order, fulfilling it, invoicing them, and collecting payment is a single unbroken flow — not four separate activities. Splitting them into separate modules would create artificial boundaries, requiring constant cross-module API calls for what users experience as a single process.

By combining them, the customer record, order history, invoices, credit notes, and payment status all live in the same data model. Credit checks at order time are local queries. Generating an invoice from a dispatched order is an internal operation. Allocating a payment and tracing it back through the invoice to the original order is straightforward. The only external touchpoints are the Product and Stock module (for physical goods) and the GL (for financial recording).

### 5.1 Customer Trading Accounts

#### The Trading Account as the Operational Unit

The Sales and Customer module does not own the identity of a customer — that lives in the shared Contacts module (see Section 3.2). What this module owns is the **customer trading account**: a specific commercial selling relationship, in a specific currency, with a specific contact.

A single contact can have multiple customer trading accounts. Northern Building Supplies might have a GBP trading account for their UK purchases and a EUR trading account for goods they buy for their Irish operation. Each trading account has its own independent receivables ledger, credit limit, payment terms, and GL mappings. This is essential because receivables in different currencies must be tracked, aged, and reconciled independently — a GBP payment cannot settle a EUR invoice without creating a foreign exchange transaction.

#### Customer Trading Account Structure

```json
{
  "trading_account_id": "TA-CUST-0445-GBP",
  "contact_id": "CONTACT-0087",
  "contact_version": 5,
  "direction": "CUSTOMER",
  "currency": "GBP",
  "status": "ACTIVE",
  "customer_type": "TRADE",
  "commercial_terms": {
    "payment_terms": "NET_30",
    "credit_limit": 25000.00,
    "price_list": "TRADE_STANDARD",
    "discount_percentage": 10.0,
    "tax_treatment": "STANDARD_RATED"
  },
  "contacts": [
    {
      "name": "Sarah Mitchell",
      "role": "Purchasing Manager",
      "email": "sarah.mitchell@nbs-trade.co.uk",
      "phone": "+44 113 496 0012",
      "primary": true
    },
    {
      "name": "Tom Hargreaves",
      "role": "Accounts Payable",
      "email": "accounts@nbs-trade.co.uk",
      "phone": "+44 113 496 0015"
    }
  ],
  "addresses": [
    {
      "type": "BILLING",
      "line_1": "Unit 4, Riverside Business Park",
      "line_2": "Bridge Road",
      "city": "Leeds",
      "postcode": "LS1 4AP",
      "country": "GB"
    },
    {
      "type": "DELIVERY",
      "label": "Main Warehouse",
      "line_1": "Plot 7, Kirkstall Industrial Estate",
      "city": "Leeds",
      "postcode": "LS5 3BT",
      "country": "GB",
      "delivery_instructions": "Gate code 4821. Fork lift available."
    },
    {
      "type": "DELIVERY",
      "label": "Bradford Branch",
      "line_1": "18 Canal Road",
      "city": "Bradford",
      "postcode": "BD1 4SJ",
      "country": "GB",
      "delivery_instructions": "Rear entrance only, max 7.5t vehicle."
    }
  ],
  "classification": {
    "segment": "TRADE_DISTRIBUTOR",
    "region": "NORTH",
    "account_manager": "james.thornton@ourcompany.com",
    "tags": ["building-supplies", "key-account", "leeds"]
  },
  "gl_mappings": {
    "debtors_account": "1100-TRADE_DEBTORS",
    "revenue_account": "4000-SALES_TRADE"
  },
  "created_at": "2024-06-15T09:00:00Z",
  "created_by": "sales-module"
}
```

Key aspects of this structure:

**The contact_id** links to the shared Contact record in the Contacts module, which holds the company name, registration number, VAT number, and other identity data. The trading account does not duplicate this information. The **contact_version** records which version of the contact was current when the trading account was last updated, supporting the audit trail.

**Currency** is fixed per trading account. All orders, invoices, and payments on this account are in GBP. The receivables ledger for this account is maintained in GBP. If the same contact also buys in EUR, that is a separate trading account with its own ledger position, credit limit, and potentially different payment terms.

**Relationship-specific contacts and addresses** live on the trading account, not the contact. The people you deal with for this commercial relationship (their purchasing manager, their accounts payable team) may be different from the people you deal with on the supplier side. Delivery addresses are likewise specific to the selling relationship.

**Commercial terms, classification, and GL mappings** are all per-trading-account. Different trading accounts for the same contact can have different payment terms, price lists, and revenue account mappings.

#### Trading Account Statuses

A trading account moves through statuses independently of other trading accounts for the same contact:

- **PROSPECT** — created but not yet trading. No orders can be placed.
- **ACTIVE** — approved for trading. Orders can be placed and fulfilled.
- **ON_HOLD** — temporarily suspended (overdue payments, dispute). The module can automatically trigger this when the account exceeds its credit limit or has significantly overdue invoices. Importantly, placing a GBP customer account on hold does not affect a EUR customer account or a supplier account for the same contact.
- **CLOSED** — relationship ended. No new orders. Historical records preserved.

Status changes are logged with timestamps and reasons.

#### Version Control

Trading accounts are **version-controlled** like all master data. Changes to commercial terms, addresses, or GL mappings create a new version. Historical orders, invoices, and transactions reference the trading account version that was current when they were created, ensuring complete traceability.

### 5.2 Sales Orders

A sales order represents a customer's commitment to buy. It is the central operational record that drives fulfilment. Its lifecycle is:

- **DRAFT** — being prepared (e.g., a quote being converted to an order).
- **CONFIRMED** — accepted by the business. Stock is reserved via the Product and Stock module's reservation mechanism.
- **CREDIT_CHECK_HOLD** — the order would push the trading account over its credit limit. Held pending approval or payment. Because the account's outstanding invoices and the credit limit are both held within this module, the credit check is an internal operation.
- **ALLOCATED** — stock has been reserved for all lines. Ready for picking and dispatch.
- **PARTIALLY_DISPATCHED** — some lines shipped, others pending.
- **FULLY_DISPATCHED** — all lines shipped.
- **INVOICED** — invoice(s) generated and posted to the GL.
- **CLOSED** — dispatched, invoiced, and payment received. Fully settled.

Each sales order references a trading account (by trading account ID and version), contains one or more order lines (each referencing a product type or SKU, a quantity, a price, and optionally a specific delivery address), and accumulates references to related records as the order progresses — stock reservations, dispatch notes, invoice numbers, and GL transaction IDs.

```json
{
  "sales_order_id": "SO-2026-0891",
  "trading_account_id": "TA-CUST-0445-GBP",
  "trading_account_version": 3,
  "contact_id": "CONTACT-0087",
  "status": "CONFIRMED",
  "order_date": "2026-03-02",
  "requested_delivery_date": "2026-03-06",
  "currency": "GBP",
  "lines": [
    {
      "line_number": 1,
      "sku": "FMUST05XYZ-BLUE-BLKLTH-SUN",
      "product_type_id": "PT-FORD-MUST-2005-XYZ",
      "description": "Ford Mustang 2005 XYZ — Blue, Black Leather, Sunroof",
      "quantity": 1,
      "unit_price": 38500.00,
      "tax_code": "STANDARD_VAT",
      "tax_amount": 7700.00,
      "line_total": 46200.00,
      "delivery_address": "Main Warehouse",
      "stock_reservation_id": "RES-2026-00234"
    }
  ],
  "order_total_net": 38500.00,
  "order_total_tax": 7700.00,
  "order_total_gross": 46200.00,
  "related_references": {
    "dispatch_notes": [],
    "invoices": [],
    "gl_transactions": []
  },
  "source_channel": "TRADE_PORTAL",
  "created_by": "order-entry-user"
}
```

### 5.3 Customer Invoicing

When a sales order is dispatched (fully or partially), the module generates a customer invoice. Because the order, the trading account, and the invoicing function are all within the same module, invoice generation is a seamless internal process — the billing address, payment terms, and GL mappings are available directly from the trading account, while the company name and VAT number are retrieved from the linked contact record in the Contacts module.

The invoice record captures:

- **Invoice header** — invoice number, date, due date (calculated from the customer's payment terms), customer details (snapshotted from the versioned customer record), and currency.
- **Invoice lines** — derived from the dispatched order lines, including product descriptions, quantities, unit prices, tax calculations (resolved via the Tax module), and line totals.
- **Tax summary** — the total tax broken down by tax code and rate, ready for VAT return reporting.
- **Related references** — the sales order(s), dispatch note(s), and the resulting GL transaction ID.

Upon generating the invoice, the module posts a `CUSTOMER_INVOICE` transaction to the GL. The GL translates this into the appropriate double-entry postings — typically debiting Trade Debtors and crediting Sales Revenue and VAT Output. The GL returns a transaction ID, which is recorded against the invoice.

Credit notes follow the same pattern in reverse — generated against an original invoice, posted to the GL as `CUSTOMER_CREDIT_NOTE`, producing mirror-image postings.

### 5.4 Accounts Receivable

The accounts receivable function tracks what customers owe, manages the collection process, and records payments.

**The receivables ledger** is maintained internally as a list of outstanding invoices and credit notes per trading account, each with its original amount, amount paid to date, remaining balance, due date, and ageing status (current, 30 days overdue, 60 days, 90 days, etc.). Because each trading account operates in a single currency, the receivables ledger for that account is currency-pure — there is no mixing of GBP and EUR invoices on the same ledger. Because invoices are generated within the same module, the receivables ledger is updated automatically — there is no synchronisation lag between invoicing and receivables.

**Payment allocation** occurs when the Bank and Cash module identifies a customer receipt and passes it to the Sales and Customer module. The module matches the payment against outstanding invoices — either automatically (if the payment amount matches an invoice exactly or the customer's remittance reference is clear) or by presenting unmatched payments for manual allocation. When a payment is allocated, the module posts a `CUSTOMER_PAYMENT` transaction to the GL.

**Credit control** is handled internally. The module can generate aged debtors reports, customer statements, and overdue payment alerts. Because it holds the complete picture — the trading account, all orders, all invoices, all payments — it can make intelligent decisions about credit management. If a trading account's oldest unpaid invoice is more than a configurable number of days overdue, the module can automatically place the account ON_HOLD, preventing new orders on that account until the situation is resolved. Other trading accounts for the same contact (a EUR account, or their supplier account) are unaffected.

**Bad debt write-off** is the final stage. If an invoice is deemed uncollectable, the module posts a `BAD_DEBT_WRITE_OFF` transaction to the GL, removing the amount from Trade Debtors and charging it to a bad debt expense account.

### 5.5 The Fulfilment-to-Cash Flow

With all four functions combined, the complete flow from order to cash has only two external touchpoints — the Product and Stock module for physical goods and the GL for financial recording:

1. **Order received** — the module creates the sales order against the appropriate trading account and checks the account's credit limit internally.
2. **Stock reserved** — the module requests reservation from the Product and Stock module and records reservation IDs on the order lines.
3. **Dispatch triggered** — the module instructs the Product and Stock module to dispatch the reserved items. The stock module records the `DISPATCHED` event, calculates cost of goods sold, and posts `STOCK_DISPATCH` to the GL.
4. **Invoice generated** — the module creates the invoice internally, calculates tax (via the Tax module), and posts `CUSTOMER_INVOICE` to the GL.
5. **Payment received** — the Bank module identifies a customer receipt and passes it to this module. The module allocates the payment against the invoice and posts `CUSTOMER_PAYMENT` to the GL.
6. **Order closed** — the module marks the order as fully settled.

At no point does this module need to query another module to understand its own customer's position. The credit check, invoice generation, receivables tracking, and payment allocation are all local operations.

### 5.6 API Surface

The module exposes several API areas:

**Customer Trading Account API** — create, update (version), query, and search customer trading accounts. External modules call this to retrieve trading account details by ID (e.g., the Product and Stock module fetching a delivery address for dispatch, or the Bank module looking up a trading account to match a payment). Supports querying by contact ID to find all customer trading accounts for a given entity.

**Sales Order API** — create, confirm, allocate, dispatch, and close sales orders. E-commerce integrations feed orders in through this API. The Product and Stock module calls back to confirm dispatch.

**Invoice API** — query invoices, generate credit notes, and retrieve invoice documents. The Document Repository stores the rendered invoice PDFs; this API provides the financial data.

**Receivables API** — query outstanding balances, aged debt positions, and payment history for a trading account. The Bank module calls this to help match incoming payments. Reporting modules call this for management information. Supports aggregation across multiple trading accounts for the same contact to provide total exposure views.

**Payment Allocation API** — submit a customer payment for allocation against invoices. The Bank module is the primary caller.


## 6. The Purchasing and Supplier Module

Symmetrically to the Sales and Customer module, the Purchasing and Supplier module combines supplier records, purchase orders, supplier invoice recognition, and accounts payable into a single module. The reasoning is identical — the process of managing a supplier, placing orders, receiving invoices, and making payments is one continuous workflow.

### 6.1 Supplier Trading Accounts

Like the Sales and Customer module, this module does not own supplier identity — that lives in the shared Contacts module (see Section 3.2). This module owns **supplier trading accounts**: specific commercial buying relationships, each in a specific currency, with a specific contact.

The same three-layer model applies. A single contact can have both customer trading accounts (in the Sales module) and supplier trading accounts (in this module). A supplier who invoices in both GBP and EUR has two supplier trading accounts, each with its own independent payables ledger.

```json
{
  "trading_account_id": "TA-SUPP-0234-GBP",
  "contact_id": "CONTACT-0112",
  "contact_version": 3,
  "direction": "SUPPLIER",
  "currency": "GBP",
  "status": "ACTIVE",
  "commercial_terms": {
    "payment_terms": "NET_45",
    "default_expense_category": "RAW_MATERIALS",
    "typical_lead_time_days": 5,
    "minimum_order_value": 500.00
  },
  "contacts": [
    {
      "name": "David Chen",
      "role": "Sales Director",
      "email": "d.chen@sheffieldsteel.co.uk",
      "phone": "+44 114 278 0033",
      "primary": true
    }
  ],
  "addresses": [
    {
      "type": "ORDERING",
      "line_1": "Attercliffe Works",
      "line_2": "Newhall Road",
      "city": "Sheffield",
      "postcode": "S9 2QR",
      "country": "GB"
    }
  ],
  "gl_mappings": {
    "creditors_account": "2100-TRADE_CREDITORS",
    "default_expense_account": "5000-PURCHASES_RAW_MATERIALS"
  },
  "created_at": "2024-03-20T11:30:00Z",
  "created_by": "procurement-user"
}
```

Supplier trading accounts are version-controlled in the same way as customer trading accounts, ensuring that historical purchase orders and invoices always reference the account details that were current at the time. The payables ledger for each account operates in its declared currency, keeping currency positions clean.

### 6.2 Purchase Orders

A purchase order represents the business's intent to buy goods or services from a supplier. It flows through a defined lifecycle:

- **DRAFT** — being prepared, not yet committed.
- **AWAITING_APPROVAL** — submitted for internal approval (if the business requires it above certain thresholds).
- **APPROVED** — approved and ready to send.
- **SENT** — transmitted to the supplier.
- **PARTIALLY_RECEIVED** — some line items have been received into stock.
- **FULLY_RECEIVED** — all line items received. The PO is complete from a goods perspective.
- **CLOSED** — all goods received and all related supplier invoices matched and posted. The PO is fully settled.

When goods arrive against a purchase order, this module coordinates with the Product and Stock module to record the goods receipt. The stock module creates the stock event (`GOODS_RECEIVED`) and posts the `STOCK_RECEIPT` transaction to the GL.

Purchase orders carry references that link forward to goods received notes, supplier invoices, and GL transactions — forming part of the cross-module reference web described in Section 8.

### 6.3 Supplier Invoice Recognition and Accounts Payable

When a supplier invoice arrives (manually entered, or passed from the AI Invoice Processor), the module matches it against purchase orders and goods received notes — the three-way match. Because purchase orders live within the same module, this matching is a local operation.

The module recognises the invoice by recording it against the appropriate supplier trading account and posting a `SUPPLIER_INVOICE` transaction to the GL. It then tracks the payable — the amount owed, the due date (calculated from the supplier's payment terms), and the ageing.

When it's time to pay, the module prepares a payment run — selecting invoices that are due, grouping by supplier, and generating payment instructions. Upon confirmation that payment has been made (via the Bank module), it posts `SUPPLIER_PAYMENT` to the GL and closes out the payable.

Credit notes from suppliers are handled as `SUPPLIER_CREDIT_NOTE` postings, reducing the amount owed.

### 6.4 API Surface

**Supplier Trading Account API** — create, update (version), query, and search supplier trading accounts. External modules call this to retrieve account details. Supports querying by contact ID to find all supplier trading accounts for a given entity.

**Purchase Order API** — create, approve, send, receive against, and close purchase orders. The Product and Stock module calls this to link goods receipts back to POs.

**Payables API** — submit supplier invoices, query outstanding balances, prepare payment runs. The AI Invoice Processor submits invoices through this API. The Bank module confirms payments through it.

**Payment Run API** — prepare, review, approve, and execute supplier payment runs.


## 7. AI-Powered Invoice Processing — A Worked Example

The AI Invoice Processor illustrates how an intelligent module interacts with the GL and other modules. It demonstrates the full pattern that any module developer — internal or third-party — would follow.

### 7.1 The Processing Flow

**Stage 1 — Document Ingestion:**
A supplier invoice arrives (via email, upload portal, or e-invoicing network). The AI module deposits the original document in the Document Repository and receives a document reference hash.

**Stage 2 — Extraction and Interpretation:**
The AI module reads the document using OCR (for scanned PDFs) or data parsing (for structured electronic formats). It extracts the supplier name, invoice number, date, line items, quantities, unit prices, tax amounts, and totals. It matches the supplier against master data and categorises each line item. It reviews historical invoices from the same supplier to learn patterns.

**Stage 3 — Validation and Matching:**
The module checks whether the invoice matches an approved purchase order and a goods received note (three-way matching). Based on the quality of the match, it assigns a confidence level:

- **High confidence** — full three-way match, known supplier, expected amounts.
- **Medium confidence** — known supplier, reasonable amounts, but no purchase order or partial match.
- **Low confidence** — unknown supplier, unexpected amounts, or significant discrepancies.

**Stage 4 — Submission to the GL:**
The module submits a transaction via the GL API. The submission includes the transaction data, the document reference from the repository, references to matched documents (purchase orders, goods received notes), the AI confidence score, and the module's own processing reference.

```json
{
  "type": "SUPPLIER_INVOICE",
  "reference": "SINV-2026-03-001",
  "date": "2026-03-02",
  "supplier_invoice_ref": "SUP-INV-44821",
  "counterparty": {
    "trading_account_id": "TA-SUPP-0234-GBP",
    "contact_id": "CONTACT-0112"
  },
  "currency": "GBP",
  "lines": [
    {
      "description": "Raw steel plate 2mm x 500",
      "category": "RAW_MATERIALS",
      "net_amount": 2500.00,
      "tax_code": "STANDARD_VAT",
      "tax_amount": 500.00,
      "cost_centre": "PRODUCTION",
      "purchase_order": "PO-2026-0089",
      "grn_reference": "GRN-2026-0142"
    }
  ],
  "ai_confidence": 0.97,
  "matched_documents": ["PO-2026-0089", "GRN-2026-0142"],
  "source_module": "ai-invoice-processor",
  "source_reference": "AIP-2026-03-00441",
  "source_document_hash": "f8a21c4e...b332"
}
```

**Stage 5 — GL Response:**
The GL validates the submission, evaluates its approval rules, and either posts it immediately (returning a `POSTED` status with transaction ID and generated postings) or holds it for approval (returning an `AWAITING_APPROVAL` status with details of the required approval). The AI module records the GL's response against its own processing record, completing the audit trail.

### 7.2 The Confidence and Approval Model

The AI module's confidence score is submitted as metadata but the **GL's approval rules** make the final determination about whether human approval is required. This separation is important: the AI module is honest about its confidence, but the GL applies the business's own risk appetite.

A small business might auto-approve any matched invoice under £5,000. A larger or more regulated organisation might require human approval for everything above £500 or from new suppliers. These thresholds are GL configuration, not AI module configuration.

### 7.3 Verification and the AI's Work

The GL module does **not** open, read, or interpret supporting documents. It never checks whether the AI's extraction was accurate. This is a deliberate design choice — the GL's role is financial recording and control, not document interpretation.

Verification of AI accuracy happens at three levels:

1. **Self-checking within the AI module** — the module validates its own extraction (e.g., do line items sum to the invoice total?).
2. **Human review in the GL approval queue** — when a transaction is held for approval, the approver can view the source document alongside the submitted figures.
3. **Independent audit modules** — separate modules can periodically sample posted transactions, retrieve source documents, and run independent checks.


## 8. Cross-Module References — The Relationship Web

No single module stores all the information about a business event. Instead, each module is authoritative for its own domain and references records in other modules by stable identifiers.

For a typical supplier invoice, the complete picture involves:

- The **Document Repository** holds the original PDF.
- The **AI Invoice Processor** holds its extraction and matching analysis, referencing the document hash and the resulting GL transaction ID.
- The **Purchasing and Supplier module** holds the purchase order, the recognised invoice, and the payment status — all within the same module, linked by internal references.
- The **Product and Stock module** holds the goods received note, referenced by its GRN number.
- The **General Ledger** holds the financial posting, referencing the document hash, PO number, and GRN number as metadata.

A reporting or audit tool assembles the complete picture by following the chain of references across modules, querying each module's API. This keeps each module focused and independent while enabling rich, cross-functional views of business activity.


## 9. API Design Principles

The APIs that connect modules are the backbone of the platform. Key principles include:

- **Versioning from day one** — APIs must be versioned so that changes to one module don't break others. Older versions should be supported for a defined period to give third-party developers time to migrate.
- **Authentication and authorisation** — each module has a cryptographic identity. The GL knows which modules are authorised to post which transaction types. Third-party modules must be registered and approved.
- **Digital signatures** — modules sign their transaction submissions with their private key. The GL verifies signatures before accepting postings. This provides non-repudiation: a module cannot deny having submitted a transaction.
- **Clear error responses** — when a submission is rejected, the API returns specific, actionable error codes so that modules can diagnose and correct issues programmatically.
- **Webhooks and notifications** — modules can subscribe to events (e.g., "notify me when transaction TXN-123 is approved") to avoid polling.


## 10. The Web Interface Layer

### 10.1 Architecture

Each module's web interface is a **client of the module's own API**, not a privileged back door to the database. The frontend is built as a single-page application (SPA) that runs in the browser and communicates with the backend exclusively through the published REST API. This means that everything the web interface can do, a third-party integration can also do — the API remains the single point of access.

The recommended technology stack is:

- **Frontend framework**: React or Vue with TypeScript for type safety and maintainability.
- **State management**: A lightweight store (e.g., Zustand, Pinia) for client-side state, with server state managed through a query/cache layer (e.g., TanStack Query) that keeps the UI in sync with the API without manual refresh cycles.
- **Serving**: The SPA is compiled to static assets (HTML, JS, CSS) and served from a web server or CDN. The same server (or a reverse proxy) routes API calls to the module backend.
- **Authentication**: A shared authentication layer (OAuth 2.0 / OpenID Connect) that spans all modules, so users log in once and move between module frontends without re-authenticating.

### 10.2 The Unified Navigation Shell

Although each module serves its own frontend, users experience the platform as a single application. A shared **navigation shell** provides a consistent sidebar or top bar across all modules — GL, Sales, Purchasing, Stock, Contacts — so that switching between modules feels like navigating within one application, not jumping between separate systems.

This can be implemented as a lightweight shell application that loads each module's frontend as a child route, or as a micro-frontend architecture where each module registers its navigation entries and UI components with a central shell. The simpler approach (shared shell with client-side routing) is recommended initially, with the option to move to micro-frontends as the module ecosystem grows and third-party developers need to plug in their own interfaces.

The shell provides:

- Module navigation (sidebar or top bar with icons and labels for each installed module).
- A global search bar that delegates queries to each module's search API and presents unified results.
- User identity, role, and permissions display.
- Notification area for webhook-driven alerts (approval requests, period status changes, etc.).
- A consistent header showing the current tenant, the current accounting period and its status, and the logged-in user's role.

### 10.3 GL Module — Key Screens

The GL module's web interface is organised around the daily workflow of accounts staff. The design principle is **task-oriented** — screens are built around what people need to do, not around the underlying data model.

#### The Dashboard

The landing page after login. This is a working surface, not a decorative display. It shows:

- The **current period** and its status (OPEN, SOFT CLOSE, or HARD CLOSE) prominently at the top.
- **Approval queue summary** — the count and total value of transactions waiting in the staging area, with a direct link to the approval screen.
- **Trial balance headline** — total assets, total liabilities, total equity, and a clear confirmation that the trial balance is in balance (or a warning if it is not).
- **Recent activity** — the last 10–20 committed transactions across all types, showing reference, date, type, counterparty, and amount.
- **Period checklist** (during soft close) — which sub-ledger reconciliations have been confirmed, whether the staging area is clear, and whether the period is ready for hard close.

#### The General Journal

A filterable, searchable, paginated list of all committed transactions. Filters include date range, transaction type, source module, account, counterparty (trading account or contact), amount range, and free-text search across references and descriptions.

Each row shows the transaction reference, date, type, description, counterparty name, and total amount. Clicking a row expands the full double-entry detail — every debit and credit line with the account code, account name, amount, cost centre, department, and dimensions. The expanded view also shows the source module and reference, the correlation ID (linking related transactions), the approval history (who approved, when, any notes), and links to supporting documents in the document repository.

#### The Account Ledger

Accountants think in two complementary views: the journal ("what happened today?") and the ledger ("what happened in this account?"). The account ledger shows all transactions hitting a specific account within a date range, with a running balance. The user navigates here either from the chart of accounts or by clicking an account code anywhere in the journal view.

#### The Approval Queue

The primary working screen for reviewing pending transactions. Each item in the queue shows:

- The submitting module and its reference.
- The transaction type and description.
- The full posting detail (all debit/credit lines).
- The confidence score, if the transaction originated from an AI process.
- Links to supporting documents (supplier invoice PDF, purchase order, etc.).
- The applicable approval rule and why this transaction requires manual review.

Actions available: **approve**, **reject** (with mandatory reason), or **modify and approve** (edit the posting lines before committing). For bulk operations — such as a batch of AI-processed supplier invoices — a batch review screen allows rapid scanning with the ability to approve all, reject all, or pull individual items out for closer inspection.

#### Chart of Accounts

A tree view of all accounts organised by category — assets, liabilities, equity, revenue, expenses — with expandable subcategories. Each account shows its code, name, current-period balance, and year-to-date balance. Clicking an account opens its ledger view.

This screen also serves as the chart management interface: adding new accounts, deactivating old ones, editing account names and categories, and configuring the default account mappings used by each transaction type.

#### Period Management

A timeline or table view of all accounting periods — closed historical periods, the current open period, and future defined periods. For each period:

- **Closed periods** show the final trial balance, the closing checkpoint hash, the date closed, and the authorising user. The trial balance for any closed period is flagged as "closed — authoritative."
- **The current period** shows the live trial balance (flagged as "open — provisional"), the period status, and the closing readiness checklist. The soft close and hard close actions are initiated from this screen, with the validation checks (Section 2.7) running visibly so the user can see what is passing and what still needs attention.
- **Future periods** show the defined date ranges and allow period structure configuration.

#### Trial Balance and Financial Statements

The trial balance is the report accountants check most frequently. It shows every account with a non-zero balance, with debit and credit columns that must agree in total. Comparison columns can be toggled: prior period, same period last year, and budget (if configured). The trial balance is available for any period — closed or open — and clearly indicates whether the figures are authoritative or provisional.

From the trial balance, the interface provides access to the three core financial statements:

- **Profit and Loss** (income statement) — revenue less expenses for the period, with configurable grouping and subtotals.
- **Balance Sheet** — assets, liabilities, and equity at the period end.
- **Cash Flow Statement** — derived from the transaction data using either the direct or indirect method.

All reports are viewable on screen, exportable to PDF, and exportable to Excel (XLSX) for further analysis.

#### The Audit Trail Viewer

A differentiator enabled by the immutable chain architecture. This screen allows auditors and senior finance staff to:

- Browse the hash chain for any period — viewing each transaction's hash, its predecessor hash, and the chain integrity status.
- Verify individual transactions against the Merkle tree, with the proof path displayed.
- View the checkpoint history for closed periods.
- Run a full chain verification that confirms the entire ledger is unbroken and untampered.

This interface is deliberately plain and evidence-focused — it exists to provide proof of integrity, not to look impressive.

#### Search

A global search accessible from any screen (via the navigation shell's search bar or a keyboard shortcut). Searches across transaction references, descriptions, amounts (exact or range), account names and codes, counterparty names, and document references. Results are grouped by type (transactions, accounts, contacts) and link directly to the relevant detail view.

### 10.4 UI Design Principles

**Information density.** Accounting interfaces should be denser than typical consumer applications. Accounts staff work with numbers all day and want to see substantial data on screen without excessive scrolling or clicking through pages. Clean tables with good vertical alignment, sufficient rows visible without pagination where possible, and minimal decorative whitespace.

**Numeric formatting.** All monetary amounts use monospaced numerals that align on the decimal point. Debit and credit are shown in separate columns rather than using positive/negative signs — this is how accountants think and how they will spot errors. Thousands separators and currency symbols are applied consistently.

**Keyboard navigation.** The interface must be fully keyboard-navigable. Accountants processing dozens of journals or approvals per day will not tolerate clicking through modal dialogs for every action. Tab order should follow the natural workflow, common actions should have keyboard shortcuts, and the approval queue in particular should support rapid keyboard-driven review (e.g., "A" to approve, "R" to reject, arrow keys to move between items).

**Professional tone.** The interface should feel precise and trustworthy. This is software that a finance director will present to auditors and that a bookkeeper will use for eight hours a day. Restrained colour use — colour should convey meaning (red for imbalances or rejections, amber for pending items, green for balanced/approved) rather than decoration. No unnecessary animation or playful design elements.

**Responsive but desktop-first.** The primary use case is a desktop browser on a standard or wide monitor. The interface should take advantage of screen width for side-by-side views (e.g., journal entry detail alongside the supporting document). Tablet responsiveness is a secondary concern; mobile is not a priority for core accounting functions.


## 11. MCP Server and AI Agent Integration

### 11.1 Purpose

A central design goal of the platform is to be **natively accessible to AI agents**. As AI assistants become common tools for small business owners and their accountants, the platform should be something those agents can interact with directly — posting transactions, querying balances, looking up contacts, and managing documents — without requiring bespoke integration code for each agent.

This is achieved by building an **MCP (Model Context Protocol) server** as a core component of the platform. MCP is a standard protocol that allows AI agents to discover and use tools exposed by external services. Any MCP-compatible agent — Claude, or future equivalents — can connect to the platform's MCP server and immediately understand what operations are available, without any custom plugin or connector development.

The MCP server sits alongside the REST API as an alternative interface to the same underlying services. The REST API serves the web frontend, third-party module integrations, and traditional programmatic access. The MCP server serves AI agents. Both call the same backend logic and are subject to the same authentication, authorisation, and audit trail requirements.

### 11.2 What the MCP Server Exposes

The MCP server presents the platform's capabilities as **tools** that AI agents can discover and call. These map directly to the REST API endpoints already designed for each module:

**General Ledger tools:**
- `gl_post_transaction` — submit a transaction for posting (through the approval workflow).
- `gl_query_journal` — search committed transactions by date, type, account, counterparty, or amount.
- `gl_get_trial_balance` — retrieve the trial balance for a given period.
- `gl_get_account_balance` — get the current balance of a specific account.
- `gl_list_accounts` — browse or search the chart of accounts.
- `gl_get_period_status` — check the current period and its state (open, soft close, hard close).

**Contacts tools:**
- `contacts_search` — find a contact by name, registration number, or other attributes.
- `contacts_get_trading_accounts` — list all trading accounts for a given contact.
- `contacts_get_trading_account` — retrieve full details of a specific trading account including commercial terms.

**Sales and Customer tools:**
- `sales_create_order` — create a new sales order for a customer trading account.
- `sales_generate_invoice` — generate a customer invoice from a confirmed order.
- `sales_get_customer_balance` — check a customer's outstanding balance and aged debt.
- `sales_list_outstanding_invoices` — retrieve unpaid invoices, optionally filtered by trading account or age.

**Purchasing and Supplier tools:**
- `purchasing_recognise_invoice` — submit a supplier invoice for recognition and posting.
- `purchasing_create_order` — create a new purchase order.
- `purchasing_get_supplier_balance` — check outstanding amounts owed to a supplier.

**Product and Stock tools:**
- `stock_check_availability` — query available stock for a product or SKU.
- `stock_get_product` — retrieve product details including variants and pricing.
- `stock_list_low_stock` — identify items below reorder thresholds.

**Document Repository tools:**
- `documents_upload` — upload a document (PDF, image, etc.) and receive the content hash.
- `documents_search` — find documents by type, date, associated transaction, or counterparty.
- `documents_get` — retrieve a specific document by its content hash.

The MCP server also exposes **resources** — read-only data that agents can reference for context. These include the chart of accounts structure, the list of active trading accounts, the current period information, and the configured tax codes. Resources help agents make informed decisions (such as choosing the correct expense account) without needing to make multiple tool calls.

### 11.3 The Folder-Watching Scenario

A practical example that illustrates the full value of MCP integration:

A small business owner saves all incoming documents — supplier invoices, bank statements, receipts, utility bills — into a designated folder on their computer. An AI agent (such as Claude in Cowork mode, or a scheduled task) monitors this folder. When a new document appears:

1. The agent reads and analyses the document, identifying it as (for example) a supplier invoice from Northern Building Supplies for £2,450.00 plus VAT.
2. The agent calls `contacts_search` to find the supplier, then `contacts_get_trading_accounts` to identify the correct GBP trading account.
3. The agent calls `gl_list_accounts` to determine the appropriate expense categories, informed by the supplier's typical purchase history.
4. The agent calls `documents_upload` to store the PDF in the document repository, receiving the content hash.
5. The agent calls `gl_post_transaction` to submit the supplier invoice to the GL, including the document hash, the trading account reference, and the line-by-line breakdown with tax codes.
6. If the agent's confidence in its analysis is below the auto-approval threshold, the transaction enters the approval staging area. The business owner receives a notification and reviews it through the web interface (Section 10.3), approving, modifying, or rejecting with a single action.

The entire flow — from document appearing in a folder to a fully posted (or pending-approval) GL transaction with the source document archived — happens without the business owner doing anything beyond saving the file. Over time, as the agent learns the business's patterns (which suppliers map to which expense accounts, which items are stock purchases versus overheads), the confidence scores rise and more transactions are auto-approved.

### 11.4 Authentication and Security

AI agents connecting via MCP are subject to the same security model as any other API client:

- **Authentication** via OAuth 2.0 tokens, scoped to a specific tenant and user identity. The agent acts on behalf of a named user, and all transactions it submits are recorded as originating from that user via the MCP interface.
- **Authorisation** through role-based permissions. An agent can only call tools that the associated user has permission to use. A bookkeeper's agent can post routine transactions; it cannot close periods or modify the chart of accounts unless the bookkeeper has those permissions.
- **Audit trail** — every action taken by an AI agent through the MCP server is logged with the same detail as actions taken through the web interface or REST API. The source field on GL transactions identifies the MCP server and the agent identity, so there is always a clear record of what was done by a human and what was done by an AI.
- **Approval workflow integration** — transactions submitted by AI agents flow through the same approval rules as any other submission. The confidence score mechanism (Section 2.5) is particularly relevant here, as AI-originated transactions can be routed to manual review based on configurable thresholds.

### 11.5 MCP Server Architecture

The MCP server is implemented as a lightweight service that translates between the MCP protocol and the platform's REST API. It does not contain business logic — it delegates all operations to the existing module backends. This means:

- Adding a new module to the platform automatically makes it available to AI agents by registering new tools with the MCP server.
- The MCP server can be deployed alongside the module backends or as a separate service behind the same authentication layer.
- Third-party modules that expose REST APIs can also register MCP tools, extending the AI agent's capabilities as the ecosystem grows.

### 11.6 Alternatives Considered

**Direct API integration** — building a custom plugin for each AI platform (a Claude plugin, a ChatGPT plugin, etc.). This works but requires maintaining separate integrations for every AI agent, which scales poorly as more agents enter the market. MCP provides a single standard interface.

**Embedded AI modules only** — building intelligence directly into the platform (as with the AI invoice processor in Section 7). This remains valuable for users who do not have an AI agent, but it limits capabilities to the specific scenarios the platform developers have anticipated. MCP allows any agent to use the platform's tools in ways the platform developers did not foresee.

**Webhooks alone** — the platform already publishes events via webhooks (Section 9). Webhooks handle the "something happened, notify interested parties" pattern. MCP handles the "an agent wants to take an action" pattern. The two mechanisms are complementary, not alternatives. The folder-watching scenario uses both: an event triggers the AI analysis (event-driven), and the AI agent uses MCP tools to interact with the platform (action-driven).

The recommended approach is to build all three: the MCP server for AI agent access, the embedded AI modules for standalone intelligent automation, and the webhook system for event-driven notifications.


## 12. Key Technical Considerations

### 12.1 Data Consistency

Transactions that affect multiple modules (e.g., dispatching stock and invoicing a customer) must be coordinated carefully. The GL provides the financial consistency guarantee (debits equal credits, the chain is unbroken), but operational consistency across modules requires careful API design and potentially a saga pattern for multi-step business processes.

### 12.2 Multi-Currency

The platform must support transactions in multiple currencies, recording both the foreign currency amount and the base currency equivalent. A `FX_REVALUATION` transaction type handles period-end adjustments when exchange rates change.

### 12.3 Multi-Tenancy

For SaaS deployment, strong data isolation between customers is essential — both for security and regulatory compliance. Each tenant's chain files and database records must be completely separate. This architecture should be designed from the outset, not retrofitted.

### 12.4 Tax Handling

VAT, GST, and sales tax rules vary enormously by jurisdiction. Tax codes should be resolved by a dedicated tax module (or tax service) that the GL consults during posting. This keeps tax logic out of the GL core and allows it to evolve independently as tax law changes.

### 12.5 Regulatory Compliance

The platform must support Making Tax Digital (UK), GAAP and IFRS reporting standards, complete audit trails (provided inherently by the immutable chain), data protection requirements (GDPR, etc.), and jurisdictional record retention requirements (typically 6–10 years). The immutable, hash-chained ledger provides a strong foundation for compliance, and in some jurisdictions (e.g., Portugal's sequential signed invoice requirements) the architecture is naturally aligned with emerging regulatory direction.


## 13. Competitive Positioning

The platform's key differentiators are:

- **Genuine modularity** — customers adopt what they need; third parties extend the ecosystem.
- **Cryptographically verifiable ledger** — a level of financial data integrity that traditional packages cannot match. Auditors can independently verify the ledger using simple tools that check the hash chain.
- **Open APIs** — truly extensible, enabling bespoke business workflows that monolithic platforms handle poorly.
- **AI-native design** — the architecture accommodates intelligent automation as a first-class pattern rather than a bolt-on afterthought.
- **MCP-native AI agent access** — the platform is directly accessible to AI personal assistants via MCP, enabling automated bookkeeping workflows that no incumbent currently offers.

## 14. Commercialisation — The Open-Core Model

The platform adopts an **open-core commercialisation strategy**. The core platform — the General Ledger module, Contacts module, and the basic functional modules needed to run a small business — is released as open-source software. Revenue is generated through a set of complementary paid offerings that serve businesses with more advanced needs.

This model is chosen deliberately. The platform's architectural identity is rooted in integrity, immutability, and trust. A data-monetisation model (offering free software in exchange for the right to market to users using their financial data) would fundamentally undermine that trust positioning. Purchase ledger data reveals margins, supplier relationships, volumes, and pricing — commercially sensitive information that finance teams will not willingly expose. The open-core model preserves trust while building multiple sustainable revenue streams.

### 14.1 The Free Core

A small business running the open-source core on self-hosted infrastructure gets a **fully functional accounting system** — not a crippled trial or a feature-limited edition. This includes the General Ledger with immutable chain files, the Contacts module, the Product and Stock module, the Sales and Customer module, and the Purchasing and Supplier module. The free core is the ecosystem's foundation and its primary driver of adoption.

### 14.2 Revenue Streams

**Compliance packs.** Tax compliance varies by jurisdiction and changes constantly — Making Tax Digital in the UK, SII in Spain, e-invoicing mandates across the EU, SAF-T in Scandinavia. Country-specific compliance packs are maintained and sold as annual subscriptions. This is recurring revenue with natural retention — switching away means re-solving a problem the customer has already solved, and the regulatory landscape changes frequently enough that ongoing maintenance delivers genuine value.

**Enterprise modules.** Functionality that mid-market and larger businesses need but small businesses do not: multi-entity consolidation with intercompany elimination, advanced budgeting and forecasting with multi-scenario planning, fixed asset management with depreciation schedules and revaluation, and payroll integration. These are not artificially restricted features — they are genuinely complex capabilities that require significant engineering investment.

**Managed hosting.** A fully managed service where the platform runs on dedicated cloud infrastructure for each customer. Each customer gets an isolated instance — their chain files live on dedicated storage, not in a shared multi-tenant database. Monthly subscription covers infrastructure, backups, updates, and monitoring. The key differentiator from pure SaaS offerings is that data sovereignty is preserved by design.

**Support and SLA tiers.** The open-source core comes with community support. Paying customers receive guaranteed response times, a named account contact, migration assistance, and priority bug fixes.

**Module marketplace.** Third-party developers build modules for the platform — a Shopify connector, a construction job costing module, a CRM integration — and sell them through a hosted marketplace. The platform takes a percentage of each sale. This creates the ecosystem flywheel: more modules attract more users, which attracts more developers, which creates more modules.

**Certification and training.** Official certification programmes for accounting firms and implementation partners. Certified partners can offer implementation services and list themselves as accredited.

**Data migration services.** Paid migration tools and white-glove services to import historical data from QuickBooks, Xero, Sage, and other platforms. This directly addresses the largest barrier to switching accounting systems.

### 14.3 Revenue Priority

The recommended revenue focus in order of priority:

1. **Compliance packs and managed hosting** — recurring, needed from day one, scales with the customer base.
2. **Enterprise modules** — high value, enables upmarket expansion.
3. **Support and SLA tiers** — reliable, grows with adoption.
4. **Data migration services** — one-off but high-value, directly drives new customer acquisition.
5. **Module marketplace** — takes time to build but becomes the most valuable long-term asset as the ecosystem moat.
6. **Certification and training** — modest individually, scales well, builds the professional ecosystem.

### 14.4 Strategic Rationale

The open-core model strengthens competitive positioning rather than undermining it. The open-source core builds trust and drives adoption. Paid offerings deliver genuine additional value rather than unlocking artificially restricted features. The ecosystem becomes the moat — the more modules built for the platform, the more valuable it becomes to every user, and the harder it is for incumbents to compete with a free, extensible alternative backed by a growing developer community.

---

*Document generated: 2 March 2026*
*Status: Architectural overview — working draft for discussion*
