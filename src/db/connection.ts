import pg from 'pg';
import knex from 'knex';
import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// Knex singleton — shared across the application.
//
// In tests, use the 'test' environment by setting NODE_ENV=test.
// The test database runs on port 5433 (see knexfile.ts).
// ---------------------------------------------------------------------------

// By default the pg driver returns DATE columns as JavaScript Date objects,
// which causes string comparisons to break (e.g. 'YYYY-MM-DD' < Date).
// Set the type parser for DATE (OID 1082) to return the raw string instead.
pg.types.setTypeParser(1082, (val: string) => val);

const env = process.env['NODE_ENV'];

const connectionConfig: Knex.Config =
  env === 'test'
    ? {
        client: 'pg',
        connection: process.env['TEST_DATABASE_URL'] || {
          host: 'localhost',
          port: 5433,
          database: 'gl_ledger_test',
          user: 'gl_admin',
          password: 'gl_test_password',
        },
        // Limit pool size in tests to avoid exhausting PostgreSQL max_connections
        // when many test files run concurrently.
        pool: { min: 0, max: 3 },
      }
    : {
        client: 'pg',
        connection: process.env['DATABASE_URL'] || {
          host: 'localhost',
          port: 5432,
          database: 'gl_ledger',
          user: 'gl_admin',
          password: 'gl_dev_password_change_me',
        },
      };

export const db: Knex = knex(connectionConfig);
