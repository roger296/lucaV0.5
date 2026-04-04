import { db } from '../db/connection';

export interface BatchRun {
  id: string;
  run_type: 'SCHEDULED' | 'MANUAL';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  tasks_completed: Array<{
    task: string;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    details: string;
    completed_at: string;
  }>;
  documents_processed: number;
  transactions_posted: number;
  matches_confirmed: number;
  errors_encountered: number;
  summary: string | null;
  started_at: string;
  completed_at: string | null;
}

// Creates a batch_runs row, returns the batch ID
export async function startBatchRun(runType: 'SCHEDULED' | 'MANUAL'): Promise<string> {
  // Generate batch ID: BATCH-YYYY-MM-DD-NNN (sequential for the day)
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Count existing batches for today to get sequence number
  const count = await db('batch_runs')
    .where('id', 'like', `BATCH-${today}-%`)
    .count<Array<{ count: string }>>('id as count')
    .first();
  const seq = String(Number(count?.count ?? 0) + 1).padStart(3, '0');
  const id = `BATCH-${today}-${seq}`;

  await db('batch_runs').insert({
    id,
    run_type: runType,
    status: 'RUNNING',
    tasks_completed: JSON.stringify([]),
    documents_processed: 0,
    transactions_posted: 0,
    matches_confirmed: 0,
    errors_encountered: 0,
    started_at: new Date().toISOString(),
  });

  return id;
}

// Appends to the tasks_completed JSONB array
export async function recordBatchTask(params: {
  batch_id: string;
  task: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  details: string;
}): Promise<void> {
  const row = await db('batch_runs').where('id', params.batch_id).first<BatchRun>();
  if (!row) throw new Error(`Batch run not found: ${params.batch_id}`);

  const tasks = Array.isArray(row.tasks_completed) ? row.tasks_completed : [];
  tasks.push({
    task: params.task,
    status: params.status,
    details: params.details,
    completed_at: new Date().toISOString(),
  });

  await db('batch_runs').where('id', params.batch_id).update({
    tasks_completed: JSON.stringify(tasks),
  });
}

// Increments the counters
export async function updateBatchCounters(params: {
  batch_id: string;
  documents_processed?: number;
  transactions_posted?: number;
  matches_confirmed?: number;
  errors_encountered?: number;
}): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (params.documents_processed != null)
    updates['documents_processed'] = db.raw('documents_processed + ?', [params.documents_processed]);
  if (params.transactions_posted != null)
    updates['transactions_posted'] = db.raw('transactions_posted + ?', [params.transactions_posted]);
  if (params.matches_confirmed != null)
    updates['matches_confirmed'] = db.raw('matches_confirmed + ?', [params.matches_confirmed]);
  if (params.errors_encountered != null)
    updates['errors_encountered'] = db.raw('errors_encountered + ?', [params.errors_encountered]);

  if (Object.keys(updates).length > 0) {
    await db('batch_runs').where('id', params.batch_id).update(updates);
  }
}

// Sets completed_at and summary
export async function completeBatchRun(params: {
  batch_id: string;
  summary: string;
  status?: 'COMPLETED' | 'FAILED' | 'PARTIAL';
}): Promise<void> {
  await db('batch_runs').where('id', params.batch_id).update({
    status: params.status ?? 'COMPLETED',
    summary: params.summary,
    completed_at: new Date().toISOString(),
  });
}

// Returns the most recent batch run
export async function getLatestBatchRun(): Promise<BatchRun | null> {
  return db('batch_runs').orderBy('started_at', 'desc').first<BatchRun>() ?? null;
}

// Returns recent batch runs
export async function listBatchRuns(limit: number = 10): Promise<BatchRun[]> {
  return db('batch_runs').orderBy('started_at', 'desc').limit(limit);
}
