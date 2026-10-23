import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { Importer } from '../lib/importer.mjs';
import { Pricing, parsePricing, estimateCost } from '../lib/pricing.mjs';
import { getReport, optionsFrom, metadata, reportCsv } from '../lib/report.mjs';

const assistant = (output = 20) => ({ type: 'assistant', sessionId: 's1', cwd: '/projects/demo',
  timestamp: '2026-10-22T10:00:00Z', requestId: 'req-a', message: { id: 'msg-a', model: 'claude-opus-4-8',
    content: [{ type: 'text', text: 'PRIVATE_MESSAGE_MARKER' }], usage: { input_tokens: 10, output_tokens: output,
      cache_read_input_tokens: 100, cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 } } } });
const claudeMarkdown = `## Model pricing
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 4.8 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Haiku 4.5 | $1 / MTok | $1.25 / MTok | $2 / MTok | $0.10 / MTok | $5 / MTok |
## Batch pricing
| Claude Opus 4.8 | $2.5 | $3 | $5 | $0.25 | $12.5 |`;
const openaiMarkdown = `### Standard pricing data
| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-test | $2 | $10 | $0.20 | $2.5 | $5 | $4 | $15 | $0.4 | $5 | $10 |
| gpt-other | $1 | $5 | $0.1 | $1.25 | $2 | $2 | $7.5 | $0.2 | $2.5 | $4 |
### Batch pricing data
| gpt-test | $1 | $5 | $0.10 | $1.25 | $2.5 | $2 | $7.5 | $0.2 | $2.5 | $5 |`;

test('Claude streaming blocks, copies, and subagents count each response once without saving message content', () => {
  const store = new Store(':memory:');
  try {
    store.consumeClaude(assistant(2), {}, 'fallback');
    store.consumeClaude(assistant(20), {}, 'copy');
    store.consumeClaude(assistant(3), {}, 'late-old-copy');
    const row = store.db.prepare('SELECT * FROM events').get();
    assert.equal(row.input_tokens, 150);
    assert.equal(row.cached_input_tokens, 100);
    assert.equal(row.cache_write_input_tokens, 40);
    assert.equal(row.cache_write_long_input_tokens, 10);
    assert.equal(row.output_tokens, 20);
    assert.equal(row.total_tokens, 170);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
    assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM events').all()).includes('PRIVATE_MESSAGE_MARKER'));
    const subagent = assistant(7); subagent.message.id = 'msg-agent'; subagent.isSidechain = true;
    store.consumeClaude(subagent, {}, 'agent-file');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    const synthetic = assistant(); synthetic.message.model = '<synthetic>'; synthetic.message.id = 'synthetic';
    store.consumeClaude(synthetic, {}, 'fallback');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
  } finally { store.close(); }
});

test('Claude imports resume partial lines, keep titles, retain deleted logs, and preserve Codex source availability', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenapp-claude-'));
  const store = new Store(':memory:');
  try {
    store.session('s1', { cwd: '/codex-project' });
    await fs.mkdir(path.join(directory, 'projects'));
    const file = path.join(directory, 'projects', 's1.jsonl');
    const line = JSON.stringify(assistant());
    await fs.writeFile(file, line.slice(0, 40));
    const importer = new Importer(store, directory, 15000, async () => {}, { provider: 'claude' });
    await importer.scan();
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
    await fs.appendFile(file, line.slice(40) + '\n' + JSON.stringify({ type: 'custom-title', sessionId: 's1', customTitle: 'A useful session' }) + '\n');
    await importer.scan();
    await importer.scan();
    assert.equal(store.db.prepare("SELECT title FROM sessions WHERE provider='claude'").get().title, 'A useful session');
    assert.equal(store.db.prepare('SELECT seen FROM sessions WHERE id=?').get('s1').seen, 1);
    await fs.unlink(file);
    await fs.writeFile(path.join(directory, 'projects', 'other.jsonl'), JSON.stringify({ type: 'custom-title', sessionId: 'other', customTitle: 'Empty' }) + '\n');
    await importer.scan();
    assert.equal(store.db.prepare('SELECT seen FROM sessions WHERE id=?').get('claude:s1').seen, 0);
    assert.equal(store.db.prepare('SELECT seen FROM sessions WHERE id=?').get('s1').seen, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  } finally { store.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('pricing parses standard tables, excludes batch rates, and prices separate cache durations and context tiers', () => {
  const rates = parsePricing('codex', openaiMarkdown);
  assert.equal(rates['gpt-test'].input, 2);
  const row = { model: 'gpt-test-2026-10-22', source: 'record', input_tokens: 300000, cached_input_tokens: 100000, cache_write_input_tokens: 0, output_tokens: 1000 };
  assert.equal(estimateCost(row, { provider: 'codex', rates }), .855);
  assert.equal(estimateCost({ ...row, model: 'unlisted' }, { provider: 'codex', rates }), null);
  const claude = parsePricing('claude', claudeMarkdown);
  assert.equal(claude['claude-opus-4-8'].output, 25);
  assert.equal(estimateCost({ model: 'claude-haiku-4-5-20251001', source: 'claude', input_tokens: 1000000,
    cached_input_tokens: 200000, cache_write_input_tokens: 300000, cache_write_long_input_tokens: 100000, output_tokens: 100000 }, { provider: 'claude', rates: claude }), 1.47);
});

test('pricing refresh retains saved rates on fetch or parser failure and reports provider-scoped costs', async () => {
  const store = new Store(':memory:');
  try {
    const pricing = new Pricing(store, async () => new Response(claudeMarkdown));
    await pricing.refresh('claude');
    const fetched = pricing.get('claude').fetched_at;
    pricing.fetcher = async () => new Response('table changed');
    await assert.rejects(pricing.refresh('claude'), /could not be read/);
    assert.equal(pricing.get('claude').fetched_at, fetched);
    pricing.fetcher = async () => new Response('offline', { status: 503 });
    await assert.rejects(pricing.refresh('claude'), /503/);
    store.consumeClaude(assistant(), {}, 's1');
    const unknown = assistant(); unknown.message.id = 'unknown'; unknown.message.model = 'unknown';
    store.consumeClaude(unknown, {}, 's1');
    store.session('codex-only', { cwd: '/codex-project' });
    const options = optionsFrom(new URLSearchParams('provider=claude&from=2026-10-22&to=2026-10-22'));
    const report = getReport(store, options);
    assert.equal(report.totals.calls, 2);
    assert.equal(report.totals.priced_calls, 1);
    assert.equal(report.totals.unpriced_calls, 1);
    assert.equal(report.totals.legacy_calls, 0);
    assert.ok(Math.abs(report.totals.estimated_cost_usd - .0008875) < 1e-12);
    for (const category of ['sessions', 'periods', 'models']) assert.equal(report[category].reduce((sum, row) => sum + row.estimated_cost_usd, 0), report.totals.estimated_cost_usd);
    assert.equal(metadata(store, 'UTC', 'claude').projects.length, 1);
    assert.equal(getReport(store, optionsFrom(new URLSearchParams())).totals.calls, 0);
    assert.match(reportCsv(report), /estimated_cost_usd/);
    assert.match(reportCsv(report), /claude/);
    assert.throws(() => optionsFrom(new URLSearchParams('provider=invalid')), /Choose/);
  } finally { store.close(); }
});
