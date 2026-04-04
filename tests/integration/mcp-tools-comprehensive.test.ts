/**
 * Comprehensive MCP tool tests (Prompt 9).
 *
 * Calls handler functions directly to verify correct results and error handling.
 */

import { db } from '../../src/db/connection';
import {
  handlePostTransaction,
  handleQueryJournal,
  handleGetTrialBalance,
  handleGetAccountBalance,
  handleListAccounts,
  handleGetPeriodStatus,
  handleApproveTransaction,
  handleRejectTransaction,
  handleVerifyChain,
  handleGetProfitAndLoss,
  handleGetBalanceSheet,
  handleGetAgedDebtors,
  handleGetAgedCreditors,
  handleGetVatReturn,
  handleYearEndClose,
  handleVerifyChainSequence,
  handleGetMerkleProof,
  handleFxRevaluation,
  handleAddExchangeRate,
  handleGetExchangeRate,
  handleRecoverMissingTransactions,
} from '../../src/mcp/tools';

const TEST_PERIOD = '2088-11';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();
  await db('exchange_rates').where('from_currency', 'CHF').where('effective_date', '2088-11-01').del();

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2088-11-01',
    end_date: '2088-11-30',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  const { ChainWriter } = await import('../../src/chain/writer');
  const writer = new ChainWriter({
    chainDir: 'chains/default',
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
  await writer.createPeriodFile(TEST_PERIOD, null, {});
});

afterAll(async () => {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();
  await db('exchange_rates').where('from_currency', 'CHF').where('effective_date', '2088-11-01').del();

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const fp = path.join('chains/default', `${TEST_PERIOD}.chain.jsonl`);
  try { await fs.chmod(fp, 0o644); } catch { /**/ }
  try { await fs.unlink(fp); } catch { /**/ }
});

// ---------------------------------------------------------------------------
// gl_list_accounts
// ---------------------------------------------------------------------------

