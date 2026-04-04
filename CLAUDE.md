# Modular Accounting Platform — General Ledger MVP

## Project Overview

This is the General Ledger (GL) module for a modular business accounting platform. The GL is the core financial module — the heart of the system. All other modules (Sales, Purchasing, Stock, etc.) will post transactions to the GL via its REST API. This MVP implements the GL module as a standalone service running in Docker.

See `docs/System Architecture Overview.md` for the full platform architecture. This MVP implements Sections 2.1 through 2.7 of that document.

## Tech Stack

- **Language**: TypeScript (strict mode enabled)
- **Runtime**: Node.js 20+
- **Framework**: Express.js for the REST API
- **Database**: PostgreSQL 16 (the "mirror" database for queries and reporting)
- **Chain files**: Custom append-only JSON files stored on the local filesystem (the authoritative ledger)
- **Frontend**: React with TypeScript, served as static assets
- **Containerisation**: Docker and Docker Compose for local development
- **Testing**: Jest for unit and integration tests
- **ORM/Query builder**: Knex.js for database access (not a full ORM — we want explicit SQL control)

## Project Structure

```
gl-mvp/
├── CLAUDE.md                 ← You are here
├── docker-compose.yml        ← Local development environment
├── docs/
│   └── System Architecture Overview.md  ← Full platform architecture
├── src/
│   ├── server.ts             ← Express app entry point
│   ├── config/
│   │   └── index.ts          ← Environment configuration
│   ├── api/
│   │   ├── routes.ts         ← API route definitions
│   │   ├── transactions.ts   ← Transaction posting endpoints
│   │   ├── accounts.ts       ← Chart of accounts endpoints
│   │   ├── periods.ts        ← Period management endpoints
│   │   ├── reports.ts        ← Trial balance and reporting endpoints
│   │   └── middleware/
│   │       ├── auth.ts       ← Authentication middleware (simplified for MVP)
│   │       ├── validation.ts ← Request validation
│   │       └── errors.ts     ← Error handling middleware
│   ├── chain/
│   │   ├── writer.ts         ← Append-only chain file writer
│   │   ├── reader.ts         ← Chain file reader and verifier
│   │   ├── hash.ts           ← SHA-256 hashing utilities
│   │   └── types.ts          ← Chain file data structures
│   ├── db/
│   │   ├── connection.ts     ← Database connection pool
│   │   ├── migrations/       ← Knex migration files
│   │   └── queries/          ← Query functions by domain
│   │       ├── accounts.ts
│   │       ├── transactions.ts
│   │       ├── periods.ts
│   │       └── reports.ts
│   ├── engine/
│   │   ├── posting.ts        ← Core posting logic (validate, expand, commit)
│   │   ├── approval.ts       ← Approval workflow and staging area
│   │   ├── periods.ts        ← Period state management and closing
│   │   ├── mappings.ts       ← Transaction type to account mappings
│   │   └── types.ts          ← Domain types and interfaces
│   └── web/                  ← React frontend (built separately, served as static)
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── Journal.tsx
│       │   │   ├── AccountLedger.tsx
│       │   │   ├── ApprovalQueue.tsx
│       │   │   ├── ChartOfAccounts.tsx
│       │   │   ├── PeriodManagement.tsx
│       │   │   └── TrialBalance.tsx
│       │   ├── components/    ← Shared UI components
│       │   └── hooks/         ← React hooks for API calls
│       └── package.json
├── tests/
│   ├── unit/
│   │   ├── chain/
│   │   ├── engine/
│   │   └── api/
│   └── integration/
│       ├── posting.test.ts    ← Full posting flow tests
│       ├── approval.test.ts   ← Approval workflow tests
│       ├── periods.test.ts    ← Period closing tests
│       └── chain-integrity.test.ts ← Chain verification tests
├── knexfile.ts               ← Knex configuration
├── tsconfig.json
├── package.json
└── Dockerfile
```

## Key Architecture Rules

These rules are non-negotiable and must be followed in all code:

