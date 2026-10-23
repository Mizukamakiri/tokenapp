import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { Importer } from './lib/importer.mjs';
import { Backups } from './lib/backups.mjs';
import { Pricing } from './lib/pricing.mjs';
import { getReport, metadata, optionsFrom, reportCsv } from './lib/report.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const timezone = process.env.APP_TIMEZONE || 'Europe/Helsinki';
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'usage.sqlite');
const store = new Store(dbPath);
const backups = new Backups(store, process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups'), timezone);
const pricing = new Pricing(store, fetch, async () => { if (currentScan) await currentScan; });
const importers = { codex: new Importer(store, codexHome), claude: new Importer(store, claudeHome, 15000, async () => {}, { provider: 'claude' }) };
let currentScan, scanTimer;
function scanAll() {
  if (currentScan) return currentScan;
  currentScan = (async () => {
    // The importers share one SQLite connection. Scan sequentially so file
    // transactions cannot overlap, then snapshot both providers together.
    for (const importer of Object.values(importers)) await importer.scan();
    try { await backups.daily(); }
    catch (error) { backups.status.error = error.message; console.error('Backup failed:', error.message); }
  })().finally(() => { currentScan = null; });
  return currentScan;
}
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const provider = url.searchParams.get('provider') || 'codex';
    if (!Object.hasOwn(importers, provider)) { send(res, 400, { error: 'Choose Claude or ChatGPT.' }); return; }
    if (req.method === 'POST' && ['/api/refresh', '/api/backup', '/api/pricing/refresh', '/api/pricing/custom'].includes(url.pathname)) {
      const origin = req.headers.origin;
      if (!req.headers.host || origin && origin !== 'http://' + req.headers.host || !req.headers['content-type']?.startsWith('application/json')) {
        send(res, 403, { error: 'This action must originate from this app.' }); return;
      }
      if (url.pathname === '/api/pricing/custom') {
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk.toString('utf8');
            if (Buffer.byteLength(body) > 16384) { send(res, 413, { error: 'The rate settings are too large.' }); return; }
          }
          const settings = JSON.parse(body);
          if (currentScan) await currentScan;
          pricing.setOverride(provider, settings);
          send(res, 200, { saved: true });
        } catch (error) { send(res, 400, { error: error instanceof SyntaxError ? 'Enter valid rate settings.' : error.message }); }
        return;
      }
      if (url.pathname === '/api/pricing/refresh') {
        try { send(res, 200, await pricing.refresh(provider)); }
        catch (error) { send(res, 502, { error: error.message }); }
        return;
      }
      if (url.pathname === '/api/backup') {
        await scanAll();
        send(res, 200, await backups.manual());
        return;
      }
      await scanAll();
      send(res, 200, { refreshed: true }); return;
    }
    if (req.method !== 'GET') { send(res, 405, { error: 'Method not allowed.' }); return; }
    if (url.pathname === '/api/health') { send(res, 200, { ok: true, initialized: Object.values(importers).every(importer => importer.status.initialized) }); return; }
    if (url.pathname === '/api/status') { send(res, 200, { ...importers[provider].status, backups: backups.status }); return; }
    if (url.pathname === '/api/pricing') { send(res, 200, pricing.get(provider)); return; }
    if (url.pathname === '/api/meta') { send(res, 200, metadata(store, url.searchParams.get('timezone') || timezone, provider)); return; }
    if (url.pathname === '/api/report' || url.pathname === '/api/export') {
      let options;
      try { options = optionsFrom(url.searchParams, timezone); }
      catch (error) { send(res, 400, { error: error.message }); return; }
      const report = getReport(store, options);
      if (url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="tokenapp-' + (options.from || 'all') + '-' + (options.to || 'time') + '.csv"');
        send(res, 200, reportCsv(report, url.searchParams.get('view')), 'text/csv; charset=utf-8');
      } else send(res, 200, report);
      return;
    }
    if (assets[url.pathname]) {
      const [filename, type] = assets[url.pathname];
      send(res, 200, await readFile(path.join(root, 'public', filename)), type); return;
    }
    send(res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) send(res, 500, { error: 'The request could not be completed. Check the app logs.' });
    else res.end();
  }
});
server.listen(port, host, () => {
  console.log('Tokenapp: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port);
  console.log('Reading local Codex and Claude Code usage.');
  scanAll().catch(error => console.error('Import failed:', error.message));
  scanTimer = setInterval(() => scanAll().catch(error => console.error('Import failed:', error.message)), Math.max(3000, Number(process.env.SCAN_INTERVAL_MS) || 15000));
  scanTimer.unref();
});
async function shutdown() {
  server.close();
  clearInterval(scanTimer);
  if (currentScan) await currentScan;
  await Promise.allSettled(pricing.current.values());
  if (backups.current) await backups.current;
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
