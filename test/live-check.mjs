import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
const get = async route => {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  return response.json();
};
assert.equal((await get('/api/health')).ok, true);
// Use completed UTC days so ongoing conversations cannot change between comparisons.
const cutoff = process.env.TEST_TO || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const reports = {};
for (const provider of ['codex', 'claude', 'all']) {
  const query = '?provider=' + provider + '&timezone=UTC&to=' + cutoff;
  const status = await get('/api/status?provider=' + provider);
  assert.equal(status.initialized, true, provider + ' scan must finish before live checks');
  assert.deepEqual(status.errors, []);
  const daily = await get('/api/report' + query);
  reports[provider] = daily;
  const weekly = await get('/api/report' + query + '&group=week');
  assert.equal(daily.totals.total_tokens, weekly.totals.total_tokens);
  for (const category of ['periods', 'sessions', 'models']) {
    for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) assert.equal(daily[category].reduce((sum, row) => sum + row[field], 0), daily.totals[field]);
    const cost = daily[category].reduce((sum, row) => sum + row.estimated_cost_usd, 0);
    assert.ok(Math.abs(cost - daily.totals.estimated_cost_usd) < 1e-6);
  }
  for (const view of ['periods', 'sessions']) {
    const response = await fetch(base + '/api/export' + query + '&view=' + view);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    assert.match(await response.text(), /pricing_fetched_at_by_provider/);
  }
  assert.ok(daily.sessions.every(row => ['codex', 'claude'].includes(row.provider)));
  assert.ok(daily.models.every(row => ['codex', 'claude'].includes(row.provider)));
  console.log(provider + ': live aggregates, attribution and exports passed');
}
for (const field of ['input_tokens','cached_input_tokens','output_tokens','total_tokens','calls','sessions','priced_calls','unpriced_calls','custom_priced_calls']) {
  assert.equal(reports.all.totals[field], reports.codex.totals[field] + reports.claude.totals[field], field);
}
assert.ok(Math.abs(reports.all.totals.estimated_cost_usd - reports.codex.totals.estimated_cost_usd - reports.claude.totals.estimated_cost_usd) < 1e-6);
const periods = new Map();
for (const provider of ['codex','claude']) for (const row of reports[provider].periods) periods.set(row.key,(periods.get(row.key)||0)+row.total_tokens);
for (const row of reports.all.periods) assert.equal(row.total_tokens,periods.get(row.key));
assert.equal((await fetch(base + '/api/report?provider=invalid')).status, 400);
for (const route of ['/api/refresh', '/api/backup', '/api/pricing/refresh', '/api/pricing/custom']) {
  const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' }, body: '{}' });
  assert.equal(response.status, 403);
}
assert.equal((await fetch(base+'/api/pricing/custom?provider=all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
console.log('All equals both providers combined; period sums and aggregate-mutation guard passed.');
