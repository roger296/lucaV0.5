import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('periods', (table) => {
    // YYYY-MM format, e.g. "2026-03"
    table.string('period_id', 7).primary();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table
      .enu('status', ['OPEN', 'SOFT_CLOSE', 'HARD_CLOSE'], {
        useNative: true,
        enumName: 'period_status',
      })
      .notNullable()
      .defaultTo('OPEN');
    table
      .enu('data_flag', ['PROVISIONAL', 'AUTHORITATIVE'], {
        useNative: true,
        enumName: 'data_flag',
      })
      .notNullable()
      .defaultTo('PROVISIONAL');
    table.timestamp('opened_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('soft_closed_at', { useTz: true }).nullable();
    table.timestamp('hard_closed_at', { useTz: true }).nullable();
    // Identity of the user who performed hard close
    table.string('closed_by', 200).nullable();
    // entry_hash of the PERIOD_CLOSE chain entry (64-char hex SHA-256)
    table.string('closing_chain_hash', 64).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('periods');
  await knex.raw('DROP TYPE IF EXISTS period_status');
  await knex.raw('DROP TYPE IF EXISTS data_flag');
}
