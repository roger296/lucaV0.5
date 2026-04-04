import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('chain_metadata', (table) => {
    table.increments('id').primary();
    table
      .string('period_id', 7)
      .notNullable()
      .unique()
      .references('period_id')
      .inTable('periods');
    // Tracks the last known sequence number in the chain file
    table.integer('last_sequence').notNullable().defaultTo(0);
    // entry_hash of the most recently written chain entry for this period
    table.string('last_entry_hash', 64).nullable();
    // Total count of entries in the chain file (including GENESIS)
    table.integer('entry_count').notNullable().defaultTo(0);
    // When the chain was last verified with verifyChain()
    table.timestamp('last_verified_at', { useTz: true }).nullable();
    // Result of the most recent verification run; null = never verified
    table.boolean('chain_valid').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chain_metadata');
}