describe('gl_list_accounts', () => {
  it('returns accounts list', async () => {
    const result = await handleListAccounts({ active_only: true });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('filters by type', async () => {
    const result = await handleListAccounts({ type: 'ASSET', active_only: true });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as Array<{ type: string }>;
    expect(data.every((a) => a.type === 'ASSET')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_get_period_status
// ---------------------------------------------------------------------------

describe('gl_get_period_status', () => {
  it('returns period status for known period', async () => {
    const result = await handleGetPeriodStatus({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { status: string; period_id: string };
    expect(data.period_id).toBe(TEST_PERIOD);
    expect(data.status).toBe('OPEN');
  });

  it('returns error for unknown period', async () => {
    const result = await handleGetPeriodStatus({ period_id: '9999-99' });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('PERIOD_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// gl_post_transaction
// ---------------------------------------------------------------------------

describe('gl_post_transaction', () => {
  it('posts a CUSTOMER_PAYMENT and returns committed or staged result', async () => {
    const result = await handlePostTransaction({
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2088-11-05',
      period_id: TEST_PERIOD,
      amount: 500,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { status: string };
    expect(['COMMITTED', 'STAGED']).toContain(data.status);
  });

  it('returns error for unbalanced MANUAL_JOURNAL', async () => {
    const result = await handlePostTransaction({
      transaction_type: 'MANUAL_JOURNAL',
      date: '2088-11-05',
      period_id: TEST_PERIOD,
      lines: [
        { account_code: '1000', description: 'x', debit: 100, credit: 0 },
        { account_code: '3000', description: 'y', debit: 0, credit: 50 },
      ],
    });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_query_journal
// ---------------------------------------------------------------------------

describe('gl_query_journal', () => {
  it('returns transactions for the period', async () => {
    const result = await handleQueryJournal({ period_id: TEST_PERIOD, limit: 50 });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_get_trial_balance
// ---------------------------------------------------------------------------

describe('gl_get_trial_balance', () => {
  it('returns trial balance for the period', async () => {
    const result = await handleGetTrialBalance({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      period_id: string;
      balanced: boolean;
    };
    expect(data.period_id).toBe(TEST_PERIOD);
    expect(typeof data.balanced).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// gl_get_account_balance
// ---------------------------------------------------------------------------

describe('gl_get_account_balance', () => {
  it('returns balance for a known account', async () => {
    const result = await handleGetAccountBalance({ account_code: '1000' });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { account_code: string };
    expect(data.account_code).toBe('1000');
  });

  it('returns error for unknown account', async () => {
    const result = await handleGetAccountBalance({ account_code: '9998' });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('ACCOUNT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// gl_verify_chain
// ---------------------------------------------------------------------------

describe('gl_verify_chain', () => {
  it('verifies the chain for the test period', async () => {
    const result = await handleVerifyChain({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { valid: boolean };
    expect(data.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_verify_chain_sequence
// ---------------------------------------------------------------------------

describe('gl_verify_chain_sequence', () => {
  it('verifies chain sequence for the test period', async () => {
    const result = await handleVerifyChainSequence({ period_ids: [TEST_PERIOD] });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { valid: boolean };
    expect(data.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_get_profit_and_loss
// ---------------------------------------------------------------------------

describe('gl_get_profit_and_loss', () => {
  it('returns P&L for the period', async () => {
    const result = await handleGetProfitAndLoss({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { period_id: string };
    expect(data.period_id).toBe(TEST_PERIOD);
  });
});

// ---------------------------------------------------------------------------
// gl_get_balance_sheet
// ---------------------------------------------------------------------------

describe('gl_get_balance_sheet', () => {
  it('returns balance sheet', async () => {
    const result = await handleGetBalanceSheet({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { sections: unknown; total_assets: string };
    expect(data).toHaveProperty('total_assets');
  });
});

// ---------------------------------------------------------------------------
// gl_get_aged_debtors / gl_get_aged_creditors
// ---------------------------------------------------------------------------

describe('gl_get_aged_debtors', () => {
  it('returns aged debtors report', async () => {
    const result = await handleGetAgedDebtors({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { as_at_date: string };
    expect(data).toHaveProperty('as_at_date');
  });
});

describe('gl_get_aged_creditors', () => {
  it('returns aged creditors report', async () => {
    const result = await handleGetAgedCreditors({});
    expect(result.isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// gl_get_vat_return
// ---------------------------------------------------------------------------

describe('gl_get_vat_return', () => {
  it('returns VAT return for a quarter', async () => {
    const result = await handleGetVatReturn({ quarter_end: '2088-11' });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { quarter_end: string };
    expect(data).toHaveProperty('quarter_end');
  });
});

// ---------------------------------------------------------------------------
// gl_add_exchange_rate / gl_get_exchange_rate
// ---------------------------------------------------------------------------

describe('gl_add_exchange_rate', () => {
  it('adds a rate and retrieves it', async () => {
    const addResult = await handleAddExchangeRate({
      from_currency: 'CHF',
      to_currency: 'GBP',
      rate: '0.88',
      effective_date: '2088-11-01',
    });
    expect(addResult.isError).toBeFalsy();

    const getResult = await handleGetExchangeRate({
      from_currency: 'CHF',
      to_currency: 'GBP',
      date: '2088-11-15',
    });
    expect(getResult.isError).toBeFalsy();
    const data = JSON.parse(getResult.content[0]!.text) as { rate: string };
    expect(parseFloat(data.rate)).toBeCloseTo(0.88, 2);
  });
});

describe('gl_get_exchange_rate', () => {
  it('returns error for missing rate', async () => {
    const result = await handleGetExchangeRate({
      from_currency: 'XXX',
      to_currency: 'GBP',
      date: '2088-11-01',
    });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('RATE_NOT_FOUND');
  });

  it('returns synthetic rate 1 for same-currency pair', async () => {
    const result = await handleGetExchangeRate({
      from_currency: 'GBP',
      to_currency: 'GBP',
      date: '2088-11-01',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { rate: string };
    expect(data.rate).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// gl_fx_revaluation
// ---------------------------------------------------------------------------

describe('gl_fx_revaluation', () => {
  it('preview mode returns entries and submissions', async () => {
    const result = await handleFxRevaluation({
      period_id: TEST_PERIOD,
      closing_rates: { USD: '0.80' },
      post: false,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { preview: boolean; entries: unknown[] };
    expect(data.preview).toBe(true);
    expect(Array.isArray(data.entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_recover_missing_transactions
// ---------------------------------------------------------------------------

describe('gl_recover_missing_transactions', () => {
  it('runs without error and returns a result', async () => {
    const result = await handleRecoverMissingTransactions({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      periods_checked: number;
      missing_transactions_found: number;
      transactions_recovered: number;
    };
    expect(typeof data.periods_checked).toBe('number');
    expect(typeof data.missing_transactions_found).toBe('number');
    expect(typeof data.transactions_recovered).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// gl_approve_transaction / gl_reject_transaction
// ---------------------------------------------------------------------------

describe('gl_approve_transaction / gl_reject_transaction', () => {
  it('returns error for non-existent staging entry', async () => {
    const approveResult = await handleApproveTransaction({ staging_id: 'STG-nonexistent' });
    expect(approveResult.isError).toBe(true);

    const rejectResult = await handleRejectTransaction({ staging_id: 'STG-nonexistent', reason: 'test' });
    expect(rejectResult.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_year_end_close (error case — periods don't exist)
// ---------------------------------------------------------------------------

describe('gl_year_end_close', () => {
  it('returns an error when periods do not exist', async () => {
    const result = await handleYearEndClose({
      financial_year_end: '2099-03',
      new_year_first_period: '2099-04',
    });
    // Will fail because the period doesn't exist or isn't closed
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gl_get_merkle_proof (error case for missing transaction)
// ---------------------------------------------------------------------------

describe('gl_get_merkle_proof', () => {
  it('returns error for missing transaction sequence', async () => {
    const result = await handleGetMerkleProof({ period_id: TEST_PERIOD, transaction_sequence: 99999 });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('NOT_FOUND');
  });
});
