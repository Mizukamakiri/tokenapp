import path from 'node:path';
import { emptyUsage, addUsage, dateFormatter, dayKey, weekKey, validDay, csvCell } from './usage.mjs';
import { Pricing, estimateCost, modelKey } from './pricing.mjs';

export function optionsFrom(params, defaultTimezone = 'Europe/Helsinki') {
  const options = {
    provider: params.get('provider') || 'codex',
    from: params.get('from') || '', to: params.get('to') || '',
    timezone: params.get('timezone') || defaultTimezone,
    group: params.get('group') || 'day', model: params.get('model') || '',
    project: params.get('project') || '', search: (params.get('search') || '').slice(0, 300),
    archived: params.get('archived') !== 'false', session: params.get('session') || ''
  };
  if (!['codex', 'claude'].includes(options.provider)) throw new Error('Choose Claude or ChatGPT.');
  if ((options.from && !validDay(options.from)) || (options.to && !validDay(options.to))) throw new Error('Use a valid date in YYYY-MM-DD format.');
  if (options.from && options.to && options.from > options.to) throw new Error('The start date must come before the end date.');
  if (!['day', 'week'].includes(options.group)) throw new Error('Choose daily or weekly grouping.');
  dateFormatter(options.timezone); // Validate the timezone before querying.
  return options;
}
export function projectName(cwd) {
  return cwd ? path.win32.basename(cwd.replaceAll('/', '\\')) || cwd : 'Unknown project';
}
export function getReport(store, options) {
  const formatter = dateFormatter(options.timezone);
  const clauses = ['1=1'];
  const args = [];
  clauses.push('s.provider=?'); args.push(options.provider || 'codex');
  const catalog = new Pricing(store).get(options.provider || 'codex');
  if (options.from) { clauses.push('e.ts>=?'); args.push(Date.parse(options.from + 'T00:00:00Z') - 36 * 3600000); }
  if (options.to) { clauses.push('e.ts<?'); args.push(Date.parse(options.to + 'T00:00:00Z') + 60 * 3600000); }
  if (options.model) { clauses.push('e.model=?'); args.push(options.model); }
  if (options.project) { clauses.push('s.cwd=?'); args.push(options.project); }
  if (!options.archived) clauses.push('s.archived=0');
  if (options.session) { clauses.push('e.session_id=?'); args.push(options.session); }
  const rows = store.db.prepare('SELECT e.*,s.title,s.cwd,s.archived,s.seen FROM events e JOIN sessions s ON s.id=e.session_id WHERE ' +
    clauses.join(' AND ') + ' ORDER BY e.ts,e.id').iterate(...args);
  const costFields = () => ({ estimated_cost_usd: 0, priced_calls: 0, unpriced_calls: 0, custom_priced_calls: 0 });
  const addCost = (target, cost, custom) => { if (cost == null) target.unpriced_calls++; else { target.estimated_cost_usd += cost; target.priced_calls++; if (custom) target.custom_priced_calls++; } };
  const totals = { ...emptyUsage(), ...costFields(), calls: 0, sessions: 0, legacy_calls: 0, partial_calls: 0 };
  const periods = new Map();
  const sessions = new Map();
  const models = new Map();
  const details = [];
  const dates = new Map();
  for (const row of rows) {
    // Modern IANA offsets have minute precision. Reuse conversions for calls
    // in the same minute without crossing midnight or DST boundaries.
    const minute = Math.floor(row.ts / 60000);
    let day = dates.get(minute);
    if (!day) { day = dayKey(row.ts, formatter); dates.set(minute, day); }
    if (options.from && day < options.from || options.to && day > options.to) continue;
    const title = row.title || projectName(row.cwd) || row.session_id;
    if (options.search && ![title, row.cwd, row.session_id].join(' ').toLowerCase().includes(options.search.toLowerCase())) continue;
    addUsage(totals, row);
    const cost = estimateCost(row, catalog);
    const custom = !!catalog?.rates[modelKey(catalog.provider, row.model)]?.custom;
    addCost(totals, cost, custom);
    totals.calls++;
    if (!['record', 'claude'].includes(row.source)) totals.legacy_calls++;
    if (row.source === 'legacy_partial') totals.partial_calls++;
    const key = options.group === 'week' ? weekKey(day) : day;
    if (!periods.has(key)) periods.set(key, { key, ...emptyUsage(), ...costFields(), calls: 0, ids: new Set() });
    const period = periods.get(key);
    addUsage(period, row);
    addCost(period, cost, custom);
    period.calls++;
    period.ids.add(row.session_id);
    if (!sessions.has(row.session_id)) sessions.set(row.session_id, {
      id: row.session_id, title, cwd: row.cwd || '', project: projectName(row.cwd), archived: !!row.archived, source_available: !!row.seen,
      first: row.ts, last: row.ts, models: new Set(), calls: 0, ...emptyUsage(), ...costFields()
    });
    const session = sessions.get(row.session_id);
    addUsage(session, row);
    addCost(session, cost, custom);
    session.calls++;
    session.last = row.ts;
    session.models.add(row.model);
    if (!models.has(row.model)) models.set(row.model, { model: row.model, calls: 0, ...emptyUsage(), ...costFields(), rate: catalog?.rates[modelKey(catalog.provider, row.model)] || null });
    addUsage(models.get(row.model), row);
    addCost(models.get(row.model), cost, custom);
    models.get(row.model).calls++;
    if (options.session) details.push({
      timestamp: row.ts, model: row.model, turn_id: row.turn_id, source: row.source, estimated_cost_usd: cost,
      ...Object.fromEntries(Object.keys(emptyUsage()).map(field => [field, row[field]]))
    });
  }
  totals.sessions = sessions.size;
  const noUsage = store.db.prepare('SELECT COUNT(*) AS n FROM sessions s WHERE provider=? AND NOT EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id)').get(options.provider || 'codex').n;
  const retained = store.db.prepare('SELECT COUNT(*) AS n FROM sessions s WHERE provider=? AND seen=0 AND EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id)').get(options.provider || 'codex').n;
  return {
    options, totals, pricing: catalog && { fetched_at: catalog.fetched_at, source: catalog.source, currency: 'USD', basis: 'Current standard API prices, plus any rates you enter (labelled Custom). Excludes subscription fees, tools, taxes, speed and regional adjustments. Legacy combined counters use short-context rates. Unknown cache-write durations use the short-duration rate.' },
    periods: [...periods.values()].map(({ ids, ...period }) => ({ ...period, sessions: ids.size })),
    sessions: [...sessions.values()].map(session => ({ ...session, models: [...session.models] })).sort((a, b) => b.total_tokens - a.total_tokens),
    models: [...models.values()].sort((a, b) => b.total_tokens - a.total_tokens),
    details: details.slice(-250).reverse(), detail_count: details.length,
    coverage: { sessions_without_usage: noUsage, saved_sessions_without_source: retained, malformed_or_oversized_lines: store.db.prepare('SELECT COALESCE(SUM(bad_lines),0) AS n FROM files WHERE provider=?').get(options.provider || 'codex').n }
  };
}
export function metadata(store, timezone, provider = 'codex') {
  const formatter = dateFormatter(timezone);
  const range = store.db.prepare('SELECT MIN(e.ts) AS first,MAX(e.ts) AS last FROM events e JOIN sessions s ON s.id=e.session_id WHERE s.provider=?').get(provider);
  return {
    timezone, today: dayKey(Date.now(), formatter),
    first: range.first == null ? null : dayKey(range.first, formatter),
    last: range.last == null ? null : dayKey(range.last, formatter),
    models: store.db.prepare('SELECT DISTINCT model FROM events e JOIN sessions s ON s.id=e.session_id WHERE s.provider=? ORDER BY model').all(provider).map(row => row.model),
    projects: store.db.prepare("SELECT DISTINCT cwd FROM sessions WHERE provider=? AND cwd IS NOT NULL AND cwd<>'' ORDER BY cwd").all(provider)
      .map(row => ({ value: row.cwd, label: projectName(row.cwd) }))
  };
}
export function reportCsv(report, view = 'sessions') {
  let columns;
  let rows;
  const numeric = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens', 'calls', 'estimated_cost_usd', 'priced_calls', 'unpriced_calls', 'custom_priced_calls'];
  const numericValue = (row, key) => key === 'estimated_cost_usd' && row.unpriced_calls && !row.priced_calls ? '' : row[key];
  if (view === 'periods') {
    columns = ['period_start', 'grouping', 'timezone', ...numeric, 'sessions'];
    rows = report.periods.map(row => [row.key, report.options.group, report.options.timezone, ...numeric.map(key => numericValue(row, key)), row.sessions]);
  } else {
    columns = ['session_id', 'title', 'project_path', 'models', 'archived', 'first_activity_utc', 'last_activity_utc', 'range_from', 'range_to', 'timezone', ...numeric];
    rows = report.sessions.map(row => [
      row.id, row.title, row.cwd, row.models.join('; '), row.archived, new Date(row.first).toISOString(), new Date(row.last).toISOString(),
      report.options.from, report.options.to, report.options.timezone, ...numeric.map(key => numericValue(row, key))
    ]);
  }
  columns.push('provider', 'pricing_fetched_at');
  rows.forEach(row => row.push(report.options.provider || 'codex', report.pricing?.fetched_at || ''));
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
