import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { normalizeUsage, dayKey, dateFormatter, weekKey, validDay, csvCell } from '../lib/usage.mjs';
import { getReport, optionsFrom, reportCsv } from '../lib/report.mjs';

const usage = (input, output, cached = 0, reasoning = 0) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output
});
const modern = (id, last, total, timestamp = '2026-10-22T10:00:00Z', thread = 's1') => ({
  type: 'token_usage_record', timestamp, payload: { response_id: id, thread_id: thread, turn_id: 't1', usage: last, thread_token_usage: total }
});
const legacy = (last, total, timestamp = '2026-10-22T10:00:00Z') => ({
  type: 'event_msg', timestamp, payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: total } }
});
function setup() {
  const store = new Store(':memory:');
  const state = {};
  store.consume({ type: 'session_meta', payload: { id: 's1', cwd: 'C:\\Projects\\test', timestamp: '2026-10-22T09:00:00Z' } }, state);
  store.consume({ type: 'turn_context', payload: { model: 'model-a', turn_id: 't1' } }, state);
  return { store, state, count: () => store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n };
}
const report = (store, overrides = {}) => getReport(store, { from: '', to: '', timezone: 'Europe/Helsinki', group: 'day', model: '', project: '', search: '', archived: true, session: '', ...overrides });

