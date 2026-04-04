import type { Knex } from 'knex';

interface AccountRow {
  code: string;
  name: string;
  type: string;
  category: string | null;
  active: boolean;
}

const accounts: AccountRow[] = [
  // --- ASSETS ---
  { code: '1000', name: 'Bank Current Account', type: 'ASSET', category: 'CURRENT_ASSET', active: true },
  { code: '1010', name: 'Bank Deposit Account', type: 'ASSET', category: 'CURRENT_ASSET', active: true },
  { code: '1100', name: 'Trade Debtors', type: 'ASSET', category: 'CURRENT_ASSET', active: true },
  { code: '1200', name: 'VAT Input (Recoverable)', type: 'ASSET', category: 'CURRENT_ASSET', active: true },
  { code: '1300', name: 'Fixed Assets — Cost', type: 'ASSET', category: 'FIXED_ASSET', active: true },
  { code: '1310', name: 'Fixed Assets — Accumulated Depreciation', type: 'ASSET', category: 'FIXED_ASSET', active: true },

  // --- LIABILITIES ---
  { code: '2000', name: 'Trade Creditors', type: 'LIABILITY', category: 'CURRENT_LIABILITY', active: true },
  { code: '2100', name: 'VAT Output', type: 'LIABILITY', category: 'CURRENT_LIABILITY', active: true },
  { code: '2200', name: 'PAYE/NI Payable', type: 'LIABILITY', category: 'CURRENT_LIABILITY', active: true },
  { code: '2300', name: 'Accruals', type: 'LIABILITY', category: 'CURRENT_LIABILITY', active: true },

  // --- EQUITY ---
  { code: '3000', name: 'Share Capital', type: 'EQUITY', category: null, active: true },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY', category: null, active: true },

  // --- REVENUE ---
  { code: '4000', name: 'Sales Revenue — Trade', type: 'REVENUE', category: null, active: true },
  { code: '4100', name: 'Sales Revenue — Other', type: 'REVENUE', category: null, active: true },

  // --- EXPENSES: Direct costs ---
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', category: 'DIRECT_COSTS', active: true },
  { code: '5100', name: 'Purchases — Raw Materials', type: 'EXPENSE', category: 'DIRECT_COSTS', active: true },

  // --- EXPENSES: Overheads ---
  { code: '6000', name: 'Wages and Salaries', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6100', name: 'Rent and Rates', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6200', name: 'Office Supplies', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6300', name: 'Professional Fees', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6400', name: 'Travel and Subsistence', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6500', name: 'Marketing and Advertising', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6600', name: 'Depreciation', type: 'EXPENSE', category: 'OVERHEADS', active: true },
  { code: '6700', name: 'Bad Debts Written Off', type: 'EXPENSE', category: 'OVERHEADS', active: true },

  // --- REVENUE: Other income ---
  { code: '7000', name: 'Bank Interest Received', type: 'REVENUE', category: 'OTHER_INCOME', active: true },

  // --- EXPENSES: Finance costs ---
  { code: '7100', name: 'Bank Charges', type: 'EXPENSE', category: 'FINANCE_COSTS', active: true },

  // --- REVENUE: FX ---
  { code: '7200', name: 'FX Gains and Losses', type: 'REVENUE', category: 'OTHER_INCOME', active: true },
];

export async function seed(knex: Knex): Promise<void> {
  await knex('accounts')
    .insert(accounts)
    .onConflict('code')
    .merge(['name', 'type', 'category', 'active']);
}