1. **The chain file is the source of truth.** Every committed transaction is written to the chain file FIRST, then to the database. If the database write fails after the chain write succeeds, that is acceptable — the database can be rebuilt from chain files. The reverse (database write without chain write) must never happen.

2. **Double-entry always balances.** Every transaction must have debits equal to credits. The posting engine must validate this before committing. No transaction that does not balance may be written to the chain file. This validation must be tested extensively.

3. **The chain is append-only and hash-linked.** Each entry in a chain file contains the SHA-256 hash of the previous entry. The first entry in each period's chain file contains the closing checkpoint hash of the previous period. No mechanism exists to modify or delete a chain file entry.

4. **Closed periods are immutable.** Once a period is hard-closed, its chain file must reject any attempt to append. Post-close corrections are posted as PRIOR_PERIOD_ADJUSTMENT transactions in the current open period.

5. **All transactions flow through the approval workflow.** Transactions enter the staging area first. Approval rules determine whether they are auto-approved or require manual review. Only approved transactions are committed to the chain.

6. **The API is the only way in.** The web frontend calls the same API as external modules would. There is no back door. All business logic lives in the engine layer, not in the API handlers or the frontend.

## Chain File Format — Detailed Specification

### File Location and Naming

Each period has its own chain file: `chains/{tenant_id}/{period_id}.chain.jsonl`

For the MVP (single tenant), use: `chains/default/{period_id}.chain.jsonl`

Period IDs use the format `YYYY-MM` (e.g., `2026-03` for March 2026).

The file is a JSONL file — each line is a complete, self-contained JSON object terminated by a newline character (`\n`). This format is chosen because appending a new line does not require reading or modifying any existing content in the file.

### Entry Structure

Every entry in the chain file has this exact structure:

```json
{
  "sequence": 1,
  "timestamp": "2026-03-04T10:30:00.000Z",
  "previous_hash": "GENESIS",
  "entry_hash": "a1b2c3d4e5f6...(full 64-char hex SHA-256)",
  "type": "TRANSACTION",
  "payload": { }
}
```

Field definitions:
- `sequence` — integer, starts at 1 for each period, increments by 1 for every entry. No gaps allowed.
- `timestamp` — UTC ISO 8601 timestamp of when the entry was written to the chain. This is the commit time, not the transaction date.
- `previous_hash` — the `entry_hash` of the immediately preceding entry in this file. For the very first entry in a period, see "Genesis and Cross-Period Linking" below.
- `entry_hash` — SHA-256 hash of the canonical form of this entry (see "Hash Computation" below).
- `type` — one of: `"TRANSACTION"`, `"PERIOD_CLOSE"`, `"GENESIS"`.
- `payload` — the data for this entry. Structure depends on `type`.

### Hash Computation — Step by Step

This is the most critical algorithm in the system. It must be implemented exactly as described.

To compute the `entry_hash` for a new entry:

1. Construct the entry object with all fields populated EXCEPT `entry_hash` (set it to an empty string `""`).
2. Serialise the object to a JSON string using **canonical serialisation**: keys sorted alphabetically at every level of nesting, no whitespace (no spaces after colons or commas), numbers serialised without trailing zeros (use `1250` not `1250.00`). Use a deterministic JSON serialiser — the built-in `JSON.stringify` with a key-sorting replacer, or a library like `json-canonical`.
3. Compute the SHA-256 hash of the resulting UTF-8 byte string.
4. Express the hash as a lowercase hexadecimal string (64 characters).
5. Set this value as the `entry_hash` field.

**Why canonical serialisation matters:** If the same logical data produces different JSON strings (due to key ordering or whitespace differences), the hashes will differ and chain verification will fail. The serialisation must be deterministic and reproducible.

**Pseudocode:**