test('modern records and their mirrored notifications are counted once in either order', () => {
  for (const order of ['modern-first', 'legacy-first']) {
    const { store, state, count } = setup();
    const u = usage(100, 30, 80, 10);
    const records = [modern('r1', u, u), legacy(u, u)];
    if (order === 'legacy-first') records.reverse();
    records.forEach(record => store.consume(record, state));
    records.forEach(record => store.consume(record, state));
    assert.equal(count(), 1);
    assert.equal(report(store).totals.total_tokens, 130);
    assert.equal(report(store).totals.output_tokens, 30);
    assert.equal(report(store).totals.reasoning_output_tokens, 10);
    store.close();
  }
});
test('modern response IDs deduplicate copied history across sessions and files', () => {
  const { store, state, count } = setup();
  const u = usage(100, 30);
  store.consume(modern('r1', u, u), state);
  store.consume(modern('r1', u, u), { sessionId: 'fork', model: 'model-b' });
  assert.equal(count(), 1);
  store.close();
});
test('legacy totals produce deltas, ignore duplicate events, and survive counter resets', () => {
  const { store, state, count } = setup();
  store.consume(legacy(usage(100, 10), usage(100, 10)), state);
  const second = legacy(usage(70, 15), usage(170, 25), '2026-10-22T10:01:00Z');
  store.consume(second, state);
  store.consume(second, state);
  store.consume(legacy(usage(20, 5), usage(20, 5), '2026-10-22T10:02:00Z'), state);
  assert.equal(count(), 3);
  assert.equal(report(store).totals.input_tokens, 190);
  assert.equal(report(store).totals.output_tokens, 30);
  store.close();
});
test('legacy totals retain omitted intermediate calls instead of trusting only last-call usage', () => {
  const { store, state } = setup();
  store.consume(legacy(usage(100, 10), usage(100, 10)), state);
  store.consume(legacy(usage(20, 2), usage(250, 50), '2026-10-22T10:01:00Z'), state);
  assert.equal(report(store).totals.total_tokens, 300);
  store.close();
});
test('first partial legacy snapshots attribute only the known call and disclose the gap', () => {
  const { store, state } = setup();
  store.consume(legacy(usage(10, 2), usage(1000, 200)), state);
  assert.equal(report(store).totals.total_tokens, 12);
  assert.equal(report(store).totals.partial_calls, 1);
  store.consume(modern('r1', usage(10, 2), usage(1000, 200)), state);
  assert.equal(report(store).totals.total_tokens, 12);
  assert.equal(report(store).totals.partial_calls, 0);
  store.close();
});
test('mixed old and new records retain old calls without adding mirror totals', () => {
  const { store, state } = setup();
  store.consume(legacy(usage(100, 10), usage(100, 10)), state);
  store.consume({ type: 'turn_context', payload: { turn_id: 't2', model: 'model-a' } }, state);
  store.consume(modern('r2', usage(50, 5), usage(150, 15), '2026-10-22T10:01:00Z'), state);
  store.consume(legacy(usage(50, 5), usage(150, 15), '2026-10-22T10:01:01Z'), state);
  assert.equal(report(store).totals.total_tokens, 165);
  store.close();
});
test('per-call records win when mirrored cumulative counters are adjusted after compaction', () => {
  const { store, state } = setup();
  store.consume(modern('r1', usage(100, 10), usage(100, 10)), state);
  store.consume(legacy(usage(100, 10), usage(94, 9)), state);
  store.consume(modern('r2', usage(50, 5), usage(150, 15)), state);
  store.consume(legacy(usage(50, 5), usage(140, 14), '2026-10-22T10:01:00Z'), state);
  assert.equal(report(store).totals.input_tokens, 150);
  assert.equal(report(store).totals.output_tokens, 15);
  assert.equal(report(store).totals.calls, 2);
  store.close();
});
test('fallback notifications before the first modern record are replaced despite different totals', () => {
  const { store, state } = setup();
  store.consume(legacy(usage(94, 9), usage(94, 9)), state);
  store.consume(modern('r1', usage(100, 10), usage(100, 10)), state);
  assert.equal(report(store).totals.total_tokens, 110);
  assert.equal(report(store).totals.calls, 1);
  store.close();
});
test('replay removes fallback rows created by the previous parser without changing canonical calls', () => {
  const { store, state } = setup();
  store.consume(legacy(usage(94, 9), usage(94, 9)), state);
  store.db.exec('UPDATE events SET coverage_key=NULL');
  const replay = { sessionId: 's1', turnId: 't1', coverageKey: 'turn:t1', model: 'model-a' };
  store.consume(modern('r1', usage(100, 10), usage(100, 10)), replay);
  store.consume(legacy(usage(94, 9), usage(94, 9)), replay);
  assert.equal(report(store).totals.total_tokens, 110);
  assert.equal(report(store).totals.calls, 1);
  store.close();
});
test('missing usage is unknown and malformed numeric counts are rejected', () => {
  const { store, state, count } = setup();
  store.consume(legacy(null, null), state);
  store.consume(modern('bad', { input_tokens: '500', output_tokens: 20 }, null), state);
  assert.equal(count(), 0);
  assert.equal(report(store).coverage.sessions_without_usage, 1);
  assert.equal(normalizeUsage(usage(100, 20, 200, 50)).cached_input_tokens, 100);
  assert.equal(normalizeUsage(usage(100, 20, 200, 50)).reasoning_output_tokens, 20);
  store.close();
});
test('Helsinki dates respect midnight and both sides of the daylight-saving change', () => {
  const fmt = dateFormatter('Europe/Helsinki');
  assert.equal(dayKey(Date.parse('2026-10-22T21:30:00Z'), fmt), '2026-10-23');
  assert.equal(dayKey(Date.parse('2026-10-25T00:30:00Z'), fmt), '2026-10-25');
  assert.equal(dayKey(Date.parse('2026-10-25T01:30:00Z'), fmt), '2026-10-25');
  assert.equal(dayKey(Date.parse('2026-10-25T22:30:00Z'), fmt), '2026-10-26');
});
test('daily and Monday-based weekly filters include only activity inside the selected range', () => {
  const { store, state } = setup();
  const u = usage(100, 10);
  store.consume(modern('before', u, u, '2026-10-22T20:59:59Z'), state);
  store.consume(modern('inside', u, usage(200, 20), '2026-10-22T21:00:00Z'), state);
  store.consume(modern('after', u, usage(300, 30), '2026-10-23T21:00:00Z'), state);
  const result = report(store, { from: '2026-10-23', to: '2026-10-23', group: 'week' });
  assert.equal(result.totals.calls, 1);
  assert.equal(result.periods[0].key, '2026-10-19');
  assert.equal(weekKey('2026-01-01'), '2025-12-29');
  assert.equal(report(store, { from: '2026-10-22', to: '2026-10-22', timezone: 'UTC' }).totals.calls, 2);
  store.close();
});
test('model, project, search, archived, and session filters remain consistent', () => {
  const { store, state } = setup();
  store.consume(modern('r1', usage(100, 10), usage(100, 10)), state);
  store.db.prepare('UPDATE sessions SET title=?,archived=1 WHERE id=?').run('My task', 's1');
  assert.equal(report(store, { model: 'other' }).totals.calls, 0);
  assert.equal(report(store, { project: 'C:\\Projects\\test' }).totals.calls, 1);
  assert.equal(report(store, { search: 'my TASK' }).totals.calls, 1);
  assert.equal(report(store, { archived: false }).totals.calls, 0);
  assert.equal(report(store, { session: 's1' }).details.length, 1);
  store.close();
});
test('date validation rejects impossible dates and reversed ranges', () => {
  assert.equal(validDay('2026-02-30'), false);
  assert.equal(validDay('2024-02-29'), true);
  assert.throws(() => optionsFrom(new URLSearchParams('from=2026-10-23&to=2026-10-22')));
  assert.throws(() => optionsFrom(new URLSearchParams('timezone=NoSuch/Zone')));
});
test('CSV exports retain totals and escape formulas, quotes, and line breaks', () => {
  const { store, state } = setup();
  store.consume(modern('r1', usage(100, 10), usage(100, 10)), state);
  store.db.prepare('UPDATE sessions SET title=? WHERE id=?').run('=SUM(1,2)"\nhello', 's1');
  const csv = reportCsv(report(store));
  assert.match(csv, /'=SUM\(1,2\)""\nhello/);
  assert.match(csv, /"100","0","0","10","0","110","1"/);
  assert.equal(csvCell('@formula'), "\"'@formula\"");
  store.close();
});
