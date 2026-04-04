# Migration Guides — Exporting from Common Accounting Systems

This reference file contains step-by-step export instructions for each accounting system that
Luca supports for migration. Use these instructions when guiding a user through Path A (migration
from an existing system).

---

## Xero

### Exporting the Chart of Accounts

1. Log in to Xero
2. Go to **Settings** (top right menu) → **Chart of Accounts**
3. Click the **Export** button (top right of the accounts list)
4. Choose **CSV** format
5. Save the file and send it to Luca

**Expected columns in the CSV:**

| Column | Description |
|--------|-------------|
| `*Code` | Account code (e.g., 200, 400, BANK) |
| `*Name` | Account name |
| `*Type` | Account type (see type mapping below) |
| `Description` | Optional description |
| `Tax Code` | Default VAT/tax code |
| `Dashboard` | Whether shown on Xero dashboard |

**Xero type → Luca type mapping:**

| Xero Type | Luca Type | Luca Category |
|-----------|-----------|---------------|
| REVENUE | REVENUE | REVENUE |
| SALES | REVENUE | REVENUE |
| OTHERINCOME | REVENUE | OTHER_INCOME |
| EXPENSE | EXPENSE | OVERHEADS |
| OVERHEADS | EXPENSE | OVERHEADS |
| DIRECTCOSTS | EXPENSE | DIRECT_COSTS |
| DEPRECIATN | EXPENSE | OVERHEADS |
| BANK | ASSET | CURRENT_ASSET |
| CURRENT | ASSET | CURRENT_ASSET |
| FIXED | ASSET | FIXED_ASSET |
| NONCURRENT | ASSET | FIXED_ASSET |
| PREPAYMENT | ASSET | CURRENT_ASSET |
| CURRLIAB | LIABILITY | CURRENT_LIABILITY |
| TERMLIAB | LIABILITY | LONG_TERM_LIABILITY |
| LIABILITY | LIABILITY | CURRENT_LIABILITY |
| EQUITY | EQUITY | EQUITY |

### Exporting the Trial Balance

1. Go to **Accounting** → **Reports**
2. Search for **Trial Balance**
3. Set the **As At** date to your migration date (e.g., the last day of the month before you switch)
4. Click **Update**
5. Click **Export** → **CSV**
6. Save and send to Luca

**Expected columns:** Account Code, Account Name, Debit, Credit

**Note:** Xero exports trial balance figures as positive numbers. Debit accounts (assets, expenses)
appear in the Debit column. Credit accounts (liabilities, equity, revenue) appear in the Credit column.

---

## Sage 50 (Desktop)

### Exporting the Chart of Accounts

1. Open Sage 50
2. Go to **Company** in the top menu
3. Click **Chart of Accounts**
4. Click **Export** or use **File → Export**
5. Choose **CSV** or **Excel** format
6. Save the file

**Expected columns in the CSV:**

