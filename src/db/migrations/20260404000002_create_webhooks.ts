import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// Migration: create webhook_subscriptions and webhook_deliveries tables
// ---------------------------------------------------------------------------

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('webhook_subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('callback_url').notNullable();
    t.specificType('event_types', 'TEXT[]').notNullable();
    t.string('secret').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_delivery_at').nullable();
    t.integer('failure_count').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('webhook_deliveries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('subscription_id').notNullable().references('id').inTable('webhook_subscriptions').onDelete('CASCADE');
    t.string('event_type').notNullable();
    t.text('payload').notNullable();
    t.string('status').notNullable().defaultTo('PENDING'); // PENDING | RETRYING | DELIVERED | FAILED
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_attempt_at').nullable();
    t.integer('last_response_status').nullable();
    t.text('last_error').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('webhook_deliveries');
  await knex.schema.dropTableIfExists('webhook_subscriptions');
}
