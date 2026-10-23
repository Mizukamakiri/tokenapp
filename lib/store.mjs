import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FIELDS, normalizeUsage, fingerprint, digest, difference } from './usage.mjs';

export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT, cwd TEXT, created_at TEXT, archived INTEGER DEFAULT 0, seen INTEGER DEFAULT 1);' +
      'CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, offset INTEGER DEFAULT 0, mtime REAL, state TEXT, bad_lines INTEGER DEFAULT 0);' +
      'CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT, model TEXT, ts INTEGER NOT NULL, source TEXT, snapshot TEXT,' +
      FIELDS.map(field => field + ' INTEGER NOT NULL DEFAULT 0').join(',') + ');' +
      'CREATE INDEX IF NOT EXISTS events_time ON events(ts); CREATE INDEX IF NOT EXISTS events_session ON events(session_id);' +
      'CREATE INDEX IF NOT EXISTS events_snapshot ON events(session_id,snapshot,source);'
    );
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(column => column.name === 'coverage_key')) {
      this.db.exec('ALTER TABLE events ADD COLUMN coverage_key TEXT');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS events_coverage ON events(session_id,coverage_key,source)');
    if (!this.db.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'provider')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex'");
    }
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(column => column.name === 'cache_write_long_input_tokens')) {
      this.db.exec('ALTER TABLE events ADD COLUMN cache_write_long_input_tokens INTEGER NOT NULL DEFAULT 0');
    }
    if (!this.db.prepare('PRAGMA table_info(files)').all().some(column => column.name === 'provider')) {
      this.db.exec("ALTER TABLE files ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex'");
      this.db.exec("UPDATE files SET provider='claude' WHERE json_extract(state,'$.rawId') IS NOT NULL");
    }
    this.db.exec('CREATE TABLE IF NOT EXISTS pricing (provider TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, source TEXT NOT NULL, rates TEXT NOT NULL)');
    this.saveClaudeEvent = this.db.prepare('INSERT INTO events (id,session_id,turn_id,model,ts,source,cache_write_long_input_tokens,' +
      FIELDS.join(',') + ') VALUES (' + Array(7 + FIELDS.length).fill('?').join(',') + ') ON CONFLICT(id) DO UPDATE SET ' +
      FIELDS.filter(field => field !== 'total_tokens').map(field => field + '=MAX(events.' + field + ',excluded.' + field + ')').join(',') +
      ',total_tokens=MAX(events.input_tokens,excluded.input_tokens)+MAX(events.output_tokens,excluded.output_tokens)' +
      ',cache_write_long_input_tokens=MAX(events.cache_write_long_input_tokens,excluded.cache_write_long_input_tokens)');
    this.insertEvent = this.db.prepare('INSERT INTO events (id,session_id,turn_id,model,ts,source,snapshot,coverage_key,' +
      FIELDS.join(',') + ') VALUES (' + Array(8 + FIELDS.length).fill('?').join(',') +
      ') ON CONFLICT(id) DO UPDATE SET coverage_key=COALESCE(events.coverage_key,excluded.coverage_key)');
    this.removeFallback = this.db.prepare("DELETE FROM events WHERE session_id=? AND coverage_key=? AND source<>'record'");
    this.covered = this.db.prepare("SELECT 1 FROM events WHERE session_id=? AND coverage_key=? AND source='record' LIMIT 1");
    this.removeOldFallback = this.db.prepare("DELETE FROM events WHERE id=? AND source<>'record'");
    this.saveSession = this.db.prepare('INSERT INTO sessions (id,title,cwd,created_at,archived,provider,seen) VALUES (?,?,?,?,?,?,1) ' +
      'ON CONFLICT(id) DO UPDATE SET cwd=COALESCE(excluded.cwd,sessions.cwd), created_at=COALESCE(sessions.created_at,excluded.created_at),seen=1');
  }
  close() { this.db.close(); }
  session(id, metadata = {}) {
    if (!id) return;
    this.saveSession.run(id, metadata.title || null, metadata.cwd || null, metadata.timestamp || null, metadata.archived ? 1 : 0, metadata.provider || 'codex');
  }
  consumeClaude(record, state, fileId) {
    if (!['assistant', 'user', 'custom-title', 'ai-title', 'system'].includes(record.type)) return;
    const rawId = record.sessionId || record.session_id || state.rawId || fileId;
    if (!rawId) return;
    state.rawId = rawId;
    const sessionId = 'claude:' + rawId;
    state.sessionId = sessionId;
    this.session(sessionId, { provider: 'claude', cwd: record.cwd, timestamp: record.timestamp });
    if (record.type === 'custom-title' || record.type === 'ai-title') {
      const title = record.customTitle || (!state.customTitle && record.aiTitle);
      if (record.customTitle) state.customTitle = true;
      if (typeof title === 'string') this.db.prepare('UPDATE sessions SET title=? WHERE id=?').run(title, sessionId);
      return;
    }
    const message = record.message;
    const raw = message?.usage;
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    if (record.type !== 'assistant' || !raw || !message.id || !message.model || message.model === '<synthetic>' || record.isApiErrorMessage) return;
    const timestamp = Date.parse(record.timestamp);
    if (!Number.isFinite(timestamp) || !Number.isSafeInteger(raw.input_tokens) || !Number.isSafeInteger(raw.output_tokens) || raw.input_tokens < 0 || raw.output_tokens < 0) return;
    const cached = count(raw.cache_read_input_tokens);
    const written = count(raw.cache_creation_input_tokens);
    const usage = normalizeUsage({ input_tokens: raw.input_tokens + cached + written,
      cached_input_tokens: cached, cache_write_input_tokens: written, output_tokens: raw.output_tokens });
    if (!usage || !usage.total_tokens) return;
    // A response is repeated for thinking/text/tool blocks and streaming updates.
    // Counters grow within that response; keep their maxima, never add them.
    this.saveClaudeEvent.run('claude:message:' + message.id, sessionId, record.requestId || null, message.model, timestamp,
      'claude', Math.min(written, count(raw.cache_creation?.ephemeral_1h_input_tokens)), ...FIELDS.map(field => usage[field]));
  }
  // Only metadata and numeric accounting reach the database. Message and reasoning bodies are discarded.
  consume(record, state, fileId) {
    const data = record.payload;
    if (!data) return;
    if (record.type === 'session_meta') {
      state.sessionId = data.id || state.sessionId || fileId;
      state.createdAt = data.timestamp;
      state.forkedFrom = data.forked_from_id || null;
      state.cwd = data.cwd;
      this.session(state.sessionId, data);
      return;
    }
    if (record.type === 'turn_context') {
      state.model = data.model || state.model || 'Unknown';
      state.turnId = data.turn_id || state.turnId;
      state.coverageKey = data.turn_id ? 'turn:' + data.turn_id : 'context:' + record.timestamp;
      state.cwd = data.cwd || state.cwd;
      if (state.sessionId) this.session(state.sessionId, { cwd: state.cwd });
      return;
    }
    const modern = record.type === 'token_usage_record';
    const legacy = record.type === 'event_msg' && data.type === 'token_count';
    if (!modern && !legacy) return;
    const timestamp = Date.parse(record.timestamp);
    if (!Number.isFinite(timestamp)) return;
    const sessionId = (modern && data.thread_id) || state.sessionId || fileId;
    if (!sessionId) return;
    this.session(sessionId, { cwd: state.cwd, timestamp: state.createdAt });
    const total = normalizeUsage(modern ? data.thread_token_usage : data.info?.total_token_usage);
    const last = normalizeUsage(modern ? data.usage : data.info?.last_token_usage);
    const snapshot = total ? fingerprint(total) : null;
    const coverageKey = state.coverageKey || (modern && data.turn_id ? 'turn:' + data.turn_id : 'unknown:' + sessionId);
    if (!state.coverageKey) state.coverageKey = coverageKey;
    if (modern) {
      if (!last) return;
      // Per-call records are authoritative for their turn. Older notifications
      // can use different cumulative counters after compaction or adjustments.
      this.removeFallback.run(sessionId, coverageKey);
      const id = data.response_id ? 'response:' + data.response_id :
        'modern:' + digest([sessionId, data.turn_id, record.timestamp, fingerprint(last)].join('|'));
      this.insertEvent.run(id, sessionId, data.turn_id || state.turnId || null, state.model || 'Unknown',
        timestamp, 'record', snapshot, coverageKey, ...FIELDS.map(field => last[field]));
      if (total) state.lastTotal = total;
      return;
    }
    if (!last && !total) return; // Empty notifications and rate-limit updates carry no usage.
    const previous = state.lastTotal;
    const usage = difference(total, previous, last);
    if (total) state.lastTotal = total;
    if (!usage || usage.total_tokens === 0) return;
    // A first cumulative snapshot with several calls cannot truthfully be attributed to one date.
    const uncertain = !previous && total && last && total.total_tokens > last.total_tokens;
    const counted = uncertain ? last : usage;
    if (!counted || counted.total_tokens === 0) return;
    // Copied history in resumed/forked log files retains its timestamp and accounting values.
    const id = 'legacy:' + digest([record.timestamp, state.turnId || '', fingerprint(counted)].join('|'));
    if (this.covered.get(sessionId, coverageKey)) {
      // This also removes obsolete fallback rows when replaying a database
      // imported by the earlier parser; canonical per-call rows stay intact.
      this.removeOldFallback.run(id);
      return;
    }
    this.insertEvent.run(id, sessionId, state.turnId || null, state.model || 'Unknown', timestamp,
      uncertain ? 'legacy_partial' : 'legacy', snapshot, coverageKey, ...FIELDS.map(field => counted[field]));
  }
  saveFile(file, offset, mtime, state, badLines, provider = 'codex') {
    this.db.prepare('INSERT INTO files(path,offset,mtime,state,bad_lines,provider) VALUES(?,?,?,?,?,?) ON CONFLICT(path) ' +
      'DO UPDATE SET offset=excluded.offset,mtime=excluded.mtime,state=excluded.state,bad_lines=excluded.bad_lines,provider=excluded.provider')
      .run(file, offset, mtime, JSON.stringify(state), badLines, provider);
  }
}
