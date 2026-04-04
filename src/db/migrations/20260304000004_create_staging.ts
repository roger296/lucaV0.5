import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('staging', (table) => {
    // UUID or similar unique ID for the staged entry
    table.string('staging_id', 50).primary();
    table.string('period_id', 7).notNullable().references('period_id').inTable('periods');
    table.string('transaction_type', 50).notNullable();
    table.string('reference', 200).nullable();
    table.date('date').notNullable();
    table.string('currency', 3).notNullable().defaultTo('GBP');
    table.text('description').nullable();
    // Full transaction payload stored as JSONB for flexible querying
    table.jsonb('payload').notNullable();
    table
      .enu('status', ['PENDING', 'APPROVED', 'REJECTED'], {
        useNative: true,
        enumName: 'staging_status',
      })
      .notNullable()
      .defaultTo('PENDING');
    // Denormalised for quick rule evaluation without parsing the payload JSONB
    table.decimal('total_amount', 18, 2).nullable();
    // Idempotency key (same as on the transaction when approved)
    table.string('idempotency_key', 200).unique().nullable();
    table.string('submitted_by', 200).nullable();
    table.timestamp('submitted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('reviewed_by', 200).nullable();
    table.timestamp('reviewed_at', { useTz: true }).nullable();
    table.text('rejection_reason').nullable();
    // Which approval rule triggered this entry's route (manual/auto)
    table.integer('approval_rule_id').nullable();
    // transaction_id set when the staged entry is approved and committed
    table.string('committed_transaction_id', 50).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['period_id', 'status']);
    table.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('staging');
  await knex.raw('DROP TYPE IF EXISTS staging_status');
}