```typescript
function computeEntryHash(entry: ChainEntry): string {
  // Step 1: Create a copy with entry_hash set to empty string
  const hashInput = { ...entry, entry_hash: "" };

  // Step 2: Canonical JSON serialisation (sorted keys, no whitespace)
  const canonical = canonicalJsonStringify(hashInput);

  // Step 3-4: SHA-256, output as lowercase hex
  const hash = sha256(canonical).toString('hex');

  return hash;
}
```

### Genesis and Cross-Period Linking

The first entry in each period's chain file is a `GENESIS` entry that links this period to the previous one:

**For the very first period ever (no previous period exists):**
```json
{
  "sequence": 1,
  "timestamp": "2026-03-01T00:00:00.000Z",
  "previous_hash": "GENESIS",
  "entry_hash": "(computed)",
  "type": "GENESIS",
  "payload": {
    "period_id": "2026-03",
    "previous_period_id": null,
    "previous_period_closing_hash": null,
    "opening_balances": {}
  }
}
```

The literal string `"GENESIS"` is used as `previous_hash` only for the very first entry in the very first period. This is the only time `previous_hash` is not a valid SHA-256 hash.

**For subsequent periods (previous period has been closed):**
```json
{
  "sequence": 1,
  "timestamp": "2026-04-01T00:15:01.000Z",
  "previous_hash": "(entry_hash of the PERIOD_CLOSE entry from previous period)",
  "entry_hash": "(computed)",
  "type": "GENESIS",
  "payload": {
    "period_id": "2026-04",
    "previous_period_id": "2026-03",
    "previous_period_closing_hash": "(entry_hash of the PERIOD_CLOSE entry from 2026-03)",
    "opening_balances": {
      "1000": { "debit": 15420.50, "credit": 0 },
      "1100": { "debit": 8200.00, "credit": 0 },
      "2000": { "debit": 0, "credit": 3150.00 }
    }
  }
}
```

Note: `previous_hash` and `previous_period_closing_hash` contain the same value here. The `previous_hash` field maintains the structural chain link; the `previous_period_closing_hash` in the payload makes the cross-period link explicit and human-readable.

### Transaction Entry Payload

```json
{
  "transaction_id": "TXN-2026-03-00001",
  "transaction_type": "CUSTOMER_INVOICE",
  "reference": "INV-2026-00142",
  "date": "2026-03-04",
  "currency": "GBP",
  "counterparty": {
    "trading_account_id": "TA-CUST-0445-GBP",
    "contact_id": "CONTACT-0087"
  },
  "description": "Sale of widgets to Northern Building Supplies",
  "lines": [
    {
      "account_code": "1100-TRADE_DEBTORS",
      "description": "Trade debtors",
      "debit": 46200.00,
      "credit": 0,
      "cost_centre": "SALES_NORTH"
    },
    {
      "account_code": "4000-SALES_TRADE",
      "description": "Trade sales revenue",
      "debit": 0,
      "credit": 38500.00,
      "cost_centre": "SALES_NORTH"
    },
    {
      "account_code": "2200-VAT_OUTPUT",
      "description": "VAT output tax",
      "debit": 0,
      "credit": 7700.00
    }
  ],
  "source": {
    "module_id": "sales-and-customer",
    "module_reference": "SO-2026-0891"
  },
  "idempotency_key": "sales-INV-2026-00142"
}
```

### Period Close Entry Payload

```json
{
  "period_id": "2026-03",
  "closing_trial_balance": {
    "1000": { "debit": 18750.50, "credit": 0 },
    "1100": { "debit": 12400.00, "credit": 0 },
    "2000": { "debit": 0, "credit": 5320.00 },
    "4000": { "debit": 0, "credit": 42800.00 }
  },
  "total_transactions": 541,
  "total_debits": 284500.00,
  "total_credits": 284500.00,
  "closed_by": "finance.controller@company.com"
}
```

Note: the MVP does not implement Merkle trees. The `merkle_root` field mentioned in the architecture document is deferred to a future version. For the MVP, the linear hash chain provides the integrity guarantee.

### Chain File Writer — Implementation Requirements

The writer (`src/chain/writer.ts`) must implement these operations:

