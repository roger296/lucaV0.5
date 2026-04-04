/**
 * Integration tests for gl_create_account and gl_update_account MCP tools (Phase 2, Prompt 2).
 */
import { db } from '../../src/db/connection';
import { handleCreateAccount, handleUpdateAccount } from '../../src/mcp/tools';

// Use test-only codes that won't conflict with seeds
const TEST_CODE = '1051';
const TEST_CODE_2 = '1052';

beforeAll(async () => {
  await db('accounts').whereIn('code', [TEST_CODE, TEST_CODE_2]).del();
});

afterAll(async () => {
  await db('accounts').whereIn('code', [TEST_CODE, TEST_CODE_2]).del();
});

describe('gl_create_account', () => {
  it('creates a new account successfully', async () => {
    const result = await handleCreateAccount({
      code: TEST_CODE,
      name: 'Petty Cash',
      type: 'ASSET',
      category: 'CURRENT_ASSET',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { code: string; name: string; type: string };
    expect(data.code).toBe(TEST_CODE);
    expect(data.name).toBe('Petty Cash');
    expect(data.type).toBe('ASSET');
  });

  it('account appears in the database', async () => {
    const row = await db('accounts').where('code', TEST_CODE).first<{ code: string; active: boolean }>();
    expect(row).toBeDefined();
    expect(row!.active).toBe(true);
  });

  it('returns error when creating duplicate code', async () => {
    const result = await handleCreateAccount({
      code: TEST_CODE,
      name: 'Duplicate',
      type: 'ASSET',
    });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('DUPLICATE_ACCOUNT');
  });

  it('applies default category when not specified', async () => {
    const result = await handleCreateAccount({
      code: TEST_CODE_2,
      name: 'Another Asset',
      type: 'ASSET',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { category: string };
    expect(data.category).toBe('CURRENT_ASSET');
  });

  it('applies default category for EXPENSE type', async () => {
    await db('accounts').where('code', '6999').del();
    const result = await handleCreateAccount({
      code: '6999',
      name: 'Test Expense',
      type: 'EXPENSE',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { category: string };
    expect(data.category).toBe('OVERHEADS');
    await db('accounts').where('code', '6999').del();
  });
});

describe('gl_update_account', () => {
  it('updates account name successfully', async () => {
    const result = await handleUpdateAccount({
      code: TEST_CODE,
      name: 'Petty Cash Updated',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { name: string };
    expect(data.name).toBe('Petty Cash Updated');
  });

  it('deactivates an account', async () => {
    const result = await handleUpdateAccount({
      code: TEST_CODE,
      active: false,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { active: boolean };
    expect(data.active).toBe(false);
  });

  it('returns error for non-existent account', async () => {
    const result = await handleUpdateAccount({
      code: '9997',
      name: 'Ghost Account',
    });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns error when no fields to update', async () => {
    const result = await handleUpdateAccount({ code: TEST_CODE });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('VALIDATION_ERROR');
  });

  it('updates category', async () => {
    const result = await handleUpdateAccount({
      code: TEST_CODE_2,
      category: 'FIXED_ASSET',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { category: string };
    expect(data.category).toBe('FIXED_ASSET');
  });
});
