import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('company_settings', (table) => {
    table.integer('id').primary().defaultTo(1);
    table.string('company_name', 200).nullable();
    table.string('company_number', 50).nullable();
    table.string('vat_number', 50).nullable();
    table.boolean('vat_registered').notNullable().defaultTo(false);
    table.string('vat_scheme', 50).nullable();
    table.string('financial_year_end_month', 2).nullable();
    table.string('base_currency', 10).notNullable().defaultTo('GBP');
    table.string('territory', 50).nullable();
    table.string('industry', 100).nullable();
    table.jsonb('settings').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('company_settings');
}