**`appendEntry(periodId: string, type: EntryType, payload: object): ChainEntry`**

Step-by-step logic:

1. Acquire a write lock for this period's chain file. Only one write may be in progress at a time per period. Use a mutex or file lock.
2. Check the period status in the database. If the period is `HARD_CLOSE`, throw a `PeriodClosedError`. If the period is `SOFT_CLOSE` and the caller does not have soft-close override permission, throw a `PeriodSoftClosedError`.
3. Read the last line of the chain file to get the previous entry's `entry_hash` and `sequence`. If the file does not exist (new period), this is the genesis case — see below.
4. Construct the new entry object: `sequence` = previous sequence + 1, `timestamp` = current UTC time, `previous_hash` = previous entry's `entry_hash`, `type` and `payload` as provided, `entry_hash` = `""` (placeholder).
5. Compute `entry_hash` using the hash computation algorithm described above.
6. Set `entry_hash` on the entry.
7. Serialise the entry to a single JSON line (compact, no newlines within the JSON) followed by `\n`.
8. Append this line to the chain file.
9. Call `fsync` on the file descriptor to ensure the write is durable on disk. **This is critical** — without fsync, a power failure could lose the entry even though the write call returned success.
10. Release the write lock.
11. Return the completed entry.

**`createPeriodFile(periodId: string, previousPeriodId: string | null, openingBalances: object): ChainEntry`**

Creates a new chain file with a GENESIS entry:

1. Verify the file does not already exist. If it does, throw an error.
2. If `previousPeriodId` is provided, read the last entry of the previous period's chain file and verify it is a `PERIOD_CLOSE` entry. Extract its `entry_hash`.
3. Construct the GENESIS entry with `previous_hash` set to the previous period's closing hash (or the literal string `"GENESIS"` if this is the first period).
4. Write the entry as the first line of the new file.
5. Fsync.
6. Return the GENESIS entry.

**`sealPeriod(periodId: string, closingPayload: object): ChainEntry`**

Writes the PERIOD_CLOSE entry and makes the file read-only:

1. Append a PERIOD_CLOSE entry using `appendEntry`.
2. After the entry is written and fsynced, set the file permissions to read-only (chmod 444 or equivalent). This provides an operating-system-level guard against accidental writes, in addition to the application-level check in step 2 of `appendEntry`.
3. Return the PERIOD_CLOSE entry.

### Chain File Reader — Implementation Requirements

The reader (`src/chain/reader.ts`) must implement:

**`verifyChain(periodId: string): { valid: boolean, entries: number, error?: string }`**

Step-by-step logic:

