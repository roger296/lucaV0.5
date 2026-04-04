/**
 * Integration tests for bank statement import infrastructure (Phase 2, Prompt 6).
 */
import { db } from '../../src/db/connection';
import { registerBankAccount, importBankStatementCSV, importBankStatementJSON } from '../../src/engine/bank-import';
import { handleRegisterBankAccount, handleImportBankStatement } from '../../src/mcp/tools';

const TEST_BANK_ID = 'TEST-BANK-P6';
const TEST_BANK_ID_2 = 'TEST-BANK-P6B';

const SAMPLE_CSV = `Date,Description,Money In,Money Out,Balance
03/04/2026,CUSTOMER PAYMENT - ACME LTD,1200.00,,15200.00
03/04/2026,DIRECT DEBIT - HMRC VAT,,850.00,14350.00
02/04/2026,FASTER PAYMENT - SMITH & CO,500.00,,14850.00
01/04/2026,STANDING ORDER - OFFICE RENT,,2000.00,14350.00`;

const COL_MAPPING = {
  date: 'Date',
  description: 'Description',
  credit: 'Money In',
  debit: 'Money Out',
  balance: 'Balance',
};

beforeAll(async () => {
  // Clean up in FK order
  await db('bank_statement_lines').whereIn('bank_account_id', [TEST_BANK_ID, TEST_BANK_ID_2]).del();
  await db('bank_import_batches').whereIn('bank_account_id', [TEST_BANK_ID, TEST_BANK_ID_2]).del();
  await db('bank_accounts').whereIn('id', [TEST_BANK_ID, TEST_BANK_ID_2]).del();
});

afterAll(async () => {
  await db('bank_statement_lines').whereIn('bank_account_id', [TEST_BANK_ID, TEST_BANK_ID_2]).del();
  await db('bank_import_batches').whereIn('bank_account_id', [TEST_BANK_ID, TEST_BANK_ID_2]).del();
  await db('bank_accounts').whereIn('id', [TEST_BANK_ID, TEST_BANK_ID_2]).del();
});

describe('registerBankAccount', () => {
  it('registers a bank account linked to GL account 1000', async () => {
    const result = await registerBankAccount({
      id: TEST_BANK_ID,
      account_code: '1000',
      bank_name: 'Test Bank',
      account_name: 'Business Current Account',
      sort_code: '40-47-84',
      account_number: '12345678',
    });
    expect(result.id).toBe(TEST_BANK_ID);
    expect(result.account_code).toBe('1000');
  });

  it('throws for unknown GL account', async () => {
    await expect(registerBankAccount({
      id: 'FAIL-BANK',
      account_code: '9993',
      bank_name: 'Bad',
      account_name: 'Bad Account',
    })).rejects.toThrow();
  });
});

describe('importBankStatementCSV', () => {
  it('imports 4 lines from CSV with separate credit/debit columns', async () => {
    const result = await importBankStatementCSV({
      bank_account_id: TEST_BANK_ID,
      csv_content: SAMPLE_CSV,
      column_mapping: COL_MAPPING,
      date_format: 'DD/MM/YYYY',
      imported_by: 'test',
    });
    expect(result.total_lines).toBe(4);
    expect(result.imported_lines).toBe(4);
    expect(result.duplicate_lines).toBe(0);
    expect(result.date_from).toBe('2026-04-01');
    expect(result.date_to).toBe('2026-04-03');
  });

  it('all imported lines have UNMATCHED status', async () => {
    const lines = await db('bank_statement_lines').where('bank_account_id', TEST_BANK_ID);
    expect(lines.length).toBe(4);
    for (const line of lines as Array<{ match_status: string }>) {
      expect(line.match_status).toBe('UNMATCHED');
    }
  });

  it('importing the same CSV again returns 4 duplicates and 0 new lines', async () => {
    const result = await importBankStatementCSV({
      bank_account_id: TEST_BANK_ID,
      csv_content: SAMPLE_CSV,
      column_mapping: COL_MAPPING,
      date_format: 'DD/MM/YYYY',
      imported_by: 'test',
    });
    expect(result.imported_lines).toBe(0);
    expect(result.duplicate_lines).toBe(4);
  });
});

describe('importBankStatementJSON', () => {
  beforeAll(async () => {
    await registerBankAccount({
      id: TEST_BANK_ID_2,
      account_code: '1000',
      bank_name: 'Test Bank 2',
      account_name: 'Savings Account',
    });
  });

  it('imports 2 lines via JSON format', async () => {
    const result = await importBankStatementJSON({
      bank_account_id: TEST_BANK_ID_2,
      lines: [
        { date: '2026-04-05', description: 'PAYMENT IN', amount: 500 },
        { date: '2026-04-06', description: 'DIRECT DEBIT', amount: -250, reference: 'DD-001' },
      ],
      imported_by: 'test',
    });
    expect(result.total_lines).toBe(2);
    expect(result.imported_lines).toBe(2);
    expect(result.duplicate_lines).toBe(0);
  });

  it('JSON imported lines stored correctly', async () => {
    const lines = await db('bank_statement_lines').where('bank_account_id', TEST_BANK_ID_2).orderBy('date');
    expect(lines.length).toBe(2);
    expect((lines[1] as Record<string, unknown>)['reference']).toBe('DD-001');
  });
});

describe('gl_register_bank_account and gl_import_bank_statement MCP tools', () => {
  const MCP_BANK_ID = 'MCP-BANK-P6';

  afterAll(async () => {
    await db('bank_statement_lines').where('bank_account_id', MCP_BANK_ID).del();
    await db('bank_import_batches').where('bank_account_id', MCP_BANK_ID).del();
    await db('bank_accounts').where('id', MCP_BANK_ID).del();
  });

  it('gl_register_bank_account creates account via MCP', async () => {
    const result = await handleRegisterBankAccount({
      id: MCP_BANK_ID,
      account_code: '1000',
      bank_name: 'MCP Test Bank',
      account_name: 'MCP Account',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { id: string };
    expect(data.id).toBe(MCP_BANK_ID);
  });

  it('gl_import_bank_statement imports CSV via MCP', async () => {
    const result = await handleImportBankStatement({
      bank_account_id: MCP_BANK_ID,
      format: 'CSV',
      csv_content: SAMPLE_CSV,
      column_mapping: COL_MAPPING,
      date_format: 'DD/MM/YYYY',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { imported_lines: number };
    expect(data.imported_lines).toBe(4);
  });
});
