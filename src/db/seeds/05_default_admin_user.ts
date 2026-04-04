import type { Knex } from 'knex';
import bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// 05_default_admin_user.ts — seed a default admin user for development
// ---------------------------------------------------------------------------

export async function seed(knex: Knex): Promise<void> {
  const passwordHash = bcrypt.hashSync('admin', 10);

  await knex('users')
    .insert({
      email: 'admin@localhost',
      password_hash: passwordHash,
      display_name: 'System Administrator',
      roles: ['ADMIN', 'FINANCE_MANAGER', 'APPROVER'],
      is_active: true,
    })
    .onConflict('email')
    .ignore();
}
