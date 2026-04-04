import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('bank_accounts', (t) => {
    t.string('id', 50).primary();
    t.string('account_code', 20).notNullable();
    t.string('bank_name', 255).notNullable();
    t.string('account_name', 255).notNullable();
    t.string('sort_code', 10).nullable();
    t.string('account_number', 20).nullable();
    t.string('iban', 40).nullable();
    t.string('currency', 3).notNullable().defaultTo('GBP');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('account_code').references('code').inTable('accounts');
  });

  await knex.schema.createTable('bank_statement_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('bank_account_id', 50).notNullable();
    t.string('import_batch_id', 50).notNullable();
    t.date('date').notNullable();
    t.string('description', 500).notNullable();
    t.decimal('amount', 19, 4).notNullable();
    t.decimal('balance', 19, 4).nullable();
    t.string('reference', 255).nullable();
    t.string('transaction_type', 50).nullable();
    t.string('counterparty_name', 255).nullable();
    t.string('match_status', 30).notNullable().defaultTo('UNMATCHED');
    t.string('matched_transaction_id', 30).nullable();
    t.string('matched_by', 50).nullable();
    t.timestamp('matched_at').nullable();
    t.text('match_notes').nullable();
    t.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('bank_account_id').references('id').inTable('bank_accounts');
    t.index(['bank_account_id', 'date']);
    t.index(['import_batch_id']);
    t.index(['match_status']);
  });

  await knex.schema.createTable('bank_import_batches', (t) => {
    t.string('id', 50).primary();
    t.string('bank_account_id', 50).notNullable();
    t.string('source_format', 30).notNullable();
    t.string('source_filename', 255).nullable();
    t.integer('total_lines').notNullable().defaultTo(0);
    t.integer('duplicate_lines').notNullable().defaultTo(0);
    t.integer('imported_lines').notNullable().defaultTo(0);
    t.date('date_from').nullable();
    t.date('date_to').nullable();
    t.string('imported_by', 255).notNullable();
    t.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('bank_account_id').references('id').inTable('bank_accounts');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bank_import_batches');
  await knex.schema.dropTableIfExists('bank_statement_lines');
  await knex.schema.dropTableIfExists('bank_accounts');
}
