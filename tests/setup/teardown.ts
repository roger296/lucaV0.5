/**
 * Jest global teardown — destroys the shared Knex connection pool
 * after all test suites have completed, preventing "too many clients" errors.
 */
export default async function globalTeardown(): Promise<void> {
  // The db singleton may not be importable here because globalTeardown runs
  // in a separate worker; we terminate all idle test-DB connections via a
  // fresh pg client instead.
  const { Client } = await import('pg');
  const client = new Client({
    host: 'localhost',
    port: 5433,
    database: 'gl_ledger_test',
    user: 'gl_admin',
    password: 'gl_test_password',
  });
  try {
    await client.connect();
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = 'gl_ledger_test'
         AND state = 'idle'
         AND pid <> pg_backend_pid()`,
    );
  } catch {
    // Best-effort — ignore errors.
  } finally {
    await client.end().catch(() => { /**/ });
  }
}
