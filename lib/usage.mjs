import { createHash } from 'node:crypto';

export const FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.input_tokens) || !Number.isFinite(raw.output_tokens)) return null;
  const result = {};
  for (const field of FIELDS) result[field] = Number.isSafeInteger(raw[field]) && raw[field] >= 0 ? raw[field] : 0;
  result.cached_input_tokens = Math.min(result.cached_input_tokens, result.input_tokens);
  result.cache_write_input_tokens = Math.min(result.cache_write_input_tokens, result.input_tokens - result.cached_input_tokens);
  result.reasoning_output_tokens = Math.min(result.reasoning_output_tokens, result.output_tokens);
  result.total_tokens = result.input_tokens + result.output_tokens;
  return result;
}
export function fingerprint(usage) {
  return FIELDS.map(field => usage[field] || 0).join(':');
}
export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
export function difference(total, previous, last) {
  if (!total) return last;
  if (!previous) return total;
  if (total.input_tokens < previous.input_tokens || total.output_tokens < previous.output_tokens) return last;
  const delta = {};
  for (const field of FIELDS) delta[field] = Math.max(0, total[field] - previous[field]);
  return normalizeUsage(delta);
}
export function emptyUsage() {
  return Object.fromEntries(FIELDS.map(field => [field, 0]));
}
export function addUsage(target, source) {
  for (const field of FIELDS) target[field] += source[field] || 0;
  return target;
}
export function dateFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}
export function dayKey(timestamp, formatter) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const get = type => parts.find(part => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
export function weekKey(day) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
