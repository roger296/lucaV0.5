import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Current month per CLAUDE.md: today is 2026-03-04
  const periodId = '2026-03';
  const startDate = '2026-03-01';
  const endDate = '2026-03-31';

  await knex('periods')
    .insert({
      period_id: periodId,
      start_date: startDate,
      end_date: endDate,
      status: 'OPEN',
      data_flag: 'PROVISIONAL',
      opened_at: knex.fn.now(),
    })
    .onConflict('period_id')
    .ignore();

  // Create a chain_metadata row for this period so the chain writer
  // has a place to track sequence numbers and hashes.
  await knex('chain_metadata')
    .insert({
      period_id: periodId,
      last_sequence: 0,
      last_entry_hash: null,
      entry_count: 0,
      last_verified_at: null,
      chain_valid: null,
    })
    .onConflict('period_id')
    .ignore();
}
