import { db } from '../connection';

// ---------------------------------------------------------------------------
// db/queries/users.ts — user query functions
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  roles: string[];
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const user = await db<User>('users').where({ email }).first();
  return user ?? null;
}

export async function findUserById(userId: string): Promise<User | null> {
  const user = await db<User>('users').where({ id: userId }).first();
  return user ?? null;
}

export async function createUser(params: {
  email: string;
  password_hash: string;
  display_name: string;
  roles: string[];
}): Promise<User> {
  const [user] = await db('users')
    .insert({
      email: params.email,
      password_hash: params.password_hash,
      display_name: params.display_name,
      roles: params.roles,
      is_active: true,
    })
    .returning('*');
  return user as User;
}

export async function recordLogin(userId: string): Promise<void> {
  await db('users').where({ id: userId }).update({ last_login_at: db.fn.now() });
}

export async function updateUser(
  userId: string,
  updates: Partial<Pick<User, 'display_name' | 'roles' | 'is_active'>>,
): Promise<User | null> {
  const count = await db('users').where({ id: userId }).update(updates);
  if (count === 0) return null;
  return findUserById(userId);
}

export async function listUsers(): Promise<Omit<User, 'password_hash'>[]> {
  return db<User>('users')
    .select('id', 'email', 'display_name', 'roles', 'is_active', 'created_at', 'last_login_at')
    .orderBy('created_at', 'asc');
}
