'use strict';
const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('en-GB').format(value || 0);
const compact = value => Math.abs(value || 0) >= 1000000 ? new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : number(value);
const percent = (part, total) => total ? (100 * part / total).toFixed(1) + '%' : '0%';
const usd = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < .01 ? 4 : 2 }).format(value);
const costLabel = row => row.priced_calls ? usd(row.estimated_cost_usd) + (row.unpriced_calls ? ' *' : '') : row.calls ? 'Unpriced' : '—';
const providerLabel = provider => ({ all: 'All', codex: 'ChatGPT', claude: 'Claude' })[provider] || provider;
const loadingTasks = new Map();
let rateModel, rateProvider;
function startLoading(label = 'Loading…') {
  const token = Symbol();
  loadingTasks.set(token, label);
  $('loading-text').textContent = label;
  if (!$('loading-overlay').open) $('loading-overlay').showModal();
  $('overview').setAttribute('aria-busy', 'true');
  return () => {
    loadingTasks.delete(token);
    if (loadingTasks.size) $('loading-text').textContent = [...loadingTasks.values()].at(-1);
    else { $('loading-overlay').close(); $('overview').setAttribute('aria-busy', 'false'); }
  };
}
let report;
let meta;
let grouping = 'day';
let preset = '30';
let requestSequence = 0;
let metaSequence = 0;
let lastSignature = '';
let refreshTimer;
let sessionPage = 0;
let lastFilterQuery = '';
let sessionSortDirection = 'descending';
let periodSort = { key: 'key', direction: 'descending' };
const pageSize = 25;
const stateKey = 'tokenapp-filters-v1';
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function params() {
  return new URLSearchParams({
    from: $('from').value, to: $('to').value, timezone: $('timezone').value,
    model: $('model').value, project: $('project').value, archived: $('archived').checked,
    search: $('search').value, group: grouping
    , provider: $('provider').value
  });
}
function message(text) {
  $('message').textContent = text || '';
  $('message').hidden = !text;
}
async function json(url, options) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The app could not load this data.');
  return result;
}
function shiftDay(day, days) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function setPreset(value) {
  preset = value;
  const today = meta.today;
  $('to').value = value === 'all' ? '' : today;
  if (value === 'today') $('from').value = today;
  if (value === '30') $('from').value = shiftDay(today, -29);
  if (value === 'week') $('from').value = shiftDay(today, -(new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7);
  if (value === 'month') $('from').value = today.slice(0, 7) + '-01';
  if (value === 'all') $('from').value = '';
  document.querySelectorAll('[data-preset]').forEach(button => button.classList.toggle('selected', button.dataset.preset === preset));
}
function dateLabel(value, short = false) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: short ? 'short' : 'long', ...(!short && { year: 'numeric' }), timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
}
function timestampLabel(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: $('timezone').value }).format(new Date(value));
}
async function loadMeta() {
  const sequence = ++metaSequence;
  const result = await json('/api/meta?timezone=' + encodeURIComponent($('timezone').value) + '&provider=' + $('provider').value);
  if (sequence !== metaSequence) return;
  meta = result;
  for (const [id, entries, title] of [
    ['model', meta.models.map(value => ({ value, label: value })), 'All models'],
    ['project', meta.projects, 'All projects']
  ]) {
    const select = $(id);
    const current = select.value;
    select.replaceChildren(new Option(title, ''));
    for (const entry of entries) {
      const option = new Option(entry.label, entry.value);
      option.title = entry.value;
      select.add(option);
    }
    select.value = current;
  }
}
function saveFilters() {
  try { localStorage.setItem(stateKey, JSON.stringify({ ...Object.fromEntries(params()), preset, sort: $('sort').value, sortDirection: sessionSortDirection })); } catch { /* Storage is optional. */ }
}
async function loadReport({ silent = false } = {}) {
  const finish = silent ? () => {} : startLoading('Loading usage…');
  const sequence = ++requestSequence;
  try {
    const query = params().toString();
    if (query !== lastFilterQuery) { sessionPage = 0; lastFilterQuery = query; }
    const result = await json('/api/report?' + query);
    if (sequence !== requestSequence) return;
    report = result;
    message('');
    render();
    saveFilters();
  } catch (error) { if (sequence === requestSequence) message(error.message); }
  finally { finish(); }
}
function render() {
  const t = report.totals;
  const claude = report.options.provider === 'claude';
  const combined = report.options.provider === 'all';
  $('provider-caption').textContent = combined ? 'CHATGPT + CLAUDE' : claude ? 'CLAUDE · CODE' : 'CHATGPT · CODEX';
  $('provider-note').textContent = combined ? 'Local Codex and Claude Code sessions' : claude ? 'Local Claude Code sessions, including subagents' : 'Local Codex sessions';
  $('total-tokens').textContent = compact(t.total_tokens);
  $('total-exact').textContent = number(t.total_tokens) + ' tokens · input + output';
  $('input-tokens').textContent = compact(t.input_tokens);
  $('input-exact').textContent = number(t.input_tokens) + ' tokens processed';
  $('output-tokens').textContent = compact(t.output_tokens);
  $('output-exact').textContent = number(t.output_tokens) + ' tokens generated';
  $('session-count').textContent = number(t.sessions);
  $('call-count').textContent = number(t.calls) + ' recorded model calls';
  $('cache-summary').textContent = percent(t.cached_input_tokens, t.input_tokens) + ' cached · ' + compact(t.cached_input_tokens) + ' tokens';
  $('reasoning-summary').textContent = combined ? compact(t.reasoning_output_tokens) + ' Codex reasoning · Claude count unavailable' : claude ? 'Includes thinking · no separate token count recorded' : percent(t.reasoning_output_tokens, t.output_tokens) + ' reasoning · ' + compact(t.reasoning_output_tokens);
  const from = report.options.from || meta.first;
  const to = report.options.to || meta.last;
  $('range-label').textContent = from && to ? dateLabel(from) + ' — ' + dateLabel(to) : 'All recorded activity';
  $('history-label').textContent = meta.first ? 'Saved history: ' + dateLabel(meta.first, true) + ' — ' + dateLabel(meta.last, true) : 'No recorded history available';
  renderChart();
  renderModels();
  renderSessions();
  renderPeriods();
  renderPricing();
  $('coverage-summary').textContent = number(report.coverage.sessions_without_usage) + ' sessions without recorded counts; ' +
    number(t.legacy_calls) + ' older-format usage entries in this range.' +
    (t.partial_calls ? ' ' + number(t.partial_calls) + ' entries begin with incomplete history; earlier usage is not attributed.' : '') +
    (report.coverage.saved_sessions_without_source ? ' ' + number(report.coverage.saved_sessions_without_source) + ' sessions retained after their source logs disappeared.' : '') +
    (report.coverage.malformed_or_oversized_lines ? ' ' + number(report.coverage.malformed_or_oversized_lines) + ' malformed or oversized lines skipped.' : '');
}
function renderPricing() {
  const t = report.totals;
  $('estimated-cost').textContent = costLabel(t);
  $('cost-coverage').textContent = (!report.pricing ? 'Fetch pricing to estimate this range.' : t.unpriced_calls ? number(t.unpriced_calls) + ' calls are unpriced; shown cost covers priced calls only. You can enter rates under Model pricing.' : number(t.priced_calls) + ' calls priced in this range.') + (t.custom_priced_calls ? ' ' + number(t.custom_priced_calls) + ' use your custom rates.' : '');
  $('pricing-updated').textContent = report.options.provider === 'all' ? 'Prices by provider below' : report.pricing?.fetched_at ? 'Fetched ' + timestampLabel(Date.parse(report.pricing.fetched_at)) : 'Official prices not fetched';
  $('pricing-basis').textContent = report.pricing?.basis || 'Fetch current model prices from the official documentation. Your usage stays on this machine.';
  const selected = report.options.provider === 'all' ? ['codex', 'claude'] : [report.options.provider];
  $('pricing-sources').replaceChildren();
  for (const provider of selected) {
    const source = report.pricing?.sources?.find(item => item.provider === provider);
    const link = el('a', '', providerLabel(provider) + ' official prices');
    link.href = source?.source || (provider === 'claude' ? 'https://platform.claude.com/docs/en/about-claude/pricing' : 'https://developers.openai.com/api/docs/pricing');
    link.target = '_blank'; link.rel = 'noreferrer';
    const item = el('span', 'provider-price-source');
    item.append(link, document.createTextNode(source?.fetched_at ? ' · fetched ' + timestampLabel(Date.parse(source.fetched_at)) : ' · not fetched'));
    $('pricing-sources').append(item);
  }
  $('pricing-rows').replaceChildren();
  for (const model of report.models) {
    const row = el('tr');
    row.append(el('td', '', (report.options.provider === 'all' ? providerLabel(model.provider) + ' · ' : '') + model.model));
    for (const key of ['input', 'cached', 'write', 'writeLong', 'output']) row.append(el('td', 'numeric', model.rate?.[key] == null ? '—' : '$' + model.rate[key]));
    const status = el('td', 'rate-status', model.unpriced_calls ? 'Unpriced' : model.rate?.custom ? 'Custom' : 'Published');
    if (!model.rate || model.rate.custom || model.unpriced_calls) {
      const button = el('button', 'button rate-button', model.rate?.custom ? 'Edit rate' : 'Enter rate');
      button.type = 'button';
      button.addEventListener('click', () => openRateSettings(model));
      status.append(button);
    }
    row.append(status);
    if (model.rate?.long) row.title = 'Higher rates apply to individual requests over ' + number(model.rate.threshold) + ' input tokens.';
    $('pricing-rows').append(row);
  }
}
function openRateSettings(model) {
  rateModel = model.model;
  rateProvider = model.provider || report.options.provider;
  $('rate-title').textContent = 'Pricing for ' + providerLabel(rateProvider) + ' · ' + model.model;
  $('rate-error').textContent = '';
  for (const field of ['input', 'cached', 'write', 'writeLong', 'output']) $('rate-' + field).value = model.rate?.custom ? model.rate[field] ?? '' : '';
  $('reset-rate').hidden = !model.rate?.custom;
  $('rate-dialog').showModal();
}
function renderModels() {
  const container = $('models');
  container.replaceChildren();
  if (!report.models.length) { container.append(el('div', 'empty', 'No model activity.')); return; }
  for (const model of report.models) {
    const row = el('div', 'model-row');
    const caption = el('div', 'model-caption');
    const modelLabel = (report.options.provider === 'all' ? providerLabel(model.provider) + ' · ' : '') + model.model;
    const label = el('span', '', modelLabel);
    label.title = modelLabel;
    caption.append(label, el('span', '', compact(model.total_tokens) + ' · ' + costLabel(model)));
    const track = el('div', 'model-track');
    const fill = el('div');
    // CSSOM assignments do not require unsafe inline stylesheet execution.
    fill.style.width = percent(model.total_tokens, report.totals.total_tokens);
    track.append(fill);
    row.append(caption, track);
    row.title = number(model.total_tokens) + ' tokens · ' + number(model.calls) + ' calls';
    container.append(row);
  }
}
function sortedRows(rows, key, direction) {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]));
}
function updateSortHeaders(selector, attribute, key, direction) {
  document.querySelectorAll(selector).forEach(button => {
    const active = button.getAttribute(attribute) === key;
    button.textContent = button.dataset.sortLabel + (active ? direction === 'ascending' ? ' ↑' : ' ↓' : ' ↕');
    if (active) button.closest('th').setAttribute('aria-sort', direction);
    else button.closest('th').removeAttribute('aria-sort');
    const next = active ? direction === 'descending' ? 'ascending' : 'descending' : button.dataset.sessionSort === 'title' ? 'ascending' : 'descending';
    button.title = 'Sort by ' + button.dataset.sortLabel.toLowerCase() + ' (' + next + ')';
  });
}
function renderSessions() {
  const rows = $('session-rows');
  rows.replaceChildren();
  $('table-count').textContent = number(report.sessions.length);
  $('session-empty').hidden = report.sessions.length > 0;
  const key = { title: 'title', recent: 'last', input: 'input_tokens', cached: 'cached_input_tokens', output: 'output_tokens', total: 'total_tokens', cost: 'estimated_cost_usd' }[$('sort').value] || 'total_tokens';
  const sessions = sortedRows(report.sessions, key, sessionSortDirection);
  updateSortHeaders('[data-session-sort]', 'data-session-sort', $('sort').value, sessionSortDirection);
  sessionPage = Math.max(0, Math.min(sessionPage, Math.ceil(sessions.length / pageSize) - 1));
  $('previous-page').disabled = sessionPage === 0;
  $('next-page').disabled = (sessionPage + 1) * pageSize >= sessions.length;
  $('page-label').textContent = sessions.length ? (sessionPage * pageSize + 1) + '–' + Math.min((sessionPage + 1) * pageSize, sessions.length) + ' of ' + number(sessions.length) : '0 sessions';
  for (const session of sessions.slice(sessionPage * pageSize, (sessionPage + 1) * pageSize)) {
    const row = el('tr');
    const titleCell = el('td');
    const button = el('button', 'session-title', session.title);
    button.type = 'button';
    button.title = session.title;
    button.addEventListener('click', () => openSession(session.id));
    const subtitle = el('div', 'session-subtitle', (report.options.provider === 'all' ? providerLabel(session.provider) + ' · ' : '') + session.project + ' · ' + session.models.join(', '));
    subtitle.title = session.cwd;
    if (session.archived) subtitle.append(el('span', 'tag', 'archived'));
    if (!session.source_available) subtitle.append(el('span', 'tag', 'saved history'));
    titleCell.append(button, subtitle);
    row.append(titleCell, el('td', '', timestampLabel(session.last)), el('td', 'numeric', number(session.input_tokens)),
      el('td', 'numeric', number(session.cached_input_tokens)));
    const output = el('td', 'numeric', number(session.output_tokens));
    if (session.provider !== 'claude') output.append(el('span', 'cell-secondary', number(session.reasoning_output_tokens) + ' reasoning'));
    row.append(output, el('td', 'numeric total-cell', number(session.total_tokens)), el('td', 'numeric', costLabel(session)));
    rows.append(row);
  }
}
function renderPeriods() {
  const weekly = grouping === 'week';
  $('period-heading').textContent = weekly ? 'Weekly totals' : 'Daily totals';
  $('period-column').dataset.sortLabel = weekly ? 'Week starting Monday' : 'Day';
  updateSortHeaders('[data-period-sort]', 'data-period-sort', periodSort.key, periodSort.direction);
  $('period-rows').replaceChildren();
  for (const period of sortedRows(report.periods, periodSort.key, periodSort.direction)) {
    const row = el('tr');
    row.append(el('td', '', dateLabel(period.key)), ...['sessions', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens'].map(key => el('td', 'numeric', number(period[key]))), el('td', 'numeric', costLabel(period)));
    $('period-rows').append(row);
  }
}
function svgNode(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}
function renderChart() {
  const container = $('chart');
  container.replaceChildren();
  if (!report.periods.length) { container.append(el('div', 'empty', 'No activity in this date range.')); return; }
  const metric = $('chart-metric').value;
  const width = Math.max(container.clientWidth, 260), height = 230;
  const padding = { left: 43, top: 12, bottom: 32, right: 5 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const byKey = new Map(report.periods.map(period => [period.key, period]));
  let first = report.options.from || report.periods[0].key;
  let last = report.options.to || report.periods.at(-1).key;
  if (grouping === 'week') {
    first = shiftDay(first, -(new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7);
    last = shiftDay(last, -(new Date(last + 'T12:00:00Z').getUTCDay() + 6) % 7);
  }
  const periods = [];
  for (let day = first; day <= last && periods.length < 4000; day = shiftDay(day, grouping === 'week' ? 7 : 1)) {
    periods.push(byKey.get(day) || { key: day, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  }
  if (!periods.length) return;
  const maxBars = Math.max(15, Math.floor(chartWidth / 5));
  const stride = Math.ceil(periods.length / maxBars);
  const plotted = [];
  for (let i = 0; i < periods.length; i += stride) {
    const part = periods.slice(i, i + stride);
    plotted.push(part.reduce((sum, row) => ({
      key: sum.key, end: row.key,
      input_tokens: sum.input_tokens + row.input_tokens, cached_input_tokens: sum.cached_input_tokens + row.cached_input_tokens,
      output_tokens: sum.output_tokens + row.output_tokens, total_tokens: sum.total_tokens + row.total_tokens
    }), { key: part[0].key, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 }));
  }
  const max = Math.max(...plotted.map(row => row[metric]), 1) * 1.1;
  const svg = svgNode('svg', { viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true' });
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + chartHeight * i / 4;
    svg.append(svgNode('line', { x1: padding.left, y1: y, x2: width - padding.right, y2: y, stroke: '#e9ede3', 'stroke-dasharray': i === 4 ? '0' : '3 4' }));
    svg.append(svgNode('text', { x: padding.left - 9, y: y + 3, 'text-anchor': 'end', fill: '#9aa38d', 'font-size': 8 }, compact(max * (4 - i) / 4)));
  }
  const step = chartWidth / plotted.length;
  plotted.forEach((period, index) => {
    const segments = metric === 'output_tokens' ? [[period.output_tokens, '#dc7644']] :
      metric === 'input_tokens' ? [[period.input_tokens - period.cached_input_tokens, '#30776c'], [period.cached_input_tokens, '#9abfb5']] :
        [[period.input_tokens - period.cached_input_tokens, '#30776c'], [period.cached_input_tokens, '#9abfb5'], [period.output_tokens, '#dc7644']];
    let base = padding.top + chartHeight;
    const group = svgNode('g');
    group.append(svgNode('title', {}, dateLabel(period.key) + (period.key !== period.end ? ' — ' + dateLabel(period.end) : '') +
      '\nInput: ' + number(period.input_tokens) + '\nCached input: ' + number(period.cached_input_tokens) + '\nOutput: ' + number(period.output_tokens)));
    for (const [value, color] of segments) {
      const barHeight = chartHeight * value / max;
      base -= barHeight;
      group.append(svgNode('rect', { x: padding.left + index * step + step * .2, y: base, width: Math.max(1, step * .6), height: barHeight, fill: color, rx: Math.min(2, step * .1) }));
    }
    svg.append(group);
    const labelEvery = Math.max(1, Math.ceil(plotted.length / (width < 400 ? 4 : 7)));
    if (index % labelEvery === 0) svg.append(svgNode('text', { x: padding.left + (index + .5) * step, y: height - 8, 'text-anchor': 'middle', fill: '#919c84', 'font-size': 8 }, dateLabel(period.key, true)));
  });
  container.append(svg);
  container.setAttribute('aria-label', (grouping === 'week' ? 'Weekly' : 'Daily') + ' ' + metric.replaceAll('_', ' ') + '. ' + number(report.totals[metric]) + ' in the selected range. Exact values are available in the totals table.');
  $('chart-note').textContent = stride > 1 ? 'Bars combine ' + stride + ' ' + (grouping === 'week' ? 'weeks' : 'days') : grouping === 'week' ? 'Weeks start on Monday' : 'Hover a bar for exact counts';
}
async function openSession(id) {
  const finish = startLoading('Loading session…');
  try {
  const query = params();
  query.set('session', id);
  const result = await json('/api/report?' + query);
  const session = result.sessions[0];
  if (!session) { message('This session has no usage in the selected range.'); return; }
  $('detail-title').textContent = session.title;
  const content = $('detail-content');
  content.replaceChildren();
  content.append(el('div', 'detail-meta', session.cwd), el('div', 'detail-meta', 'Session ' + session.id),
    el('div', 'detail-meta', providerLabel(session.provider) + ' · ' + session.models.join(' · ') + ' · ' + number(session.calls) + ' recorded calls' + (session.archived ? ' · Archived' : '')));
  const metrics = el('div', 'detail-metrics');
  for (const [label, value] of [['Input', session.input_tokens], ['Cached input', session.cached_input_tokens], ['Output', session.output_tokens], ['Cache writes', session.cache_write_input_tokens]]) {
    const item = el('div', 'detail-metric');
    item.append(el('span', '', label), el('strong', '', compact(value)));
    item.title = number(value) + ' tokens';
    metrics.append(item);
  }
  content.append(metrics, el('p', 'detail-explainer', 'Estimated token cost: ' + costLabel(session) + (session.priced_calls ? ' USD at the selected rates.' : '.')), el('h3', '', 'Model calls'), el('p', 'detail-explainer', 'Latest ' + result.details.length + ' of ' + number(result.detail_count) + ' recorded calls in the selected range. Times use ' + $('timezone').value + '.'));
  const scroll = el('div', 'table-scroll');
  const table = el('table');
  const head = el('thead');
  const header = el('tr');
  for (const title of ['Time', 'Model', 'Input', 'Cached', 'Output', 'Cost (USD)']) header.append(el('th', title === 'Time' || title === 'Model' ? '' : 'numeric', title));
  head.append(header);
  const body = el('tbody');
  for (const call of result.details) {
    const row = el('tr');
    row.append(el('td', '', timestampLabel(call.timestamp)), el('td', '', call.model));
    for (const field of ['input_tokens', 'cached_input_tokens', 'output_tokens']) row.append(el('td', 'numeric', number(call[field])));
    row.append(el('td', 'numeric', call.estimated_cost_usd == null ? 'Unpriced' : usd(call.estimated_cost_usd)));
    row.title = ['record', 'claude'].includes(call.source) ? 'Per-call usage record' : 'Usage derived from older log counters';
    body.append(row);
  }
  table.append(head, body); scroll.append(table); content.append(scroll);
  $('session-dialog').showModal();
  } catch (error) { message(error.message); }
  finally { finish(); }
}
async function poll() {
  if (loadingTasks.size) { refreshTimer = setTimeout(poll, 3000); return; }
  try {
    const provider = $('provider').value;
    const status = await json('/api/status?provider=' + provider);
    if (provider !== $('provider').value) return;
    $('sync-status').textContent = status.running ? provider === 'all' ? 'Updating sources…' : 'Importing ' + status.processed + ' / ' + status.files : status.lastScan ? 'Updated ' + new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(status.lastScan)) : 'Waiting for logs';
    $('import-summary').textContent = number(status.files) + ' source files (' + number(status.compressedFiles) + ' compressed) · ' + (status.running ? 'scan in progress' : status.lastScan ? 'last scan ' + timestampLabel(Date.parse(status.lastScan)) : 'first scan pending');
    $('import-errors').textContent = status.errors.slice(0, 4).join(' · ');
    $('backup-summary').textContent = status.backups?.error ? 'Backup failed: ' + status.backups.error :
      status.backups?.lastBackup ? 'Daily backups enabled · last saved ' + timestampLabel(Date.parse(status.backups.lastBackup)) : 'First backup pending.';
    const signature = [provider, status.revision || status.lastScan, status.running ? Math.floor(status.processed / 20) : 'done'].join(':');
    if (signature !== lastSignature && !loadingTasks.size) {
      lastSignature = signature;
      await loadMeta();
      if (!loadingTasks.size) {
        if (preset) setPreset(preset);
        await loadReport({ silent: true });
      }
    }
  } catch (error) { $('sync-status').textContent = 'Connection lost'; message(error.message); }
  refreshTimer = setTimeout(poll, 3000);
}
function exportCsv(view) {
  const query = params();
  query.set('view', view);
  location.href = '/api/export?' + query;
}
function debounce(callback, ms) {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(callback, ms); };
}
async function boot() {
  const finishBoot = startLoading('Loading your dashboard…');
  $('loading-overlay').addEventListener('cancel', event => event.preventDefault());
  try {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(stateKey) || 'null'); } catch { /* Start with defaults. */ }
    if (saved?.timezone && [...$('timezone').options].some(option => option.value === saved.timezone)) $('timezone').value = saved.timezone;
    if (['all', 'claude', 'codex'].includes(saved?.provider)) $('provider').value = saved.provider;
    await loadMeta();
    if (saved) {
      for (const key of ['from', 'to', 'model', 'project', 'search']) if (saved[key] != null) $(key).value = saved[key];
      $('archived').checked = saved.archived !== 'false';
      grouping = saved.group === 'week' ? 'week' : 'day';
      $('sort').value = saved.sort || 'total';
      sessionSortDirection = ['ascending', 'descending'].includes(saved.sortDirection) ? saved.sortDirection : saved.sort === 'title' ? 'ascending' : 'descending';
      preset = saved.preset;
      if (preset) setPreset(preset);
    } else setPreset('30');
    $('daily').classList.toggle('selected', grouping === 'day');
    $('weekly').classList.toggle('selected', grouping === 'week');
    await loadReport();
    $('provider').addEventListener('change', async () => {
      const finish = startLoading('Switching dashboard…');
      try {
      ++requestSequence;
      for (const id of ['model', 'project', 'search']) $(id).value = '';
      await loadMeta();
      await loadReport({ silent: true });
      clearTimeout(refreshTimer);
      await poll();
      } catch (error) { message(error.message); }
      finally { finish(); }
    });
    $('fetch-pricing').addEventListener('click', async () => {
      $('fetch-pricing').disabled = true;
      $('fetch-pricing').textContent = 'Fetching…';
      const finish = startLoading('Fetching model prices…');
      try {
        const result = await json('/api/pricing/refresh?provider=' + $('provider').value, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await loadReport({ silent: true });
        if (result.partial) message('Some prices were updated. ' + result.providers.filter(item => !item.ok).map(item => providerLabel(item.provider) + ': ' + item.error).join(' · '));
      } catch (error) { message(error.message); }
      finally { finish(); $('fetch-pricing').disabled = false; $('fetch-pricing').textContent = 'Fetch pricing'; }
    });
    document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { setPreset(button.dataset.preset); loadReport(); }));
    for (const id of ['from', 'to']) $(id).addEventListener('change', () => {
      preset = null;
      document.querySelectorAll('[data-preset]').forEach(button => button.classList.remove('selected'));
      loadReport();
    });
    for (const id of ['model', 'project', 'archived']) $(id).addEventListener('change', loadReport);
    $('timezone').addEventListener('change', async () => {
      const finish = startLoading('Updating dates…');
      try {
      await loadMeta();
      if (preset) setPreset(preset);
      await loadReport({ silent: true });
      } catch (error) { message(error.message); }
      finally { finish(); }
    });
    for (const [id, group] of [['daily', 'day'], ['weekly', 'week']]) $(id).addEventListener('click', () => {
      grouping = group;
      $('daily').classList.toggle('selected', group === 'day');
      $('weekly').classList.toggle('selected', group === 'week');
      loadReport();
    });
    $('search').addEventListener('input', debounce(loadReport, 200));
    $('sort').addEventListener('change', () => { sessionPage = 0; sessionSortDirection = $('sort').value === 'title' ? 'ascending' : 'descending'; renderSessions(); saveFilters(); });
    document.querySelectorAll('[data-session-sort]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.sessionSort;
      sessionSortDirection = $('sort').value === key ? sessionSortDirection === 'descending' ? 'ascending' : 'descending' : key === 'title' ? 'ascending' : 'descending';
      $('sort').value = key;
      sessionPage = 0;
      renderSessions();
      saveFilters();
    }));
    document.querySelectorAll('[data-period-sort]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.periodSort;
      periodSort = { key, direction: periodSort.key === key && periodSort.direction === 'descending' ? 'ascending' : 'descending' };
      renderPeriods();
    }));
    $('previous-page').addEventListener('click', () => { sessionPage--; renderSessions(); });
    $('next-page').addEventListener('click', () => { sessionPage++; renderSessions(); });
    $('chart-metric').addEventListener('change', renderChart);
    $('export-sessions').addEventListener('click', () => exportCsv('sessions'));
    $('export-periods').addEventListener('click', () => exportCsv('periods'));
    $('close-dialog').addEventListener('click', () => $('session-dialog').close());
    $('backup-now').addEventListener('click', async () => {
      $('backup-now').disabled = true;
      const finish = startLoading('Saving a backup…');
      try {
        await json('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        clearTimeout(refreshTimer);
        await poll();
      } catch (error) { message(error.message); }
      finally { finish(); $('backup-now').disabled = false; }
    });
    $('session-dialog').addEventListener('click', event => { if (event.target === $('session-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
    $('refresh').addEventListener('click', async () => {
      $('refresh').disabled = true;
      const finish = startLoading('Refreshing usage…');
      try {
        await json('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await loadMeta();
        await loadReport({ silent: true });
        clearTimeout(refreshTimer);
        await poll();
      } catch (error) { message(error.message); }
      finally { finish(); $('refresh').disabled = false; }
    });
    $('close-rate').addEventListener('click', () => $('rate-dialog').close());
    $('rate-form').addEventListener('submit', async event => {
      event.preventDefault();
      const finish = startLoading('Saving custom prices…');
      const rates = Object.fromEntries(['input', 'cached', 'write', 'writeLong', 'output'].map(field => [field, $('rate-' + field).value === '' ? null : Number($('rate-' + field).value)]));
      try {
        await json('/api/pricing/custom?provider=' + rateProvider, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: rateModel, rates }) });
        $('rate-dialog').close();
        await loadReport({ silent: true });
      } catch (error) { $('rate-error').textContent = error.message; }
      finally { finish(); }
    });
    $('reset-rate').addEventListener('click', async () => {
      const finish = startLoading('Removing custom prices…');
      try {
        await json('/api/pricing/custom?provider=' + rateProvider, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: rateModel, reset: true }) });
        $('rate-dialog').close();
        await loadReport({ silent: true });
      } catch (error) { $('rate-error').textContent = error.message; }
      finally { finish(); }
    });
    window.addEventListener('resize', debounce(() => { if (report) renderChart(); }, 100));
    poll();
  } catch (error) { message(error.message); $('sync-status').textContent = 'Could not connect'; }
  finally { finishBoot(); }
}
boot();
