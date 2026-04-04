import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transaction_type_mappings', (table) => {
    table.increments('id').primary();
    // e.g. CUSTOMER_INVOICE, SUPPLIER_INVOICE, CUSTOMER_PAYMENT, SUPPLIER_PAYMENT
    table.string('transaction_type', 50).notNullable();
    // Human-readable role within the transaction, e.g. DEBTORS, REVENUE, VAT_OUTPUT
    table.string('line_role', 100).notNullable();
    table.string('account_code', 20).notNullable().references('code').inTable('accounts');
    table
      .enu('direction', ['DEBIT', 'CREDIT'], {
        useNative: true,
        enumName: 'posting_direction',
      })
      .notNullable();
    // Default description to use on the generated posting line
    table.string('description', 200).nullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['transaction_type', 'active']);
    table.unique(['transaction_type', 'line_role']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transaction_type_mappings');
  await knex.raw('DROP TYPE IF EXISTS posting_direction');
}
