/**
 * Integration tests for document intake pipeline (Phase 2, Prompt 8).
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { db } from '../../src/db/connection';
import {
  configureInbox,
  scanInbox,
  getPendingDocuments,
  startProcessing,
  completeProcessing,
  failProcessing,
  getInboxStatus,
} from '../../src/engine/document-inbox';
import {
  handleConfigureInbox,
  handleScanInbox,
  handleGetPendingDocuments,
  handleCompleteDocumentProcessing,
  handleFailDocumentProcessing,
  handleGetInboxStatus,
} from '../../src/mcp/tools';

let tmpDir: string;

beforeAll(async () => {
  // Clear any existing inbox_config and inbox_documents
  await db('inbox_documents').del();
  await db('inbox_config').del();

  // Create a temporary directory with test files
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-test-'));
  await fs.writeFile(path.join(tmpDir, 'invoice.pdf'), 'fake pdf content');
  await fs.writeFile(path.join(tmpDir, 'receipt.jpg'), 'fake jpg content');
  await fs.writeFile(path.join(tmpDir, 'notes.txt'), 'should be filtered');
});

afterAll(async () => {
  await db('inbox_documents').del();
  await db('inbox_config').del();
  try { await fs.rm(tmpDir, { recursive: true }); } catch { /**/ }
});

describe('configureInbox', () => {
  it('configures the watch directory', async () => {
    await configureInbox({ watch_directory: tmpDir });
    const config = await db('inbox_config').where('id', 1).first<{ watch_directory: string }>();
    expect(config?.watch_directory).toBe(tmpDir);
  });
});

describe('scanInbox', () => {
  it('detects 2 new files (PDF and JPG), skips TXT', async () => {
    const result = await scanInbox();
    expect(result.new_files).toBe(2);
    expect(result.total_pending).toBe(2);
    expect(result.directory).toBe(tmpDir);
  });

  it('second scan detects 0 new files (already tracked)', async () => {
    const result = await scanInbox();
    expect(result.new_files).toBe(0);
    expect(result.total_pending).toBe(2);
  });
});

describe('getPendingDocuments', () => {
  it('returns pending documents', async () => {
    const docs = await getPendingDocuments(10);
    expect(docs.length).toBe(2);
    expect(docs[0]!.status).toBe('PENDING');
  });
});

describe('startProcessing and completeProcessing', () => {
  let docId: string;

  beforeAll(async () => {
    const docs = await db('inbox_documents').where('filename', 'invoice.pdf').first<{ id: string }>();
    docId = docs!.id;
  });

  it('marks document as PROCESSING', async () => {
    await startProcessing(docId, 'luca-batch');
    const doc = await db('inbox_documents').where('id', docId).first<{ status: string; processed_by: string }>();
    expect(doc?.status).toBe('PROCESSING');
    expect(doc?.processed_by).toBe('luca-batch');
  });

  it('completes processing and marks as PROCESSED', async () => {
    await completeProcessing({
      document_id: docId,
      document_type: 'SUPPLIER_INVOICE',
      processing_notes: 'Extracted invoice from PDF',
      extracted_data: { supplier: 'ACME Ltd', amount: '1200.00' },
    });
    const doc = await db('inbox_documents').where('id', docId).first<{ status: string; document_type: string; processing_notes: string }>();
    expect(doc?.status).toBe('PROCESSED');
    expect(doc?.document_type).toBe('SUPPLIER_INVOICE');
    expect(doc?.processing_notes).toBe('Extracted invoice from PDF');
  });
});

describe('failProcessing', () => {
  let docId: string;

  beforeAll(async () => {
    const doc = await db('inbox_documents').where('filename', 'receipt.jpg').first<{ id: string }>();
    docId = doc!.id;
  });

  it('marks document as FAILED with error message', async () => {
    await failProcessing({ document_id: docId, error_message: 'Could not parse image' });
    const doc = await db('inbox_documents').where('id', docId).first<{ status: string; error_message: string }>();
    expect(doc?.status).toBe('FAILED');
    expect(doc?.error_message).toBe('Could not parse image');
  });
});

describe('getInboxStatus', () => {
  it('returns correct counts', async () => {
    const status = await getInboxStatus();
    expect(status.total).toBe(2);
    expect(status.processed).toBe(1);
    expect(status.failed).toBe(1);
    expect(status.pending).toBe(0);
    expect(status.watch_directory).toBe(tmpDir);
  });
});

describe('MCP tool wrappers', () => {
  it('gl_configure_inbox configures successfully', async () => {
    const result = await handleConfigureInbox({ watch_directory: tmpDir });
    expect(result.isError).toBeFalsy();
  });

  it('gl_scan_inbox scans (0 new since already tracked)', async () => {
    const result = await handleScanInbox({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { new_files: number };
    expect(data.new_files).toBe(0);
  });

  it('gl_get_pending_documents returns list', async () => {
    const result = await handleGetPendingDocuments({ limit: 10 });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it('gl_get_inbox_status returns status summary', async () => {
    const result = await handleGetInboxStatus({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { total: number };
    expect(typeof data.total).toBe('number');
  });
});
