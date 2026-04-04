import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('approval_rules', (table) => {
    table.increments('id').primary();
    table.string('rule_name', 200).notNullable();
    table.text('description').nullable();
    // NULL means this rule applies to all transaction types
    table.string('transaction_type', 50).nullable();
    // Transactions with total_amount <= this are auto-approved.
    // NULL means no amount limit (apply the require_manual_review flag directly).
    table.decimal('max_auto_approve_amount', 18, 2).nullable();
    // If true, always route to manual review regardless of amount.
    // If false and amount <= max_auto_approve_amount, auto-approve.
    table.boolean('require_manual_review').notNullable().defaultTo(false);
    table.boolean('active').notNullable().defaultTo(true);
    // Rules are evaluated in ascending priority order; first matching rule wins.
    table.integer('priority').notNullable().defaultTo(100);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['active', 'priority']);
    table.index(['transaction_type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('approval_rules');
}