| Column | Description |
|--------|-------------|
| `Account Number` | Numeric account code (e.g., 0010, 4000) |
| `Account Name` | Account description |
| `Account Type` | Sage account type (see mapping below) |
| `Balance` | Current balance (may not be needed if you're using the trial balance separately) |

**Sage 50 type → Luca type mapping:**

| Sage 50 Type | Luca Type | Luca Category |
|--------------|-----------|---------------|
| Sales | REVENUE | REVENUE |
| Purchases | EXPENSE | DIRECT_COSTS |
| Direct Expenses | EXPENSE | DIRECT_COSTS |
| Overheads | EXPENSE | OVERHEADS |
| Fixed Assets | ASSET | FIXED_ASSET |
| Current Assets | ASSET | CURRENT_ASSET |
| Bank | ASSET | CURRENT_ASSET |
| Current Liabilities | LIABILITY | CURRENT_LIABILITY |
| Long Term Liabilities | LIABILITY | LONG_TERM_LIABILITY |
| Capital & Reserves | EQUITY | EQUITY |

**Note:** Sage 50 account numbers are typically 4 digits. They can be kept as-is or mapped to
your preferred Luca code range. Sage uses codes 0010–0999 for fixed assets, 1000–1999 for current
assets, 2000–2999 for current liabilities, 3000–3999 for long-term liabilities, 4000–4999 for
sales, 5000–5999 for purchases, 6000–9999 for overheads.

### Exporting the Trial Balance

1. Go to **Reports** → **Company & Financials**
2. Select **Trial Balance**
3. Set the date range up to your migration date
4. Click **Preview** or **Print**
5. Use the **Export** option to export to CSV or Excel

---

## QuickBooks Online (QBO)

### Exporting the Chart of Accounts

1. Log in to QuickBooks Online
2. Click the **Settings** icon (gear icon, top right)
3. Under **Your Company**, click **Chart of Accounts**
4. Click **Run Report** (top right of the accounts list)
5. Click the **Export** icon (spreadsheet/download icon, top right of the report)
6. Choose **Export to Excel** (.xlsx) or **Export to CSV**
7. Save and send to Luca

**Expected columns:**

| Column | Description |
|--------|-------------|
| `Account` | Account name |
| `Type` | QBO account type |
| `Detail Type` | More specific account category |
| `Description` | Optional description |
| `Balance` | Current balance |

**Note:** QBO does not always export account codes. If the user has set up account numbers, they
will appear as a prefix to the account name (e.g., "1000 Bank Account"). Ask the user to enable
account numbers under Settings → Advanced → Chart of Accounts if they want to bring codes across.

**QBO type → Luca type mapping:**

| QBO Type | Luca Type | Luca Category |
|----------|-----------|---------------|
| Income | REVENUE | REVENUE |
| Other Income | REVENUE | OTHER_INCOME |
| Cost of Goods Sold | EXPENSE | DIRECT_COSTS |
| Expense | EXPENSE | OVERHEADS |
| Other Expense | EXPENSE | OVERHEADS |
| Bank | ASSET | CURRENT_ASSET |
| Accounts Receivable (A/R) | ASSET | CURRENT_ASSET |
| Other Current Asset | ASSET | CURRENT_ASSET |
| Fixed Asset | ASSET | FIXED_ASSET |
| Other Asset | ASSET | FIXED_ASSET |
| Accounts Payable (A/P) | LIABILITY | CURRENT_LIABILITY |
| Credit Card | LIABILITY | CURRENT_LIABILITY |
| Other Current Liability | LIABILITY | CURRENT_LIABILITY |
| Long-Term Liability | LIABILITY | LONG_TERM_LIABILITY |
| Equity | EQUITY | EQUITY |

### Exporting the Trial Balance

1. Go to **Reports** (left menu)
2. Search for **Trial Balance** or find it under **All Reports → Accountant Reports**
3. Set the **Report period** to your migration date (custom date ending on migration date)
4. Click **Run report**
5. Click the **Export** icon → **Export to Excel** or **Export to CSV**

---

## QuickBooks Desktop (QBDT)

### Exporting the Chart of Accounts

1. Open QuickBooks Desktop
2. Go to **Reports** (top menu) → **Accountant & Taxes** → **Chart of Accounts**
3. Click **Excel** (or **Export** button) → **Create New Worksheet** or **Update Existing Worksheet**
4. Save the Excel file

Alternatively:
1. Go to **Lists** → **Chart of Accounts**
2. Click **Account** (bottom left) → **Print List**
3. Or use **File** → **Utilities** → **Export** → **Lists to IIF Files**

**Note:** QBDT exports are similar in structure to QBO. Use the same type mapping as QBO above.

### Exporting the Trial Balance

1. Go to **Reports** → **Accountant & Taxes** → **Trial Balance**
2. Set the dates to your migration date
3. Click **Excel** button to export

---

## FreeAgent

### Exporting the Chart of Accounts

1. Log in to FreeAgent
2. Go to **Accounting** (top menu) → **Chart of Accounts**
3. Look for an **Export** button or CSV download option
4. If no direct export is available, use the **Contacts** or **Reports** area to get account data

**Note:** FreeAgent uses a simplified chart of accounts structure. Categories include:
- Income (maps to REVENUE)
- Expenses (maps to EXPENSE)
- Assets (maps to ASSET)
- Liabilities (maps to LIABILITY)
- Capital (maps to EQUITY)

FreeAgent account codes are numeric. Typical ranges:
- 001–099: Capital and Equity
- 100–199: Fixed Assets
- 200–299: Current Assets
- 300–399: Liabilities
- 400–499: Income
- 500–899: Expenses

### Exporting the Trial Balance

1. Go to **Accounting** → **Balance Sheet** and **Profit and Loss** reports
2. Set the date to your migration date
3. Export each report
4. Combine the figures into a single trial balance (assets + expenses on the debit side,
   liabilities + equity + income on the credit side)

---

## Generic Spreadsheet Format

If the user is migrating from a system not listed above, or from a manual spreadsheet, use this
generic format.

### Chart of Accounts — Required Format

Create a CSV or spreadsheet with these columns:

| Column | Required? | Description |
|--------|-----------|-------------|
| `code` | Required | Account code (e.g., 1000, 4000) — must be unique |
| `name` | Required | Account name / description |
| `type` | Required | One of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE |
| `category` | Optional | See categories below |
| `description` | Optional | Longer description or notes |

**Valid values for `type`:**
- `ASSET`
- `LIABILITY`
- `EQUITY`
- `REVENUE`
- `EXPENSE`

**Valid values for `category` (optional but recommended):**
- `CURRENT_ASSET` — cash, debtors, stock, prepayments
- `FIXED_ASSET` — plant, equipment, vehicles, property
- `CURRENT_LIABILITY` — creditors, VAT, PAYE
- `LONG_TERM_LIABILITY` — loans, mortgages
- `EQUITY` — share capital, retained earnings
- `REVENUE` — trading income
- `OTHER_INCOME` — interest received, gains
- `DIRECT_COSTS` — cost of goods sold, direct materials
- `OVERHEADS` — general operating expenses
- `FINANCE_COSTS` — bank charges, interest paid

**Example:**
```csv
code,name,type,category
1000,Bank Current Account,ASSET,CURRENT_ASSET
1100,Trade Debtors,ASSET,CURRENT_ASSET
2000,Trade Creditors,LIABILITY,CURRENT_LIABILITY
3000,Share Capital,EQUITY,EQUITY
4000,Sales Revenue,REVENUE,REVENUE
6000,Wages and Salaries,EXPENSE,OVERHEADS
```

### Trial Balance — Required Format

Provide a spreadsheet with these columns:

| Column | Required? | Description |
|--------|-----------|-------------|
| `account_code` | Required | Must match a code in the chart of accounts |
| `account_name` | Optional | For reference only |
| `debit` | Required | Debit balance (0 if credit balance) |
| `credit` | Required | Credit balance (0 if debit balance) |

**Important:** For each account, only one of `debit` or `credit` should be non-zero. An account
cannot have both a debit balance and a credit balance — if that appears in their export, it usually
means negative figures and needs to be corrected.

**Check:** Total of all debit values must equal total of all credit values. If they don't balance,
the migration cannot proceed until the discrepancy is identified.

---

## Troubleshooting Migration Issues

### "The totals don't balance"

Trial balance debits must equal credits. Common causes:
- A balance sheet account was exported with the wrong sign
- A suspense or reconciliation account was missed
- The export date differs between accounts (e.g., some accounts at month end, others at a different date)

Ask the user to confirm the date and re-export, or work through the difference account by account.

### "I don't recognise some of the account types"

Old systems often have custom categories or names that don't map neatly. When in doubt:
- Accounts that represent things you own = ASSET
- Accounts that represent things you owe = LIABILITY
- Accounts that represent owner's money in the business = EQUITY
- Accounts that represent income earned = REVENUE
- Accounts that represent costs incurred = EXPENSE

### "I have hundreds of accounts but only use a few"

Import them all. Unused accounts can be deactivated later using `gl_update_account`. It's safer
to have too many accounts than to lose history by not importing some.

### "I have inter-company accounts / group accounts"

For the MVP, Luca is a single-tenant system. Inter-company accounts can be created but inter-company
eliminations will need to be done manually as journal entries. Flag this as a future enhancement.
