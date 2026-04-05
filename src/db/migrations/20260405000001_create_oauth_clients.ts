import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// OAuth 2.0 tables — clients, authorization codes, access tokens
// ---------------------------------------------------------------------------

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('oauth_clients', (t) => {
    t.string('client_id').primary();
    t.string('client_secret_hash').notNullable();
    t.string('name').notNullable();
    t.specificType('redirect_uris', 'text[]').notNullable().defaultTo('{}');
    t.specificType('scopes', 'text[]').notNullable().defaultTo('{}');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('oauth_authorization_codes', (t) => {
    t.string('code').primary();
    t.string('client_id').notNullable()
      .references('client_id').inTable('oauth_clients').onDelete('CASCADE');
    t.string('user_id').notNullable();
    t.string('redirect_uri').notNullable();
    t.specificType('scopes', 'text[]').notNullable().defaultTo('{}');
    t.string('code_challenge').nullable();
    t.string('code_challenge_method').nullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('oauth_access_tokens', (t) => {
    t.string('token_hash').primary();  // SHA-256 of raw token — never store raw
    t.string('client_id').notNullable()
      .references('client_id').inTable('oauth_clients').onDelete('CASCADE');
    t.string('user_id').notNullable();
    t.specificType('scopes', 'text[]').notNullable().defaultTo('{}');
    t.timestamp('expires_at').nullable();  // null = long-lived
    t.boolean('is_revoked').notNullable().defaultTo(false);
    t.timestamp('last_used_at').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('oauth_access_tokens');
  await knex.schema.dropTableIfExists('oauth_authorization_codes');
  await knex.schema.dropTableIfExists('oauth_clients');
}
