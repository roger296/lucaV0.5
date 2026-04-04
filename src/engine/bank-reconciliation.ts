import Decimal from 'decimal.js';
import { db } from '../db/connection';
import { postTransaction } from './post';
import type { TransactionSubmission } from './types';

export interface MatchCandidate {
  statement_line_id: string;
  transaction_id: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  match_reason: string;
}

export interface ReconciliationResult {
  bank_account_id: string;
  total_statement_lines: number;
  auto_matched: number;
  suggested_matches: number;
  unmatched: number;
  matches: MatchCandidate[];
}

interface StatementLineRow {
  id: string;
  bank_account_id: string;
  date: string;
  description: string;
  amount: string;
  reference: string | null;
  match_status: string;
}

interface TxnLineRow {
  transaction_id: string;
  date: string;
  reference: string | null;
  line_amount: string;  // debit or credit on the bank GL account
}

export async function runAutoMatch(params: {
  bank_account_id: string;
  date_from?: string;
  date_to?: string;
  auto_confirm_high_confidence?: boolean;
}): Promise<ReconciliationResult> {
  const { bank_account_id, date_from, date_to, auto_confirm_high_confidence = true } = params;

  // Load bank account to get GL account code
  const bankAccount = await db('bank_accounts').where('id', bank_account_id).first<{ id: string; account_code: string }>();
  if (!bankAccount) throw new Error(`Bank account '${bank_account_id}' not found`);

  // Load UNMATCHED statement lines
  let stmtQuery = db('bank_statement_lines')
    .where('bank_account_id', bank_account_id)
    .where('match_status', 'UNMATCHED');
  if (date_from) stmtQuery = stmtQuery.where('date', '>=', date_from);
  if (date_to) stmtQuery = stmtQuery.where('date', '<=', date_to);
  const stmtLines = await stmtQuery.select<StatementLineRow[]>('*');

  if (stmtLines.length === 0) {
    return { bank_account_id, total_statement_lines: 0, auto_matched: 0, suggested_matches: 0, unmatched: 0, matches: [] };
  }

  // Determine date range for GL query (±5 days buffer)
  const allDates = stmtLines.map((l) => l.date).sort();
  const minDate = allDates[0]!;
  const maxDate = allDates[allDates.length - 1]!;

  const bufferStart = new Date(minDate);
  bufferStart.setDate(bufferStart.getDate() - 5);
  const bufferEnd = new Date(maxDate);
  bufferEnd.setDate(bufferEnd.getDate() + 5);

  // Load committed GL transactions that touch the bank GL account
  const glLines = await db('transaction_lines')
    .join('transactions', 'transaction_lines.transaction_id', 'transactions.transaction_id')
    .where('transaction_lines.account_code', bankAccount.account_code)
    .where('transactions.status', 'COMMITTED')
    .where('transactions.date', '>=', bufferStart.toISOString().slice(0, 10))
    .where('transactions.date', '<=', bufferEnd.toISOString().slice(0, 10))
    .select<TxnLineRow[]>(
      'transactions.transaction_id',
      'transactions.date',
      'transactions.reference',
      db.raw('(transaction_lines.debit - transaction_lines.credit) as line_amount'),
    );

  // Track which GL transactions are already matched (in this run)
  const matchedGlTxns = new Set<string>();

  // Also load already-matched GL transactions from DB
  const alreadyMatched = await db('bank_statement_lines')
    .where('bank_account_id', bank_account_id)
    .whereIn('match_status', ['MATCHED', 'CONFIRMED'])
    .whereNotNull('matched_transaction_id')
    .select<Array<{ matched_transaction_id: string }>>('matched_transaction_id');
  alreadyMatched.forEach((r) => matchedGlTxns.add(r.matched_transaction_id));

  const matches: MatchCandidate[] = [];
  let autoMatched = 0;
  let suggested = 0;

  for (const stmtLine of stmtLines) {
    const stmtAmount = new Decimal(stmtLine.amount);

    // Statement amount: positive = credit (money in) = debit on bank GL account
    // negative = debit (money out) = credit on bank GL account
    // GL line_amount = debit - credit. Positive means money in (matches positive stmt).

    let match: MatchCandidate | null = null;

    // Strategy 1: Reference + Amount (HIGH)
    if (stmtLine.reference && stmtLine.reference.trim() !== '') {
      const candidate = glLines.find(
        (gl) =>
          !matchedGlTxns.has(gl.transaction_id) &&
          gl.reference === stmtLine.reference &&
          new Decimal(gl.line_amount).abs().equals(stmtAmount.abs()),
      );
      if (candidate) {
        match = { statement_line_id: stmtLine.id, transaction_id: candidate.transaction_id, confidence: 'HIGH', match_reason: 'Reference and amount match' };
      }
    }

    // Strategy 2: Exact Amount + Close Date (MEDIUM)
    if (!match) {
      const closeDateCandidates = glLines.filter(
        (gl) => {
          if (matchedGlTxns.has(gl.transaction_id)) return false;
          if (!new Decimal(gl.line_amount).abs().equals(stmtAmount.abs())) return false;
          const glDate = new Date(gl.date);
          const stDate = new Date(stmtLine.date);
          const diffDays = Math.abs((glDate.getTime() - stDate.getTime()) / 86400000);
          return diffDays <= 3;
        },
      );
      if (closeDateCandidates.length === 1) {
        match = { statement_line_id: stmtLine.id, transaction_id: closeDateCandidates[0]!.transaction_id, confidence: 'MEDIUM', match_reason: 'Amount and date match (within 3 days)' };
      }
    }

    // Strategy 3: Amount only (LOW)
    if (!match) {
      const amountCandidates = glLines.filter(
        (gl) =>
          !matchedGlTxns.has(gl.transaction_id) &&
          new Decimal(gl.line_amount).abs().equals(stmtAmount.abs()),
      );
      if (amountCandidates.length === 1) {
        match = { statement_line_id: stmtLine.id, transaction_id: amountCandidates[0]!.transaction_id, confidence: 'LOW', match_reason: 'Amount matches (single candidate)' };
      }
    }

    if (match) {
      matches.push(match);
      matchedGlTxns.add(match.transaction_id);

      if (match.confidence === 'HIGH' && auto_confirm_high_confidence) {
        await db('bank_statement_lines').where('id', stmtLine.id).update({
          match_status: 'CONFIRMED',
          matched_transaction_id: match.transaction_id,
          matched_by: 'auto',
          matched_at: new Date().toISOString(),
          match_notes: match.match_reason,
        });
        autoMatched++;
      } else {
        await db('bank_statement_lines').where('id', stmtLine.id).update({
          match_status: 'MATCHED',
          matched_transaction_id: match.transaction_id,
          matched_by: 'auto',
          matched_at: new Date().toISOString(),
          match_notes: match.match_reason,
        });
        suggested++;
      }
    }
  }

  const unmatched = stmtLines.length - autoMatched - suggested;

  return { bank_account_id, total_statement_lines: stmtLines.length, auto_matched: autoMatched, suggested_matches: suggested, unmatched, matches };
}

