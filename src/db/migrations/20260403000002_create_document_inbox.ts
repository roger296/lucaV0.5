import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('inbox_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('filename', 500).notNullable();
    t.string('original_path', 1000).notNullable();
    t.string('mime_type', 100).nullable();
    t.integer('file_size').nullable();
    t.string('status', 30).notNullable().defaultTo('PENDING');
    t.string('document_type', 50).nullable();
    t.string('assigned_transaction_id', 30).nullable();
    t.string('assigned_staging_id', 50).nullable();
    t.text('processing_notes').nullable();
    t.text('error_message').nullable();
    t.string('processed_by', 255).nullable();
    t.jsonb('extracted_data').nullable();
    t.timestamp('detected_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('processing_started_at').nullable();
    t.timestamp('completed_at').nullable();
    t.index(['status']);
    t.index(['document_type']);
  });

  await knex.schema.createTable('inbox_config', (t) => {
    t.integer('id').primary();
    t.string('watch_directory', 1000).notNullable();
    t.string('archive_directory', 1000).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.jsonb('allowed_extensions').notNullable().defaultTo(JSON.stringify(['.pdf', '.jpg', '.jpeg', '.png', '.csv', '.xlsx']));
    t.integer('max_file_size_mb').notNullable().defaultTo(25);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inbox_config');
  await knex.schema.dropTableIfExists('inbox_documents');
}
