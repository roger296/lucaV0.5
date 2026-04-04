import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('accounts', (table) => {
    table.string('code', 20).primary();
    table.string('name', 200).notNullable();
    table
      .enu('type', ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'], {
        useNative: true,
        enumName: 'account_type',
      })
      .notNullable();
    // Category is free-form to allow flexibility: CURRENT_ASSET, FIXED_ASSET,
    // CURRENT_LIABILITY, DIRECT_COSTS, OVERHEADS, FINANCE_COSTS, OTHER_INCOME, etc.
    table.string('category', 50);
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('accounts');
  await knex.raw('DROP TYPE IF EXISTS account_type');
}