export async function confirmMatch(params: {
  statement_line_id: string;
  transaction_id: string;
  confirmed_by: string;
  notes?: string;
}): Promise<void> {
  const { statement_line_id, transaction_id, confirmed_by, notes } = params;
  const line = await db('bank_statement_lines').where('id', statement_line_id).first<{ id: string }>();
  if (!line) throw new Error(`Statement line '${statement_line_id}' not found`);

  await db('bank_statement_lines').where('id', statement_line_id).update({
    match_status: 'CONFIRMED',
    matched_transaction_id: transaction_id,
    matched_by: confirmed_by,
    matched_at: new Date().toISOString(),
    match_notes: notes ?? null,
  });
}

export async function postAndMatch(params: {
  statement_line_id: string;
  transaction_type: string;
  description: string;
  account_code?: string;
  counterparty?: { trading_account_id?: string; contact_id?: string };
  confirmed_by: string;
}): Promise<{ transaction_id: string; match_status: 'CONFIRMED' }> {
  const { statement_line_id, transaction_type, description, account_code, counterparty, confirmed_by } = params;

  const line = await db('bank_statement_lines')
    .where('id', statement_line_id)
    .first<{ id: string; bank_account_id: string; date: string; amount: string; description: string; reference: string | null }>();
  if (!line) throw new Error(`Statement line '${statement_line_id}' not found`);

  const bankAccount = await db('bank_accounts')
    .where('id', line.bank_account_id)
    .first<{ account_code: string }>();
  if (!bankAccount) throw new Error(`Bank account not found for line`);

  // Determine the period from the line date
  const periodId = line.date.slice(0, 7); // YYYY-MM

  const submission: TransactionSubmission = {
    transaction_type: transaction_type as TransactionSubmission['transaction_type'],
    date: line.date,
    period_id: periodId,
    description,
    amount: Math.abs(parseFloat(line.amount)),
    reference: line.reference ?? undefined,
    counterparty,
  };

  const result = await postTransaction(submission);
  let transactionId: string;
  if (result.status === 'COMMITTED') {
    transactionId = (result as { status: string; transaction_id: string }).transaction_id;
  } else {
    transactionId = (result as { status: string; staging_id: string }).staging_id;
  }

  await db('bank_statement_lines').where('id', statement_line_id).update({
    match_status: 'CONFIRMED',
    matched_transaction_id: transactionId,
    matched_by: confirmed_by,
    matched_at: new Date().toISOString(),
    match_notes: `Posted as ${transaction_type}`,
  });

  return { transaction_id: transactionId, match_status: 'CONFIRMED' };
}

