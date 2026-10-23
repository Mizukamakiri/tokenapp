import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { Pricing, PRICE_SOURCES } from '../lib/pricing.mjs';
import { getReport, metadata, optionsFrom, reportCsv } from '../lib/report.mjs';

const options = (provider = 'all', query = '') => optionsFrom(new URLSearchParams('provider=' + provider + '&timezone=UTC&' + query));
function catalog(store, provider, rates) {
  store.db.prepare('INSERT INTO pricing(provider,fetched_at,source,rates) VALUES(?,?,?,?)')
    .run(provider, provider === 'codex' ? '2026-10-21T12:00:00Z' : '2026-10-22T12:00:00Z', PRICE_SOURCES[provider], JSON.stringify(rates));
}
function codexCall(store, id = 'c1', model = 'shared', timestamp = '2026-10-21T23:30:00Z', session = 'codex-session') {
  const state = {};
  store.consume({ type: 'session_meta', payload: { id: session, cwd: '/demo', timestamp } }, state);
  store.consume({ type: 'turn_context', payload: { model, turn_id: id } }, state);
  store.consume({ type: 'token_usage_record', timestamp, payload: { response_id: id, thread_id: session, turn_id: id,
    usage: { input_tokens: 1000000, cached_input_tokens: 800000, output_tokens: 100000 } } }, state);
}
function claudeCall(store, id = 'a1', model = 'shared', timestamp = '2026-10-22T00:30:00Z') {
  store.consumeClaude({ type: 'assistant', sessionId: 'claude-session', cwd: '/demo', timestamp,
    message: { id, model, usage: { input_tokens: 200000, output_tokens: 50000, cache_read_input_tokens: 600000,
      cache_creation_input_tokens: 200000, cache_creation: { ephemeral_1h_input_tokens: 100000 } } } }, {}, 'fallback');
}
function fixture() {
  const store = new Store(':memory:');
  codexCall(store); claudeCall(store);
  catalog(store, 'codex', { shared: { input: 2, cached: .2, output: 10 } });
  catalog(store, 'claude', { shared: { input: 5, cached: .5, write: 6.25, writeLong: 10, output: 25 } });
  return store;
}

test('All exactly sums concrete providers, keeps same-named models separate and does not mutate usage', () => {
  const store = fixture();
  try {
    const before = JSON.stringify(store.db.prepare('SELECT * FROM events ORDER BY id').all());
    const all = getReport(store, options());
    const codex = getReport(store, options('codex'));
    const claude = getReport(store, options('claude'));
    for (const key of ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'total_tokens', 'calls', 'sessions', 'priced_calls', 'unpriced_calls', 'custom_priced_calls']) {
      assert.equal(all.totals[key], codex.totals[key] + claude.totals[key], key);
    }
    assert.ok(Math.abs(all.totals.estimated_cost_usd - 5.735) < 1e-9);
    assert.equal(all.models.length, 2);
    assert.deepEqual(new Set(all.models.map(row => row.provider)), new Set(['codex', 'claude']));
    assert.equal(all.pricing.sources.length, 2);
    assert.equal(all.pricing.fetched_at, null);
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM events ORDER BY id').all()), before);
    const week = getReport(store, options('all', 'group=week'));
    assert.equal(week.periods.length, 1);
    assert.equal(week.totals.total_tokens, all.totals.total_tokens);
  } finally { store.close(); }
});

test('All metadata, dates, raw-model filters and provider attribution remain consistent', () => {
  const store = fixture();
  try {
    const meta = metadata(store, 'UTC', 'all');
    assert.deepEqual(meta.models, ['shared']);
    assert.equal(meta.projects.length, 1);
    assert.equal(meta.first, '2026-10-21');
    assert.equal(meta.last, '2026-10-22');
    assert.equal(getReport(store, options('all', 'from=2026-10-22&to=2026-10-22')).totals.sessions, 1);
    assert.equal(getReport(store, options('all', 'model=shared&project=%2Fdemo')).totals.sessions, 2);
    for (const session of getReport(store, options()).sessions) {
      const detail = getReport(store, options('all', 'session=' + encodeURIComponent(session.id)));
      assert.equal(detail.details.length, 1);
      assert.equal(detail.details[0].provider, session.provider);
    }
    const csv = reportCsv(getReport(store, options()));
    assert.match(csv, /pricing_fetched_at_by_provider/);
    assert.match(csv, /codex/);
    assert.match(csv, /claude/);
    const dataRows = csv.trim().split('\r\n').slice(1);
    assert.ok(dataRows.every(row => !row.includes(',"all",')), 'session rows identify their own provider');
    assert.match(reportCsv(getReport(store, options()), 'periods'), /,"all",/);
  } finally { store.close(); }
});

