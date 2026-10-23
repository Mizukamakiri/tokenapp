import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../lib/store.mjs';
import { Importer } from '../lib/importer.mjs';

const meta = { type: 'session_meta', payload: { id: 's1', cwd: '/projects/demo' } };
function record(id, total = 110) {
  return { timestamp: '2026-10-22T12:00:00Z', type: 'token_usage_record', payload: {
    response_id: id, thread_id: 's1', usage: { input_tokens: 100, output_tokens: 10 },
    thread_token_usage: { input_tokens: total - total / 11, output_tokens: total / 11 }
  } };
}
test('incremental import survives restarts, partial lines, duplicate files, and archive moves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-test-'));
  const store = new Store(':memory:');
  const importer = new Importer(store, dir);
  try {
    await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
    const file = path.join(dir, 'sessions', 'sample.jsonl');
    const second = JSON.stringify(record('r2', 220));
    await fs.writeFile(file, JSON.stringify(meta) + '\n' + JSON.stringify(record('r1')) + '\n' + second.slice(0, 60));
    await importer.scan();
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
    await fs.appendFile(file, second.slice(60) + '\n');
    await importer.scan();
    await importer.scan();
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
    await fs.writeFile(path.join(dir, 'session_index.jsonl'), JSON.stringify({ id: 's1', thread_name: 'A named session' }) + '\n');
    const restarted = new Importer(store, dir);
    await restarted.scan();
    assert.equal(store.db.prepare('SELECT title FROM sessions').get().title, 'A named session');
    await fs.mkdir(path.join(dir, 'archived_sessions'));
    await fs.rename(file, path.join(dir, 'archived_sessions', 'sample.jsonl'));
    await restarted.scan();
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
    assert.equal(store.db.prepare('SELECT archived FROM sessions').get().archived, 1);
    assert.equal(restarted.status.errors.length, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('missing source is visible and never represented as successful zero usage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-test-'));
  const store = new Store(':memory:');
  try {
    const importer = new Importer(store, path.join(dir, 'missing'));
    await importer.scan();
    assert.match(importer.status.errors[0], /No session logs found/);
    assert.equal(importer.status.files, 0);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('ongoing scans retain prior totals until source availability is published', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-test-'));
  const store = new Store(':memory:');
  try {
    await fs.mkdir(path.join(dir, 'sessions'));
    await fs.writeFile(path.join(dir, 'sessions', 'a.jsonl'), JSON.stringify(meta) + '\n' + JSON.stringify(record('r1')) + '\n');
    const importer = new Importer(store, dir);
    await importer.scan();
    const original = importer.readFile.bind(importer);
    importer.readFile = async file => {
      assert.equal(store.db.prepare('SELECT SUM(input_tokens) AS n FROM events e JOIN sessions s ON e.session_id=s.id WHERE s.seen=1').get().n, 100);
      await original(file);
    };
    await importer.scan();
    assert.equal(store.db.prepare('SELECT seen FROM sessions').get().seen, 1);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
