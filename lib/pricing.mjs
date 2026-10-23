export const PRICE_SOURCES = {
  codex: 'https://developers.openai.com/api/docs/pricing',
  claude: 'https://platform.claude.com/docs/en/about-claude/pricing'
};

const money = value => {
  const match = value?.match(/\$([\d,.]+)/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
};
export function modelKey(provider, value) {
  const key = value.toLowerCase().trim();
  return provider === 'claude' ? key.replace(/-\d{8}$/, '') : key.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

// Only read priced table cells from official Markdown. No page code is executed.
export function parsePricing(provider, markdown) {
  const rates = {};
  let headers = [], mode = 'standard', inClaudeTable = false;
  for (const line of markdown.split('\n')) {
    const text = line.trim();
    if (provider === 'codex') {
      const tier = text.match(/^(?:#{1,4}\s+)?(Standard|Batch|Flex|Fast|Ultrafast)(?: pricing data)?$/i);
      if (tier) mode = tier[1].toLowerCase();
    } else {
      if (/^## Model pricing/.test(text)) inClaudeTable = true;
      else if (inClaudeTable && /^## /.test(text)) break;
      if (!inClaudeTable) continue;
    }
    if (!text.startsWith('|')) continue;
    const cells = text.slice(1).replace(/\|$/, '').split('|').map(cell => cell.trim());
    if (cells.includes('Model')) { headers = cells.map(cell => cell.toLowerCase()); continue; }
    if (!headers.length || mode !== 'standard') continue;
    const at = name => cells[headers.indexOf(name)];
    const name = at('model');
    if (!name || /^:?-/.test(name)) continue;
    let key, rate, isLong = false;
    if (provider === 'claude') {
      const match = name.match(/^Claude (Opus|Sonnet|Haiku|Fable|Mythos) (\d+(?:\.\d+)?)/i);
      if (!match) continue;
      key = 'claude-' + match[1].toLowerCase() + '-' + match[2].replaceAll('.', '-');
      rate = { input: money(at('base input tokens')), output: money(at('output tokens')),
        cached: money(at('cache hits and refreshes')), write: money(at('5m cache writes')), writeLong: money(at('1h cache writes')) };
      isLong = /for prompts over/.test(name);
      if (isLong) { if (rates[key]) { rates[key].long = rate; rates[key].threshold = 100000; } continue; }
    } else {
      key = name.match(/^(gpt-[\w.-]+|o[134](?:-[\w.-]+)?|chat-latest)/)?.[1];
      if (!key) continue;
      const short = headers.includes('short context input');
      rate = { input: money(at(short ? 'short context input' : 'input')),
        output: money(at(short ? 'short context output' : 'output')),
        cached: money(at(short ? 'short context cached input' : 'cached input')),
        write: money(at('short context 30m write')), writeLong: money(at('short context 12h write')) };
      if (short) {
        rate.threshold = 272000;
        rate.long = { input: money(at('long context input')), output: money(at('long context output')),
          cached: money(at('long context cached input')), write: money(at('long context 30m write')), writeLong: money(at('long context 12h write')) };
      }
    }
    if (rate.input == null || rate.output == null || rates[key]) continue;
    rates[key] = rate;
  }
  if (Object.keys(rates).length < 2) throw new Error('The official pricing table could not be read. Saved prices were kept.');
  return rates;
}

export function estimateCost(row, catalog) {
  const base = catalog?.rates[modelKey(catalog.provider, row.model)];
  if (!base) return null;
  // Legacy deltas may combine multiple requests; their context tier is unknown.
  const rate = base.long && ['record', 'claude'].includes(row.source) && row.input_tokens > base.threshold ? base.long : base;
  const read = row.cached_input_tokens || 0, write = row.cache_write_input_tokens || 0;
  const longWrite = Math.min(write, row.cache_write_long_input_tokens || 0);
  const regular = Math.max(0, row.input_tokens - read - write);
  if (read && rate.cached == null || write > longWrite && rate.write == null || longWrite && rate.writeLong == null) return null;
  return (regular * rate.input + read * (rate.cached || 0) + (write - longWrite) * (rate.write || 0) +
    longWrite * (rate.writeLong || 0) + row.output_tokens * rate.output) / 1000000;
}

export class Pricing {
  constructor(store, fetcher = fetch, beforeWrite = async () => {}) { this.store = store; this.fetcher = fetcher; this.beforeWrite = beforeWrite; this.current = new Map(); }
  get(provider) {
    const row = this.store.db.prepare('SELECT * FROM pricing WHERE provider=?').get(provider);
    const overrides = this.store.db.prepare('SELECT model,rates,updated_at FROM price_overrides WHERE provider=?').all(provider);
    if (!row && !overrides.length) return null;
    const rates = Object.assign(Object.create(null), row ? JSON.parse(row.rates) : {});
    for (const override of overrides) rates[override.model] = { ...JSON.parse(override.rates), custom: true, updated_at: override.updated_at };
    return { provider, fetched_at: row?.fetched_at || null, source: row?.source || PRICE_SOURCES[provider], rates };
  }
  setOverride(provider, data) {
    if (!Object.hasOwn(PRICE_SOURCES, provider)) throw new Error('Choose Claude or ChatGPT.');
    if (typeof data?.model !== 'string' || !data.model.trim() || data.model.length > 200) throw new Error('Choose a valid model.');
    const model = modelKey(provider, data.model);
    if (data.reset === true) {
      this.store.db.prepare('DELETE FROM price_overrides WHERE provider=? AND model=?').run(provider, model);
      return;
    }
    const rates = {};
    for (const field of ['input', 'cached', 'write', 'writeLong', 'output']) {
      const value = data.rates?.[field];
      if (value == null && !['input', 'output'].includes(field)) { rates[field] = null; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000) throw new Error('Enter non-negative USD rates per million tokens. Input and output are required.');
      rates[field] = value;
    }
    this.store.db.prepare('INSERT INTO price_overrides(provider,model,rates,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider,model) DO UPDATE SET rates=excluded.rates,updated_at=excluded.updated_at')
      .run(provider, model, JSON.stringify(rates), new Date().toISOString());
  }
  async refresh(provider) {
    if (!PRICE_SOURCES[provider]) throw new Error('Choose Claude or ChatGPT.');
    if (this.current.has(provider)) return this.current.get(provider);
    const promise = this.fetch(provider).finally(() => this.current.delete(provider));
    this.current.set(provider, promise);
    return promise;
  }
  async fetch(provider) {
    const source = PRICE_SOURCES[provider];
    const response = await this.fetcher(source + '.md', { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'text/markdown,text/plain' } });
    if (!response.ok) throw new Error('Pricing fetch failed (HTTP ' + response.status + '). Saved prices were kept.');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) throw new Error('Pricing page is too large. Saved prices were kept.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const rates = parsePricing(provider, Buffer.concat(chunks).toString('utf8'));
    await this.beforeWrite();
    this.store.db.prepare('INSERT INTO pricing(provider,fetched_at,source,rates) VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET fetched_at=excluded.fetched_at,source=excluded.source,rates=excluded.rates')
      .run(provider, new Date().toISOString(), source, JSON.stringify(rates));
    return this.get(provider);
  }
}
