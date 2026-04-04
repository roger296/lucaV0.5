import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (table) => {
    // Format: TXN-YYYY-MM-NNNNN
    table.string('transaction_id', 50).primary();
    table.string('period_id', 7).notNullable().references('period_id').inTable('periods');
    table.string('transaction_type', 50).notNullable();
    table.string('reference', 200).nullable();
    table.date('date').notNullable();
    // GBP only for MVP
    table.string('currency', 3).notNullable().defaultTo('GBP');
    table.text('description').nullable();
    // Counterparty fields (from the chain payload)
    table.string('counterparty_trading_account_id', 100).nullable();
    table.string('counterparty_contact_id', 100).nullable();
    // Source module info
    table.string('source_module_id', 100).nullable();
    table.string('source_module_reference', 200).nullable();
    // Idempotency key prevents duplicate submissions
    table.string('idempotency_key', 200).unique().nullable();
    // COMMITTED is the only status for committed transactions (staged = in staging table)
    table.string('status', 20).notNullable().defaultTo('COMMITTED');
    table
      .enu('data_flag', ['PROVISIONAL', 'AUTHORITATIVE'], {
        useNative: true,
        existingType: true,
        enumName: 'data_flag',
      })
      .notNullable()
      .defaultTo('PROVISIONAL');
    // Chain file position — set when the entry is written to the chain
    table.integer('chain_sequence').nullable();
    table.string('chain_period_id', 7).nullable();
    // Whether this record has been verified against the chain file
    table.boolean('chain_verified').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('committed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['period_id']);
    table.index(['date']);
    table.index(['transaction_type']);
  });

  await knex.schema.createTable('transaction_lines', (table) => {
    table.increments('id').primary();
    table
      .string('transaction_id', 50)
      .notNullable()
      .references('transaction_id')
      .inTable('transactions')
      .onDelete('CASCADE');
    table.string('period_id', 7).notNullable().references('period_id').inTable('periods');
    table.string('account_code', 20).notNullable().references('code').inTable('accounts');
    table.text('description').nullable();
    // Both stored as non-negative values; exactly one must be non-zero per line
    table.decimal('debit', 18, 2).notNullable().defaultTo(0);
    table.decimal('credit', 18, 2).notNullable().defaultTo(0);
    table.string('cost_centre', 100).nullable();
    table
      .enu('data_flag', ['PROVISIONAL', 'AUTHORITATIVE'], {
        useNative: true,
        existingType: true,
        enumName: 'data_flag',
      })
      .notNullable()
      .defaultTo('PROVISIONAL');
    table.boolean('chain_verified').notNullable().defaultTo(false);

    table.index(['transaction_id']);
    table.index(['account_code']);
    table.index(['period_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transaction_lines');
  await knex.schema.dropTableIfExists('transactions');
}