test('All keeps missing prices unpriced and custom rates scoped, including explicit zero', () => {
  const store = fixture();
  try {
    store.db.prepare('DELETE FROM pricing WHERE provider=?').run('claude');
    let report = getReport(store, options());
    assert.equal(report.totals.calls, 2);
    assert.equal(report.totals.unpriced_calls, 1);
    assert.ok(Math.abs(report.totals.estimated_cost_usd - 1.56) < 1e-9);
    const pricing = new Pricing(store);
    pricing.setOverride('claude', { model: 'shared', rates: { input: 0, cached: 0, write: 0, writeLong: 0, output: 0 } });
    report = getReport(store, options());
    assert.equal(report.totals.priced_calls, 2);
    assert.equal(report.totals.unpriced_calls, 0);
    assert.equal(report.totals.custom_priced_calls, 1);
    assert.equal(report.models.find(row => row.provider === 'codex').rate.input, 2);
    assert.equal(report.models.find(row => row.provider === 'claude').rate.input, 0);
    assert.throws(() => pricing.setOverride('all', { model: 'shared', rates: { input: 1, output: 1 } }), /Choose/);
  } finally { store.close(); }
});

test('All handles empty providers and excludes unsupported persisted provider values', () => {
  const store = new Store(':memory:');
  try {
    assert.equal(getReport(store, options()).totals.calls, 0);
    claudeCall(store);
    store.session('unsupported-session', { provider: 'unsupported' });
    codexCall(store, 'outside', 'other', '2026-10-22T00:00:00Z', 'unsupported-session');
    assert.equal(getReport(store, options()).totals.calls, 1);
    assert.deepEqual(metadata(store, 'UTC', 'all').models, ['shared']);
  } finally { store.close(); }
});

const openai = '| Model | Input | Output | Cached input |\n| --- | --- | --- | --- |\n| gpt-example | $2 | $10 | $0.2 |\n| gpt-other | $1 | $5 | $0.1 |';
const anthropic = '## Model pricing\n| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |\n| --- | --- | --- | --- | --- | --- |\n| Claude Opus 4.8 | $5 | $6.25 | $10 | $0.5 | $25 |\n| Claude Sonnet 5 | $2 | $2.5 | $4 | $0.2 | $10 |';

test('All pricing refresh preserves successful updates and saved rates across partial and total failures', async () => {
  const store = new Store(':memory:');
  try {
    let failClaude = false, failBoth = false;
    const pricing = new Pricing(store, async url => failBoth || failClaude && url.includes('claude.com') ?
      new Response('offline', { status: 503 }) : new Response(url.includes('openai.com') ? openai : anthropic));
    const initial = await pricing.refreshAll();
    assert.equal(initial.ok, true);
    assert.equal(initial.partial, false);
    const originalClaude = pricing.get('claude').fetched_at;
    pricing.setOverride('claude', { model: 'manual', rates: { input: 1, output: 2 } });
    failClaude = true;
    const partial = await pricing.refreshAll();
    assert.equal(partial.ok, true);
    assert.equal(partial.partial, true);
    assert.equal(partial.providers.find(row => row.provider === 'claude').ok, false);
    assert.equal(pricing.get('claude').fetched_at, originalClaude);
    assert.equal(pricing.get('claude').rates.manual.custom, true);
    failBoth = true;
    const failed = await pricing.refreshAll();
    assert.equal(failed.ok, false);
    assert.equal(failed.providers.filter(row => !row.ok).length, 2);
    assert.equal(pricing.get('codex').rates['gpt-example'].input, 2);
    assert.equal(pricing.get('claude').rates.manual.input, 1);
  } finally { store.close(); }
});

test('All import status keeps provider errors and requires both initial scans', async () => {
  const { selectedProviders, importStatus } = await import('../lib/providers.mjs');
  assert.deepEqual(selectedProviders('all'), ['codex', 'claude']);
  assert.throws(() => selectedProviders('constructor'), /Choose/);
  const importers = {
    codex: { status: { initialized: true, running: false, files: 4, processed: 4, compressedFiles: 2, bytes: 80, lastScan: '2026-10-22T10:00:00Z', errors: [] } },
    claude: { status: { initialized: false, running: false, files: 0, processed: 0, compressedFiles: 0, bytes: 0, lastScan: null, errors: ['No logs found'] } }
  };
  let status = importStatus(importers, 'all', true);
  assert.equal(status.running, true);
  assert.equal(status.initialized, false);
  assert.equal(status.lastScan, null);
  assert.equal(status.files, 4);
  assert.match(status.errors[0], /Claude: No logs/);
  assert.equal(status.providers.length, 2);
  const revision = status.revision;
  Object.assign(importers.claude.status, { initialized: true, files: 3, processed: 3, lastScan: '2026-10-22T09:59:00Z' });
  status = importStatus(importers, 'all', false);
  assert.equal(status.initialized, true);
  assert.equal(status.lastScan, '2026-10-22T09:59:00Z');
  assert.equal(status.files, 7);
  assert.notEqual(status.revision, revision);
});
