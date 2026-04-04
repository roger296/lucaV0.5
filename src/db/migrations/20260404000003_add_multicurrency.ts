import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// Migration: add multi-currency columns to transactions + transaction_lines,
// and create the exchange_rates table.
// ---------------------------------------------------------------------------

export async function up(knex: Knex): Promise<void> {
  // ── Add exchange_rate and base_currency to transactions ───────────────────
  await knex.schema.alterTable('transactions', (t) => {
    t.decimal('exchange_rate', 19, 8).notNullable().defaultTo(1);
    t.string('base_currency', 3).notNullable().defaultTo('GBP');
  });

  // ── Add base_debit and base_credit to transaction_lines ──────────────────
  await knex.schema.alterTable('transaction_lines', (t) => {
    t.decimal('base_debit', 19, 4).notNullable().defaultTo(0);
    t.decimal('base_credit', 19, 4).notNullable().defaultTo(0);
  });

  // Backfill: existing GBP transactions have base = transaction amounts.
  await knex.raw(`
    UPDATE transaction_lines
    SET base_debit = debit, base_credit = credit
  `);

  // ── Create exchange_rates table ───────────────────────────────────────────
  await knex.schema.createTable('exchange_rates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('from_currency', 3).notNullable();
    t.string('to_currency', 3).notNullable();
    t.decimal('rate', 19, 8).notNullable();
    t.date('effective_date').notNullable();
    t.string('source', 100).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['from_currency', 'to_currency', 'effective_date']);
    t.index(['from_currency', 'to_currency', 'effective_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('exchange_rates');
  await knex.schema.alterTable('transaction_lines', (t) => {
    t.dropColumn('base_debit');
    t.dropColumn('base_credit');
  });
  await knex.schema.alterTable('transactions', (t) => {
    t.dropColumn('exchange_rate');
    t.dropColumn('base_currency');
  });
}
