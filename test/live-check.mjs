import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
const get = async route => {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  return response.json();
};
assert.equal((await get('/api/health')).ok, true);
for (const provider of ['codex', 'claude']) {
  const query = '?provider=' + provider;
  const status = await get('/api/status' + query);
  assert.equal(status.initialized, true, provider + ' scan must finish before live checks');
  assert.deepEqual(status.errors, []);
  const daily = await get('/api/report' + query);
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
    assert.match(await response.text(), /estimated_cost_usd/);
  }
  console.log(provider + ': live aggregates and exports passed');
}
assert.equal((await fetch(base + '/api/report?provider=invalid')).status, 400);
for (const route of ['/api/refresh', '/api/backup', '/api/pricing/refresh']) {
  const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' }, body: '{}' });
  assert.equal(response.status, 403);
}