export async function excludeLine(params: {
  statement_line_id: string;
  reason: string;
  excluded_by: string;
}): Promise<void> {
  const { statement_line_id, reason, excluded_by } = params;
  const line = await db('bank_statement_lines').where('id', statement_line_id).first();
  if (!line) throw new Error(`Statement line '${statement_line_id}' not found`);

  await db('bank_statement_lines').where('id', statement_line_id).update({
    match_status: 'EXCLUDED',
    matched_by: excluded_by,
    matched_at: new Date().toISOString(),
    match_notes: reason,
  });
}

export async function getReconciliationStatus(params: {
  bank_account_id: string;
  date_from?: string;
  date_to?: string;
}): Promise<{
  total_lines: number;
  matched: number;
  confirmed: number;
  excluded: number;
  unmatched: number;
  gl_balance: string;
  statement_balance: string;
  difference: string;
}> {
  const { bank_account_id, date_from, date_to } = params;

  const bankAccount = await db('bank_accounts').where('id', bank_account_id).first<{ account_code: string }>();
  if (!bankAccount) throw new Error(`Bank account '${bank_account_id}' not found`);

  let query = db('bank_statement_lines').where('bank_account_id', bank_account_id);
  if (date_from) query = query.where('date', '>=', date_from);
  if (date_to) query = query.where('date', '<=', date_to);

  const lines = await query.select<Array<{ match_status: string; amount: string }>>('match_status', 'amount');

  let total = 0, matchedCount = 0, confirmedCount = 0, excludedCount = 0, unmatchedCount = 0;
  let stmtBalance = new Decimal(0);

  for (const line of lines) {
    total++;
    stmtBalance = stmtBalance.plus(new Decimal(line.amount));
    switch (line.match_status) {
      case 'MATCHED': matchedCount++; break;
      case 'CONFIRMED': confirmedCount++; break;
      case 'EXCLUDED': excludedCount++; break;
      default: unmatchedCount++;
    }
  }

  // GL balance: sum of committed transaction lines on this bank GL account
  const glResult = await db('transaction_lines')
    .join('transactions', 'transaction_lines.transaction_id', 'transactions.transaction_id')
    .where('transaction_lines.account_code', bankAccount.account_code)
    .where('transactions.status', 'COMMITTED')
    .select(
      db.raw('COALESCE(SUM(transaction_lines.debit), 0) as total_debit'),
      db.raw('COALESCE(SUM(transaction_lines.credit), 0) as total_credit'),
    )
    .first<{ total_debit: string; total_credit: string }>();

  const glBalance = new Decimal(glResult?.total_debit ?? '0').minus(glResult?.total_credit ?? '0');
  const difference = glBalance.minus(stmtBalance);

  return {
    total_lines: total,
    matched: matchedCount,
    confirmed: confirmedCount,
    excluded: excludedCount,
    unmatched: unmatchedCount,
    gl_balance: glBalance.toFixed(2),
    statement_balance: stmtBalance.toFixed(2),
    difference: difference.toFixed(2),
  };
}
