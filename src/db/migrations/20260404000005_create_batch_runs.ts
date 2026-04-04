import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('batch_runs', (t) => {
    t.string('id', 50).primary();                    // e.g., 'BATCH-2026-04-03-001'
    t.string('run_type', 50).notNullable();           // 'SCHEDULED', 'MANUAL'
    t.string('status', 30).notNullable().defaultTo('RUNNING');
      // RUNNING, COMPLETED, FAILED, PARTIAL
    t.jsonb('tasks_completed').notNullable().defaultTo('[]');
      // Array of { task: string, status: string, details: string, completed_at: string }
    t.integer('documents_processed').notNullable().defaultTo(0);
    t.integer('transactions_posted').notNullable().defaultTo(0);
    t.integer('matches_confirmed').notNullable().defaultTo(0);
    t.integer('errors_encountered').notNullable().defaultTo(0);
    t.text('summary').nullable();                     // Luca's summary of the batch run
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('completed_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('batch_runs');
}
