import type { Knex } from 'knex';

interface MappingRow {
  transaction_type: string;
  line_role: string;
  account_code: string;
  direction: 'DEBIT' | 'CREDIT';
  description: string;
}

// Default account mappings for each transaction type that auto-expands into
// double-entry lines. MANUAL_JOURNAL and PRIOR_PERIOD_ADJUSTMENT are not listed
// here because their lines are provided explicitly by the caller.
//
// VAT is assumed at the standard UK rate (20%). The posting engine computes
// the VAT amount from the net value and uses these mappings for the account codes.
const mappings: MappingRow[] = [
  // -----------------------------------------------------------------------
  // CUSTOMER_INVOICE
  //   Debit:  Trade Debtors (gross invoice amount including VAT)
  //   Credit: Sales Revenue — Trade (net amount)
  //   Credit: VAT Output (VAT amount)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'CUSTOMER_INVOICE',
    line_role: 'DEBTORS',
    account_code: '1100',
    direction: 'DEBIT',
    description: 'Trade debtors — customer invoice',
  },
  {
    transaction_type: 'CUSTOMER_INVOICE',
    line_role: 'REVENUE',
    account_code: '4000',
    direction: 'CREDIT',
    description: 'Sales revenue — trade',
  },
  {
    transaction_type: 'CUSTOMER_INVOICE',
    line_role: 'VAT_OUTPUT',
    account_code: '2100',
    direction: 'CREDIT',
    description: 'VAT output tax',
  },

  // -----------------------------------------------------------------------
  // SUPPLIER_INVOICE
  //   Debit:  Cost of Goods Sold / Purchases (net amount)
  //   Debit:  VAT Input (VAT amount)
  //   Credit: Trade Creditors (gross amount including VAT)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'SUPPLIER_INVOICE',
    line_role: 'EXPENSE',
    account_code: '5000',
    direction: 'DEBIT',
    description: 'Cost of goods sold — supplier invoice',
  },
  {
    transaction_type: 'SUPPLIER_INVOICE',
    line_role: 'VAT_INPUT',
    account_code: '1200',
    direction: 'DEBIT',
    description: 'VAT input tax (recoverable)',
  },
  {
    transaction_type: 'SUPPLIER_INVOICE',
    line_role: 'CREDITORS',
    account_code: '2000',
    direction: 'CREDIT',
    description: 'Trade creditors — supplier invoice',
  },

  // -----------------------------------------------------------------------
  // CUSTOMER_PAYMENT
  //   Debit:  Bank Current Account
  //   Credit: Trade Debtors
  // -----------------------------------------------------------------------
  {
    transaction_type: 'CUSTOMER_PAYMENT',
    line_role: 'BANK',
    account_code: '1000',
    direction: 'DEBIT',
    description: 'Bank — customer payment received',
  },
  {
    transaction_type: 'CUSTOMER_PAYMENT',
    line_role: 'DEBTORS',
    account_code: '1100',
    direction: 'CREDIT',
    description: 'Trade debtors — payment applied',
  },

  // -----------------------------------------------------------------------
  // SUPPLIER_PAYMENT
  //   Debit:  Trade Creditors
  //   Credit: Bank Current Account
  // -----------------------------------------------------------------------
  {
    transaction_type: 'SUPPLIER_PAYMENT',
    line_role: 'CREDITORS',
    account_code: '2000',
    direction: 'DEBIT',
    description: 'Trade creditors — payment made',
  },
  {
    transaction_type: 'SUPPLIER_PAYMENT',
    line_role: 'BANK',
    account_code: '1000',
    direction: 'CREDIT',
    description: 'Bank — supplier payment made',
  },

  // -----------------------------------------------------------------------
  // CUSTOMER_CREDIT_NOTE
  //   Credit: Trade Debtors (gross amount, reduces what customer owes)
  //   Debit:  Sales Revenue — Trade (net reversal)
  //   Debit:  VAT Output (VAT reversal)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'CUSTOMER_CREDIT_NOTE',
    line_role: 'DEBTORS',
    account_code: '1100',
    direction: 'CREDIT',
    description: 'Trade debtors — credit note',
  },
  {
    transaction_type: 'CUSTOMER_CREDIT_NOTE',
    line_role: 'REVENUE',
    account_code: '4000',
    direction: 'DEBIT',
    description: 'Sales revenue — credit note reversal',
  },
  {
    transaction_type: 'CUSTOMER_CREDIT_NOTE',
    line_role: 'VAT_OUTPUT',
    account_code: '2100',
    direction: 'DEBIT',
    description: 'VAT output — credit note reversal',
  },

  // -----------------------------------------------------------------------
  // SUPPLIER_CREDIT_NOTE
  //   Debit:  Trade Creditors (gross, reduces what we owe)
  //   Credit: Cost of Goods Sold (net reversal)
  //   Credit: VAT Input (VAT reversal)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'SUPPLIER_CREDIT_NOTE',
    line_role: 'CREDITORS',
    account_code: '2000',
    direction: 'DEBIT',
    description: 'Trade creditors — credit note',
  },
  {
    transaction_type: 'SUPPLIER_CREDIT_NOTE',
    line_role: 'EXPENSE',
    account_code: '5000',
    direction: 'CREDIT',
    description: 'Cost of goods sold — credit note reversal',
  },
  {
    transaction_type: 'SUPPLIER_CREDIT_NOTE',
    line_role: 'VAT_INPUT',
    account_code: '1200',
    direction: 'CREDIT',
    description: 'VAT input — credit note reversal',
  },

  // -----------------------------------------------------------------------
  // BAD_DEBT_WRITE_OFF
  //   Debit:  Bad Debts Written Off (expense)
  //   Credit: Trade Debtors
  // -----------------------------------------------------------------------
  {
    transaction_type: 'BAD_DEBT_WRITE_OFF',
    line_role: 'EXPENSE',
    account_code: '6700',
    direction: 'DEBIT',
    description: 'Bad debts written off',
  },
  {
    transaction_type: 'BAD_DEBT_WRITE_OFF',
    line_role: 'DEBTORS',
    account_code: '1100',
    direction: 'CREDIT',
    description: 'Trade debtors — bad debt write-off',
  },

  // -----------------------------------------------------------------------
  // BANK_RECEIPT
  //   Debit:  Bank Current Account
  //   Credit: Sales Revenue — Other
  // -----------------------------------------------------------------------
  {
    transaction_type: 'BANK_RECEIPT',
    line_role: 'BANK',
    account_code: '1000',
    direction: 'DEBIT',
    description: 'Bank — receipt',
  },
  {
    transaction_type: 'BANK_RECEIPT',
    line_role: 'INCOME',
    account_code: '4100',
    direction: 'CREDIT',
    description: 'Other income — bank receipt',
  },

  // -----------------------------------------------------------------------
  // BANK_PAYMENT
  //   Debit:  Expense (Office Supplies — generic default)
  //   Credit: Bank Current Account
  // -----------------------------------------------------------------------
  {
    transaction_type: 'BANK_PAYMENT',
    line_role: 'EXPENSE',
    account_code: '6200',
    direction: 'DEBIT',
    description: 'Expense — bank payment',
  },
  {
    transaction_type: 'BANK_PAYMENT',
    line_role: 'BANK',
    account_code: '1000',
    direction: 'CREDIT',
    description: 'Bank — payment',
  },

  // -----------------------------------------------------------------------
  // BANK_TRANSFER
  //   Debit:  Bank Deposit Account (transfer in)
  //   Credit: Bank Current Account (transfer out)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'BANK_TRANSFER',
    line_role: 'BANK_TO',
    account_code: '1010',
    direction: 'DEBIT',
    description: 'Bank deposit account — transfer in',
  },
  {
    transaction_type: 'BANK_TRANSFER',
    line_role: 'BANK_FROM',
    account_code: '1000',
    direction: 'CREDIT',
    description: 'Bank current account — transfer out',
  },

  // -----------------------------------------------------------------------
  // PERIOD_END_ACCRUAL
  //   Debit:  Expense (COGS — generic default)
  //   Credit: Accruals
  // -----------------------------------------------------------------------
  {
    transaction_type: 'PERIOD_END_ACCRUAL',
    line_role: 'EXPENSE',
    account_code: '5000',
    direction: 'DEBIT',
    description: 'Expense — period-end accrual',
  },
  {
    transaction_type: 'PERIOD_END_ACCRUAL',
    line_role: 'ACCRUAL',
    account_code: '2300',
    direction: 'CREDIT',
    description: 'Accruals — period-end accrual',
  },

  // -----------------------------------------------------------------------
  // DEPRECIATION
  //   Debit:  Depreciation Expense
  //   Credit: Accumulated Depreciation (contra-asset)
  // -----------------------------------------------------------------------
  {
    transaction_type: 'DEPRECIATION',
    line_role: 'EXPENSE',
    account_code: '6600',
    direction: 'DEBIT',
    description: 'Depreciation expense',
  },
  {
    transaction_type: 'DEPRECIATION',
    line_role: 'CONTRA_ASSET',
    account_code: '1310',
    direction: 'CREDIT',
    description: 'Accumulated depreciation',
  },
];

export async function seed(knex: Knex): Promise<void> {
  await knex('transaction_type_mappings').del();
  await knex('transaction_type_mappings').insert(mappings);
}