1. Open the chain file for the given period.
2. Read each line sequentially.
3. For each entry:
   a. Parse the JSON.
   b. Verify `sequence` is exactly 1 more than the previous entry (or 1 for the first entry).
   c. Verify `previous_hash` matches the `entry_hash` of the previous entry (or is `"GENESIS"` / previous period's closing hash for the first entry).
   d. Recompute the entry's hash: take the entry, set `entry_hash` to `""`, canonically serialise, SHA-256 hash. Compare the result to the stored `entry_hash`. If they do not match, the entry has been tampered with — return `{ valid: false, error: "Hash mismatch at sequence N" }`.
4. If all entries pass, return `{ valid: true, entries: N }`.

**`readEntry(periodId: string, sequence: number): ChainEntry | null`**

Read a specific entry by sequence number. Since the file is JSONL, this requires scanning from the start (or maintaining an index). For the MVP, scanning is acceptable.

**`readAllEntries(periodId: string): ChainEntry[]`**

Read all entries for a period. Used for rebuilding the database mirror.

**`getLastEntry(periodId: string): ChainEntry | null`**

Read only the last entry. Optimise this by seeking to the end of the file and reading backwards to find the last newline. This is called on every write operation so it should be fast.

### Chain File Edge Cases and Error Handling

These cases MUST be handled correctly:

- **Concurrent writes**: Two API requests try to write to the same period simultaneously. The write lock must ensure they are serialised. The second write must see the first write's hash.
- **Crash during write**: The process crashes after writing to the file but before fsync completes. On restart, the last line of the file may be incomplete (truncated JSON). The reader must detect this (JSON parse failure on the last line) and the writer must truncate the incomplete line before resuming writes.
- **Empty chain file**: The file exists but contains zero entries (e.g., created but genesis not yet written). Handle gracefully.
- **File does not exist**: Distinguished from empty file. `appendEntry` should throw; `createPeriodFile` should succeed.
- **Disk full**: The fsync or write fails. The entry must NOT be considered committed. Throw an error that propagates to the API caller.
- **Read-only file**: After period close, the file is chmod 444. Any attempt to open it for writing at the OS level should fail. The application-level check (period status) should catch this first, but the OS-level protection is a belt-and-braces safeguard.

## Database Schema (PostgreSQL Mirror)

The database mirrors the chain file data for efficient querying. Key tables:

- `accounts` — chart of accounts (code, name, type, category, active flag)
- `transactions` — header for each committed transaction
- `transaction_lines` — individual debit/credit lines
- `periods` — period definitions and status (OPEN, SOFT_CLOSE, HARD_CLOSE)
- `staging` — pending transactions awaiting approval
- `approval_rules` — configurable rules for auto-approval vs manual review
- `transaction_type_mappings` — default account mappings per transaction type
- `chain_metadata` — checkpoint hashes and chain integrity data

All database tables for committed data should include a `chain_verified` flag indicating whether the record has been verified against the chain file.

## MVP Transaction Types

For the MVP, implement these transaction types:

- `MANUAL_JOURNAL` — a direct journal entry (debit/credit lines provided explicitly)
- `CUSTOMER_INVOICE` — expands to debit Debtors, credit Revenue, credit VAT
- `SUPPLIER_INVOICE` — expands to debit Expense/Stock, debit VAT, credit Creditors
- `CUSTOMER_PAYMENT` — expands to debit Bank, credit Debtors
- `SUPPLIER_PAYMENT` — expands to debit Creditors, credit Bank
- `PRIOR_PERIOD_ADJUSTMENT` — correction referencing a closed period

## Period Management and Closing — Detailed Specification

### Period Data Model

Each period is a row in the `periods` database table:

```typescript
interface Period {
  period_id: string;        // e.g., "2026-03"
  start_date: string;       // e.g., "2026-03-01"
  end_date: string;         // e.g., "2026-03-31"
  status: PeriodStatus;     // "OPEN" | "SOFT_CLOSE" | "HARD_CLOSE"
  opened_at: string;        // UTC timestamp
  soft_closed_at?: string;  // UTC timestamp, null if not yet soft closed
  hard_closed_at?: string;  // UTC timestamp, null if not yet hard closed
  closed_by?: string;       // user identity who performed hard close
  closing_chain_hash?: string;  // entry_hash of the PERIOD_CLOSE chain entry
  data_flag: DataFlag;      // "PROVISIONAL" | "AUTHORITATIVE"
}
```

`data_flag` is `"PROVISIONAL"` while the period is OPEN or SOFT_CLOSE, and changes to `"AUTHORITATIVE"` when the period is HARD_CLOSE. All reporting queries must include this flag so that users and API consumers can see whether the figures are final or still subject to change.

### Period State Transitions

Periods move through exactly three states in one direction only. There is no mechanism to revert a state.

```
OPEN  →  SOFT_CLOSE  →  HARD_CLOSE
```

**OPEN → SOFT_CLOSE** (`softClosePeriod`)

Step-by-step logic:

1. Verify the period exists and its current status is `OPEN`. If not, throw `InvalidPeriodStateError`.
2. Verify the period's calendar end date has passed (i.e., today >= period end date). If not, throw `PeriodNotEndedError` with a message like "Cannot soft-close a period that has not yet ended. Period ends 2026-03-31."
3. Update the period status to `SOFT_CLOSE` in the database.
4. Set `soft_closed_at` to the current UTC timestamp.
5. Return the updated period.

After soft close, the chain file writer will still accept entries for this period, but ONLY if the caller explicitly provides a `soft_close_override: true` flag. This is intended for month-end adjustments by accountants. Routine posts from external modules (Sales, Purchasing, etc.) will not have this flag and will be rejected with a response that tells them to post to the next open period instead.

**SOFT_CLOSE → HARD_CLOSE** (`hardClosePeriod`)

This is the critical operation. It must be atomic — either the entire close succeeds or nothing changes.

Step-by-step logic:

1. Verify the period exists and its current status is `SOFT_CLOSE`. If not, throw `InvalidPeriodStateError`.

2. **Sequential ordering check**: Find the previous period (by date). If a previous period exists and its status is not `HARD_CLOSE`, throw `PeriodSequenceError` with message "Cannot close 2026-03 because the previous period 2026-02 is not yet closed."

3. **Staging area check**: Count all entries in the `staging` table for this period. If any pending (non-approved, non-rejected) entries exist, throw `StagingNotClearError` with message "Cannot close period: N transactions are still pending approval."

4. **Trial balance check**: Compute the trial balance for this period. Sum all debit amounts and all credit amounts across all committed transaction lines. If total debits ≠ total credits, throw `TrialBalanceError` with message "Cannot close period: trial balance does not balance. Debits: X, Credits: Y, Difference: Z." (This should never happen if the posting engine is working correctly, but this is the final safety net.)

5. **Compute the closing trial balance**: For every account that has any transaction lines in this period (or in any prior period for balance sheet accounts), compute the closing balance. The closing trial balance is a map of account_code → { debit: number, credit: number } where one of debit/credit is zero and the other is the absolute balance.

6. **Write the PERIOD_CLOSE entry to the chain file**: Call `chainWriter.sealPeriod(periodId, closingPayload)` where the payload contains the closing trial balance, total transaction count, total debits, total credits, and the identity of the user performing the close.

7. **Update the database**:
   a. Set the period status to `HARD_CLOSE`.
   b. Set `hard_closed_at` to the current UTC timestamp.
   c. Set `closed_by` to the user identity.
   d. Set `closing_chain_hash` to the `entry_hash` of the PERIOD_CLOSE chain entry.
   e. Set `data_flag` to `"AUTHORITATIVE"`.
   f. Update ALL `transactions` and `transaction_lines` rows for this period: set `data_flag = 'AUTHORITATIVE'`.

8. **Create the next period** (if it doesn't already exist):
   a. Compute the next period's start and end dates.
   b. Compute opening balances: these are the closing balances of all balance sheet accounts (ASSET, LIABILITY, EQUITY). Revenue and expense accounts do NOT carry forward — they start at zero in each period (unless this is also a year-end close, see below).
   c. Create the period row in the database with status `OPEN`.
   d. Call `chainWriter.createPeriodFile(nextPeriodId, periodId, openingBalances)` to create the new chain file with its GENESIS entry linked to this period's closing hash.

9. Return the closed period with the closing details.

### Year-End Closing — Additional Steps

If the period being hard-closed is the last period of the financial year (e.g., closing 2026-03 when the financial year runs April to March):

After step 8, perform these additional steps:

10. Compute the net profit/loss for the year: total revenue minus total expenses across all periods in the financial year.

11. Generate a `YEAR_END_CLOSE` transaction in the first period of the new financial year. This transaction:
    - Debits every revenue account for its full-year balance (zeroing it out).
    - Credits every expense account for its full-year balance (zeroing it out).
    - Credits (or debits, if a loss) the Retained Earnings account (3100) for the net result.
    - This transaction MUST balance (debits = credits).

12. Post this transaction through the normal posting engine (it goes through the chain writer and database mirror like any other transaction).

The opening balances for the new year's first period therefore reflect a clean balance sheet: all P&L accounts at zero, with the accumulated result in Retained Earnings.

### Prior Period Adjustments

When a user needs to correct something in a closed period, they CANNOT reopen it. Instead:

1. The user creates a `PRIOR_PERIOD_ADJUSTMENT` transaction in the **current open period**.
2. This transaction type has mandatory additional fields in its payload:
   - `adjustment_context.original_period` — the closed period being corrected (e.g., "2026-03").
   - `adjustment_context.original_transaction_id` — the transaction being corrected (optional but recommended).
   - `adjustment_context.reason` — free text explanation of the correction.
   - `adjustment_context.authorised_by` — the user who authorised the adjustment.
3. The posting lines contain the correcting entries (reversals and/or reclassifications).
4. The transaction is posted to the current period's chain file, not to the closed period.
5. Reports for the closed period remain unchanged. Reports for the current period include the adjustment. A comparative report can show the net effect.

### Period Closing Validation Summary

Before allowing hard close, ALL of these must be true:

| Check | Condition | Error if failed |
|-------|-----------|-----------------|
| Period status | Must be SOFT_CLOSE | `InvalidPeriodStateError` |
| Previous period | Must be HARD_CLOSE (or this is the first period) | `PeriodSequenceError` |
| Staging area | Zero pending entries for this period | `StagingNotClearError` |
| Trial balance | Total debits = Total credits | `TrialBalanceError` |

### Custom Error Classes for Period Management

Implement these specific error classes in the engine:

```typescript
class InvalidPeriodStateError extends Error {
  constructor(periodId: string, currentStatus: string, requiredStatus: string) {
    super(`Period ${periodId} is ${currentStatus}, must be ${requiredStatus}`);
  }
}

class PeriodSequenceError extends Error {
  constructor(periodId: string, previousPeriodId: string) {
    super(`Cannot close ${periodId}: previous period ${previousPeriodId} is not yet closed`);
  }
}

class StagingNotClearError extends Error {
  constructor(periodId: string, pendingCount: number) {
    super(`Cannot close ${periodId}: ${pendingCount} transactions still pending approval`);
  }
}

class TrialBalanceError extends Error {
  constructor(periodId: string, totalDebits: string, totalCredits: string) {
    super(`Cannot close ${periodId}: trial balance does not balance. Debits: ${totalDebits}, Credits: ${totalCredits}`);
  }
}

class PeriodNotEndedError extends Error {
  constructor(periodId: string, endDate: string) {
    super(`Cannot soft-close ${periodId}: period end date ${endDate} has not yet passed`);
  }
}

class PeriodClosedError extends Error {
  constructor(periodId: string) {
    super(`Period ${periodId} is closed. No further postings are accepted.`);
  }
}

class PeriodSoftClosedError extends Error {
  constructor(periodId: string) {
    super(`Period ${periodId} is in soft close. Only postings with soft_close_override are accepted.`);
  }
}
```

### Period Closing Test Scenarios

These specific test cases MUST be implemented:

1. **Happy path**: Open → soft close → hard close succeeds with valid data.
2. **Sequential ordering**: Attempting to hard-close March before February fails with `PeriodSequenceError`.
3. **Staging not clear**: Attempting to hard-close with pending items fails with `StagingNotClearError`.
4. **Post to closed period**: Attempting to post a transaction to a hard-closed period fails with `PeriodClosedError`.
5. **Post to soft-closed period without override**: Fails with `PeriodSoftClosedError`.
6. **Post to soft-closed period with override**: Succeeds.
7. **Opening balances carried forward**: After closing March, April's opening balances match March's closing balance sheet accounts. Revenue/expense accounts start at zero.
8. **Chain file sealed**: After hard close, the chain file is read-only at the OS level.
9. **Cross-period chain link**: April's GENESIS entry's `previous_hash` matches March's PERIOD_CLOSE entry's `entry_hash`.
10. **Cannot skip soft close**: Attempting to hard-close a period that is still OPEN fails with `InvalidPeriodStateError`.
11. **Cannot close twice**: Attempting to hard-close an already closed period fails with `InvalidPeriodStateError`.
12. **Prior period adjustment**: After closing March, a PRIOR_PERIOD_ADJUSTMENT posted in April references March and is accepted.
13. **Data flag update**: After closing, all transactions and lines for the period are flagged `AUTHORITATIVE`.


## MVP Scope

### Must have (MVP):
- Chain file writer with hash linking and verification
- Core posting engine with double-entry validation
- Chart of accounts CRUD
- Period management (open, soft close, hard close)
- Basic approval workflow (auto-approve below threshold, queue above)
- Trial balance calculation
- REST API for all the above
- Web UI: dashboard, journal view, chart of accounts, approval queue, trial balance, period management
- Docker Compose for one-command local startup
- Comprehensive test suite for chain integrity and posting logic

### Not in MVP (future):
- Merkle tree (use linear hash chain for now)
- Multi-currency (GBP only for MVP)
- Multi-tenancy (single tenant for MVP)
- Digital signatures from modules
- Webhook event publishing
- MCP server
- Advanced reporting (P&L, balance sheet, cash flow)

## Commands

```bash
# Start the full stack locally
docker-compose up

# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests (requires database)
npm run test:integration

# Run database migrations
npm run migrate

# Seed the database with sample chart of accounts
npm run seed

# Build the frontend
cd src/web && npm run build

# Type check without building
npm run typecheck
```

## Code Style

- Use TypeScript strict mode throughout.
- Prefer explicit types over `any`. Never use `any` in the engine or chain layers.
- Use `Decimal.js` for all monetary calculations — never use JavaScript floating point for money.
- Error handling: use custom error classes (e.g., `PostingValidationError`, `PeriodClosedError`) rather than generic errors.
- All API responses follow a consistent envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`.
- Database queries go in `src/db/queries/`, not in API handlers or engine code.
- All dates are ISO 8601 strings. All timestamps are UTC.
- Use meaningful variable names. Accounting has specific terminology — use it (debit, credit, ledger, journal, trial balance, not generic terms).

## Testing Philosophy

- **Chain integrity tests are the most important tests in the project.** Every test that writes to the chain must verify the hash chain is unbroken afterwards.
- **Every posting test must verify that debits equal credits.** This is the fundamental invariant.
- **Period closing tests must verify that closed periods reject new postings.**
- **Integration tests should use a real PostgreSQL database** (provided by Docker Compose) — not mocks.
- Write tests alongside implementation, not as an afterthought.

## Sample Chart of Accounts (for seeding)

```
1000  Bank Current Account          ASSET / CURRENT_ASSET
1100  Trade Debtors                 ASSET / CURRENT_ASSET
1200  VAT Input (Recoverable)      ASSET / CURRENT_ASSET
2000  Trade Creditors               LIABILITY / CURRENT_LIABILITY
2100  VAT Output                    LIABILITY / CURRENT_LIABILITY
2200  PAYE/NI Payable              LIABILITY / CURRENT_LIABILITY
3000  Share Capital                 EQUITY
3100  Retained Earnings            EQUITY
4000  Sales Revenue — Trade        REVENUE
4100  Sales Revenue — Other        REVENUE
5000  Cost of Goods Sold           EXPENSE / DIRECT_COSTS
5100  Purchases — Raw Materials    EXPENSE / DIRECT_COSTS
6000  Wages and Salaries           EXPENSE / OVERHEADS
6100  Rent and Rates               EXPENSE / OVERHEADS
6200  Office Supplies              EXPENSE / OVERHEADS
6300  Professional Fees            EXPENSE / OVERHEADS
6400  Travel and Subsistence       EXPENSE / OVERHEADS
6500  Marketing and Advertising    EXPENSE / OVERHEADS
6600  Depreciation                 EXPENSE / OVERHEADS
7000  Bank Interest Received       REVENUE / OTHER_INCOME
7100  Bank Charges                 EXPENSE / FINANCE_COSTS
```
