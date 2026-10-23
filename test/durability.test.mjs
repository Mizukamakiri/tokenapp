import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../lib/store.mjs';
import { Importer } from '../lib/importer.mjs';
import { Backups } from '../lib/backups.mjs';
import { getReport, metadata, optionsFrom } from '../lib/report.mjs';

const usageRecord = {
  type: 'token_usage_record', timestamp: '2026-10-22T12:00:00Z', payload: {
    thread_id: 's1', response_id: 'r1', usage: { input_tokens: 100, output_tokens: 20 },
    thread_token_usage: { input_tokens: 100, output_tokens: 20 }
  }
};
test('saved usage and date coverage survive source deletion and app restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-durable-'));
  const dbPath = path.join(dir, 'usage.sqlite');
  let store = new Store(dbPath);
  try {
    const source = path.join(dir, 'source');
    await fs.mkdir(path.join(source, 'sessions'), { recursive: true });
    const file = path.join(source, 'sessions', 'sample.jsonl');
    await fs.writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: 's1', cwd: '/example' } }) + '\n' + JSON.stringify(usageRecord) + '\n');
    const importer = new Importer(store, source);
    await importer.scan();
    const options = optionsFrom(new URLSearchParams());
    assert.equal(getReport(store, options).totals.total_tokens, 120);
    await fs.unlink(file);
    // Another valid file lets the scan distinguish real removal from a missing mount.
    await fs.writeFile(path.join(source, 'sessions', 'other.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 's2' } }) + '\n');
    await importer.scan();
    let result = getReport(store, options);
    assert.equal(result.totals.total_tokens, 120);
    assert.equal(result.sessions[0].source_available, false);
    assert.equal(result.coverage.saved_sessions_without_source, 1);
    store.close();
    store = new Store(dbPath);
    result = getReport(store, options);
    assert.equal(result.totals.total_tokens, 120);
    assert.equal(metadata(store, 'Europe/Helsinki').first, '2026-10-22');
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('daily and manual backups are standalone, integrity checked, and restore journaled usage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-backup-'));
  const store = new Store(path.join(dir, 'live.sqlite'));
  try {
    const state = { sessionId: 's1', model: 'example' };
    store.consume(usageRecord, state);
    const manager = new Backups(store, path.join(dir, 'backups'));
    const daily = { ...await manager.daily() };
    const check = new DatabaseSync(path.join(daily.directory, daily.file), { readOnly: true });
    assert.equal(check.prepare('SELECT SUM(input_tokens+output_tokens) AS n FROM events').get().n, 120);
    assert.equal(Object.values(check.prepare('PRAGMA quick_check').get())[0], 'ok');
    check.close();
    store.consume({ ...usageRecord, payload: { ...usageRecord.payload, response_id: 'r2' } }, state);
    await manager.daily();
    assert.equal((await fs.readdir(daily.directory)).length, 1);
    const manual = await manager.manual();
    const restoredFile = path.join(dir, 'restored.sqlite');
    await fs.copyFile(path.join(manual.directory, manual.file), restoredFile);
    const restored = new Store(restoredFile);
    try { assert.equal(getReport(restored, optionsFrom(new URLSearchParams())).totals.total_tokens, 240); }
    finally { restored.close(); }
    assert.equal((await fs.readdir(daily.directory)).filter(name => name.endsWith('.partial')).length, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
