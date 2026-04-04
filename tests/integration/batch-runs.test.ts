import { db } from '../../src/db/connection';
import {
  startBatchRun,
  recordBatchTask,
  updateBatchCounters,
  completeBatchRun,
  getLatestBatchRun,
  listBatchRuns,
} from '../../src/engine/batch';

describe('Batch run lifecycle', () => {
  let batchId: string;

  afterAll(async () => {
    // Clean up any batch runs created during tests
    await db('batch_runs').where('id', 'like', 'BATCH-%').del();
  });

  it('starts a batch run and returns an ID', async () => {
    batchId = await startBatchRun('MANUAL');
    expect(batchId).toMatch(/^BATCH-\d{4}-\d{2}-\d{2}-\d{3}$/);
    const row = await db('batch_runs').where('id', batchId).first<{ status: string }>();
    expect(row?.status).toBe('RUNNING');
  });

  it('records 3 tasks', async () => {
    await recordBatchTask({ batch_id: batchId, task: 'scan_inbox', status: 'SUCCESS', details: 'Found 5 new files' });
    await recordBatchTask({ batch_id: batchId, task: 'process_documents', status: 'SUCCESS', details: 'Processed 5 documents' });
    await recordBatchTask({ batch_id: batchId, task: 'bank_reconciliation', status: 'SUCCESS', details: 'Matched 10 transactions' });

    const row = await db('batch_runs').where('id', batchId).first<{ tasks_completed: unknown }>();
    const tasks = Array.isArray(row?.tasks_completed) ? row.tasks_completed : JSON.parse(row?.tasks_completed as string ?? '[]');
    expect(tasks).toHaveLength(3);
    expect(tasks[0].task).toBe('scan_inbox');
    expect(tasks[0].status).toBe('SUCCESS');
  });

  it('updates counters', async () => {
    await updateBatchCounters({
      batch_id: batchId,
      documents_processed: 5,
      transactions_posted: 3,
      matches_confirmed: 2,
    });
    const row = await db('batch_runs').where('id', batchId).first<{
      documents_processed: number;
      transactions_posted: number;
      matches_confirmed: number;
    }>();
    expect(Number(row?.documents_processed)).toBe(5);
    expect(Number(row?.transactions_posted)).toBe(3);
    expect(Number(row?.matches_confirmed)).toBe(2);
  });

  it('completes the batch run with a summary', async () => {
    await completeBatchRun({
      batch_id: batchId,
      summary: 'Processed 5 documents, posted 3 transactions, matched 2 bank lines.',
      status: 'COMPLETED',
    });
    const row = await db('batch_runs').where('id', batchId).first<{
      status: string;
      summary: string;
      completed_at: string;
    }>();
    expect(row?.status).toBe('COMPLETED');
    expect(row?.summary).toContain('5 documents');
    expect(row?.completed_at).toBeTruthy();
  });

  it('getLatestBatchRun returns this batch', async () => {
    const latest = await getLatestBatchRun();
    expect(latest?.id).toBe(batchId);
    expect(latest?.status).toBe('COMPLETED');
  });

  it('listBatchRuns returns recent runs', async () => {
    const runs = await listBatchRuns(10);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]?.id).toBe(batchId);
  });
});
