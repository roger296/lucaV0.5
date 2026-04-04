import Decimal from 'decimal.js';
import { db } from '../db/connection';

export interface BankAccount {
  id: string;
  account_code: string;
  bank_name: string;
  account_name: string;
  sort_code: string | null;
  account_number: string | null;
  iban: string | null;
  currency: string;
  is_active: boolean;
  created_at: string;
}

export interface ImportResult {
  batch_id: string;
  bank_account_id: string;
  total_lines: number;
  imported_lines: number;
  duplicate_lines: number;
  date_from: string;
  date_to: string;
}

export async function registerBankAccount(params: {
  id: string;
  account_code: string;
  bank_name: string;
  account_name: string;
  sort_code?: string;
  account_number?: string;
  iban?: string;
  currency?: string;
}): Promise<BankAccount> {
  // Verify GL account exists
  const account = await db('accounts').where('code', params.account_code).first();
  if (!account) throw new Error(`GL account '${params.account_code}' not found`);

  await db('bank_accounts').insert({
    id: params.id,
    account_code: params.account_code,
    bank_name: params.bank_name,
    account_name: params.account_name,
    sort_code: params.sort_code ?? null,
    account_number: params.account_number ?? null,
    iban: params.iban ?? null,
    currency: params.currency ?? 'GBP',
    is_active: true,
  });

  return db('bank_accounts').where('id', params.id).first<BankAccount>();
}

/** Parse a date string in DD/MM/YYYY or YYYY-MM-DD format → YYYY-MM-DD */
function parseDate(raw: string, fmt: string): string {
  const s = raw.trim();
  if (fmt === 'DD/MM/YYYY' || fmt === 'D/M/YYYY') {
    const parts = s.split('/');
    if (parts.length === 3) {
      const [d, m, y] = parts as [string, string, string];
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  // Default: assume YYYY-MM-DD or similar ISO
  return s;
}

/** Simple CSV parser (no external deps required) */
function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.map((line) => {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    row.push(current.trim());
    return row;
  });
}

async function generateBatchId(bankAccountId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const count = await db('bank_import_batches')
    .where('bank_account_id', bankAccountId)
    .count<[{ count: string }]>('id as count')
    .first();
  const seq = String((parseInt(count?.count ?? '0', 10) + 1)).padStart(3, '0');
  // Include bank account ID to ensure uniqueness across accounts
  return `IMP-${bankAccountId}-${today}-${seq}`;
}

async function insertLines(params: {
  bankAccountId: string;
  batchId: string;
  lines: Array<{
    date: string;
    description: string;
    amount: number;
    balance?: number | null;
    reference?: string | null;
    transaction_type?: string | null;
    counterparty_name?: string | null;
  }>;
}): Promise<{ imported: number; duplicates: number; dateFrom: string; dateTo: string }> {
  const { bankAccountId, batchId, lines } = params;
  let imported = 0;
  let duplicates = 0;
  const dates: string[] = [];

  for (const line of lines) {
    // Duplicate detection: same bank_account_id + date + description + amount
    const existing = await db('bank_statement_lines')
      .where('bank_account_id', bankAccountId)
      .where('date', line.date)
      .where('description', line.description)
      .whereRaw('amount = ?', [new Decimal(line.amount).toFixed(4)])
      .first();

    if (existing) {
      duplicates++;
      continue;
    }

    await db('bank_statement_lines').insert({
      bank_account_id: bankAccountId,
      import_batch_id: batchId,
      date: line.date,
      description: line.description,
      amount: new Decimal(line.amount).toFixed(4),
      balance: line.balance != null ? new Decimal(line.balance).toFixed(4) : null,
      reference: line.reference ?? null,
      transaction_type: line.transaction_type ?? null,
      counterparty_name: line.counterparty_name ?? null,
      match_status: 'UNMATCHED',
    });
    dates.push(line.date);
    imported++;
  }

  dates.sort();
  return {
    imported,
    duplicates,
    dateFrom: dates[0] ?? new Date().toISOString().slice(0, 10),
    dateTo: dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10),
  };
}

