import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zstdCompressSync } from 'node:zlib';
import { Store } from '../lib/store.mjs';
import { Importer } from '../lib/importer.mjs';
import { getReport, optionsFrom } from '../lib/report.mjs';

function fixture() {
  const u = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80, reasoning_output_tokens: 5 };
  return [
    { type: 'session_meta', payload: { id: 'old', timestamp: '2026-03-21T12:00:00Z', cwd: '/old' } },
    { type: 'turn_context', payload: { turn_id: 't1', model: 'old-model' } },
    { type: 'event_msg', timestamp: '2026-03-21T12:00:01Z', payload: { type: 'token_count', info: { total_token_usage: u, last_token_usage: u } } }
  ].map(row => JSON.stringify(row)).join('\n');
}
test('compressed history is imported, survives compression of plain logs, and is idempotent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-zstd-'));
  const store = new Store(':memory:');
  try {
    const logs = path.join(dir, 'sessions');
    await fs.mkdir(logs);
    const plain = path.join(logs, 'old.jsonl');
    await fs.writeFile(plain, fixture() + '\n');
    const importer = new Importer(store, dir);
    await importer.scan();
    const options = optionsFrom(new URLSearchParams());
    assert.equal(getReport(store, options).totals.total_tokens, 120);
    await fs.writeFile(plain + '.zst', zstdCompressSync(fixture()));
    await importer.scan();
    assert.equal(getReport(store, options).totals.total_tokens, 120);
    await fs.unlink(plain);
    await importer.scan();
    assert.equal(getReport(store, options).totals.total_tokens, 120);
    assert.equal(getReport(store, options).sessions[0].source_available, true);
    assert.equal(importer.status.compressedFiles, 1);
    assert.equal(importer.status.errors.length, 0);
    assert.equal(importer.status.bytes, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('archives in archived_sessions are included and corrupt archives remain retryable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-zstd-'));
  const store = new Store(':memory:');
  try {
    const logs = path.join(dir, 'archived_sessions');
    await fs.mkdir(logs);
    const file = path.join(logs, 'old.jsonl.zst');
    await fs.writeFile(file, 'not a zstd frame');
    const importer = new Importer(store, dir);
    await importer.scan();
    assert.equal(importer.status.errors.length, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
    await fs.writeFile(file, zstdCompressSync(fixture() + '\n'));
    await importer.scan();
    const report = getReport(store, optionsFrom(new URLSearchParams()));
    assert.equal(report.totals.total_tokens, 120);
    assert.equal(report.sessions[0].archived, true);
    assert.equal(importer.status.errors.length, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('streamed archives handle chunk boundaries and large unrelated payloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-zstd-'));
  const store = new Store(':memory:');
  try {
    const logs = path.join(dir, 'sessions');
    await fs.mkdir(logs);
    const rows = fixture().split('\n');
    rows.splice(2, 0, JSON.stringify({ type: 'response_item', payload: { type: 'message', content: 'irrelevant'.repeat(40000) } }));
    await fs.writeFile(path.join(logs, 'large.jsonl.zst'), zstdCompressSync(rows.join('\n') + '\n'));
    const importer = new Importer(store, dir);
    await importer.scan();
    assert.equal(getReport(store, optionsFrom(new URLSearchParams())).totals.total_tokens, 120);
    assert.equal(importer.status.errors.length, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('a truncated archive never commits a partially imported session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-zstd-'));
  const store = new Store(':memory:');
  try {
    const logs = path.join(dir, 'sessions');
    await fs.mkdir(logs);
    const compressed = zstdCompressSync(fixture() + '\n');
    await fs.writeFile(path.join(logs, 'truncated.jsonl.zst'), compressed.subarray(0, compressed.length - 2));
    const importer = new Importer(store, dir);
    await importer.scan();
    assert.equal(importer.status.errors.length, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