export async function importBankStatementCSV(params: {
  bank_account_id: string;
  csv_content: string;
  column_mapping: {
    date: string;
    description: string;
    amount?: string;
    credit?: string;
    debit?: string;
    balance?: string;
    reference?: string;
    type?: string;
  };
  date_format?: string;
  imported_by: string;
}): Promise<ImportResult> {
  const { bank_account_id, csv_content, column_mapping, date_format = 'DD/MM/YYYY', imported_by } = params;

  const bankAccount = await db('bank_accounts').where('id', bank_account_id).first();
  if (!bankAccount) throw new Error(`Bank account '${bank_account_id}' not found`);

  const rows = parseCSV(csv_content);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = (rows[0] as string[]).map((h) => h.trim());
  const getCol = (row: string[], colName: string | undefined): string | undefined => {
    if (!colName) return undefined;
    const idx = headers.indexOf(colName);
    return idx >= 0 ? (row[idx] ?? '').trim() : undefined;
  };

  const parsedLines: Array<{
    date: string;
    description: string;
    amount: number;
    balance?: number | null;
    reference?: string | null;
  }> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as string[];
    const dateStr = getCol(row, column_mapping.date);
    const descStr = getCol(row, column_mapping.description);
    if (!dateStr || !descStr) continue;

    const isoDate = parseDate(dateStr, date_format);

    let amount: number;
    if (column_mapping.amount) {
      const raw = getCol(row, column_mapping.amount) ?? '0';
      amount = parseFloat(raw.replace(/[£,]/g, '')) || 0;
    } else {
      const creditStr = getCol(row, column_mapping.credit) ?? '';
      const debitStr = getCol(row, column_mapping.debit) ?? '';
      const credit = parseFloat(creditStr.replace(/[£,]/g, '')) || 0;
      const debit = parseFloat(debitStr.replace(/[£,]/g, '')) || 0;
      // Positive = credit (money in), negative = debit (money out)
      amount = credit > 0 ? credit : debit > 0 ? -debit : 0;
    }

    const balanceStr = getCol(row, column_mapping.balance);
    const balance = balanceStr ? parseFloat(balanceStr.replace(/[£,]/g, '')) || null : null;
    const reference = getCol(row, column_mapping.reference) ?? null;

    parsedLines.push({ date: isoDate, description: descStr, amount, balance, reference });
  }

  const batchId = await generateBatchId(bank_account_id);
  const { imported, duplicates, dateFrom, dateTo } = await insertLines({
    bankAccountId: bank_account_id,
    batchId,
    lines: parsedLines,
  });

  await db('bank_import_batches').insert({
    id: batchId,
    bank_account_id,
    source_format: 'CSV',
    total_lines: parsedLines.length,
    imported_lines: imported,
    duplicate_lines: duplicates,
    date_from: dateFrom,
    date_to: dateTo,
    imported_by,
  });

  return { batch_id: batchId, bank_account_id, total_lines: parsedLines.length, imported_lines: imported, duplicate_lines: duplicates, date_from: dateFrom, date_to: dateTo };
}

export async function importBankStatementJSON(params: {
  bank_account_id: string;
  lines: Array<{
    date: string;
    description: string;
    amount: number;
    balance?: number;
    reference?: string;
    transaction_type?: string;
    counterparty_name?: string;
  }>;
  imported_by: string;
}): Promise<ImportResult> {
  const { bank_account_id, lines, imported_by } = params;

  const bankAccount = await db('bank_accounts').where('id', bank_account_id).first();
  if (!bankAccount) throw new Error(`Bank account '${bank_account_id}' not found`);

  const batchId = await generateBatchId(bank_account_id);
  const { imported, duplicates, dateFrom, dateTo } = await insertLines({
    bankAccountId: bank_account_id,
    batchId,
    lines,
  });

  await db('bank_import_batches').insert({
    id: batchId,
    bank_account_id,
    source_format: 'JSON',
    total_lines: lines.length,
    imported_lines: imported,
    duplicate_lines: duplicates,
    date_from: dateFrom,
    date_to: dateTo,
    imported_by,
  });

  return { batch_id: batchId, bank_account_id, total_lines: lines.length, imported_lines: imported, duplicate_lines: duplicates, date_from: dateFrom, date_to: dateTo };
}
