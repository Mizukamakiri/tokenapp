import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import path from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
const PARSER_VERSION = 2;

export class Importer {
  constructor(store, codexHome, interval = 15000, afterScan = async () => {}, options = {}) {
    this.store = store;
    this.codexHome = codexHome;
    this.interval = interval;
    this.afterScan = afterScan;
    this.provider = options.provider || 'codex';
    this.parserVersion = this.provider === 'claude' ? 1 : PARSER_VERSION;
    this.status = { running: false, initialized: false, files: 0, compressedFiles: 0, processed: 0, bytes: 0, lastScan: null, errors: [], source: codexHome };
  }
  async listFiles(root, archived) {
    const files = [];
    try {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory()) files.push(...await this.listFiles(path.join(root, entry.name), archived));
        else if (entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name)) files.push({ path: path.join(root, entry.name), archived });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.status.errors.push(path.basename(root) + ': ' + error.code);
    }
    return files;
  }
  async titles() {
    if (this.provider === 'claude') return;
    try {
      const content = await fs.readFile(path.join(this.codexHome, 'session_index.jsonl'), 'utf8');
      const update = this.store.db.prepare('UPDATE sessions SET title=? WHERE id=?');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (typeof value.id === 'string' && typeof value.thread_name === 'string') update.run(value.thread_name, value.id);
        } catch { /* An actively appended index may end in an incomplete line. */ }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.status.errors.push('Session titles: ' + error.code);
    }
  }
  async readFile(file) {
    const stat = await fs.stat(file.path);
    const prior = this.store.db.prepare('SELECT * FROM files WHERE path=?').get(file.path);
    const priorState = prior ? JSON.parse(prior.state || '{}') : {};
    const currentParser = priorState.parserVersion === this.parserVersion;
    if (prior && currentParser && prior.mtime === stat.mtimeMs && prior.offset === stat.size) {
      const state = priorState;
      if (state.sessionId) this.markSeen(state.sessionId, file.archived);
      return;
    }
    if (file.path.endsWith('.zst')) return this.readCompressed(file, stat);
    let offset = prior && currentParser && prior.offset <= stat.size ? prior.offset : 0;
    const state = offset ? priorState : { parserVersion: this.parserVersion };
    let badLines = offset ? prior.bad_lines : 0;
    const fileId = path.basename(file.path, '.jsonl');
    const handle = await fs.open(file.path, 'r');
    let pending = Buffer.alloc(0);
    let position = offset;
    const buffer = Buffer.alloc(256 * 1024);
    let skipping = false;
    try {
      while (position < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
        if (!bytesRead) break;
        position += bytesRead;
        this.status.bytes += bytesRead;
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
        let newline;
        let consumed = 0;
        this.store.db.exec('BEGIN');
        try {
          while ((newline = pending.indexOf(10, consumed)) !== -1) {
            const lineBytes = pending.subarray(consumed, newline);
            offset += newline + 1 - consumed;
            consumed = newline + 1;
            if (skipping) { skipping = false; continue; }
            // Look only at the outer envelope before parsing; never inspect message bodies.
            const prefix = lineBytes.subarray(0, 350).toString('utf8');
            const type = prefix.match(/"type"\s*:\s*"([^"]+)"/)?.[1];
            if (this.provider === 'codex' && !['session_meta', 'turn_context', 'token_usage_record', 'event_msg'].includes(type)) continue;
            if (this.provider === 'codex' && type === 'event_msg' && !/"type"\s*:\s*"token_count"/.test(prefix)) continue;
            try { this.consume(JSON.parse(lineBytes.toString('utf8')), state, fileId); }
            catch (error) {
              if (error instanceof SyntaxError) badLines++;
              else throw error;
            }
          }
          pending = pending.subarray(consumed);
          // Very large image/tool payload lines are irrelevant to token accounting.
          if (pending.length > 16 * 1024 * 1024) {
            offset += pending.length;
            pending = Buffer.alloc(0);
            skipping = true;
            badLines++;
          }
          // Do not commit a skipped partial line until its newline has arrived.
          if (!skipping) this.store.saveFile(file.path, offset, stat.mtimeMs, state, badLines, this.provider);
          this.store.db.exec('COMMIT');
        } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
        await yieldLoop();
      }
      if (state.sessionId) this.markSeen(state.sessionId, file.archived);
    } finally { await handle.close(); }
  }
  async readCompressed(file, stat) {
    // Archives are immutable snapshots. A changed archive is replayed from the
    // beginning; canonical response/event IDs deduplicate it against plain logs.
    const state = { parserVersion: this.parserVersion };
    const fileId = path.basename(file.path).replace(/\.jsonl\.zst$/, '');
    let pending = Buffer.alloc(0);
    let skipping = false;
    let badLines = 0;
    const input = createReadStream(file.path);
    const decompressor = createZstdDecompress({ chunkSize: 256 * 1024 });
    input.on('error', error => decompressor.destroy(error));
    const stream = input.pipe(decompressor);
    const consumeLine = bytes => {
      const prefix = bytes.subarray(0, 350).toString('utf8');
      const type = prefix.match(/"type"\s*:\s*"([^"]+)"/)?.[1];
      if (this.provider === 'codex' && !['session_meta', 'turn_context', 'token_usage_record', 'event_msg'].includes(type)) return;
      if (this.provider === 'codex' && type === 'event_msg' && !/"type"\s*:\s*"token_count"/.test(prefix)) return;
      try { this.consume(JSON.parse(bytes.toString('utf8')), state, fileId); }
      catch (error) { if (error instanceof SyntaxError) badLines++; else throw error; }
    };
    this.store.db.exec('BEGIN');
    try {
      for await (const chunk of stream) {
        this.status.bytes += chunk.length;
        pending = Buffer.concat([pending, chunk]);
        let consumed = 0;
        let newline;
        while ((newline = pending.indexOf(10, consumed)) !== -1) {
          const bytes = pending.subarray(consumed, newline);
          consumed = newline + 1;
          if (skipping) { skipping = false; continue; }
          consumeLine(bytes);
        }
        pending = pending.subarray(consumed);
        if (pending.length > 16 * 1024 * 1024) {
          pending = Buffer.alloc(0);
          skipping = true;
          badLines++;
        }
        await yieldLoop();
      }
      // A complete compressed file may legitimately lack a final newline.
      if (pending.length && !skipping) consumeLine(pending);
      if (!state.sessionId) throw new Error('Archive has no session metadata.');
      this.store.saveFile(file.path, stat.size, stat.mtimeMs, state, badLines, this.provider);
      this.store.db.exec('COMMIT');
      this.markSeen(state.sessionId, file.archived);
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    } finally {
      input.destroy();
      decompressor.destroy();
    }
  }
  markSeen(id, archived) {
    const value = archived ? 1 : 0;
    this.seen.set(id, Math.min(this.seen.get(id) ?? 1, value));
  }
  consume(record, state, fileId) {
    if (this.provider === 'claude') this.store.consumeClaude(record, state, fileId);
    else this.store.consume(record, state, fileId);
  }
  async scan() {
    if (this.current) return this.current;
    this.current = this.performScan().finally(() => { this.current = null; });
    return this.current;
  }
  async performScan() {
    Object.assign(this.status, { running: true, processed: 0, bytes: 0, errors: [] });
    this.seen = new Map();
    try {
      const files = (this.provider === 'claude' ? await this.listFiles(path.join(this.codexHome, 'projects'), false) : [
        ...await this.listFiles(path.join(this.codexHome, 'sessions'), false),
        ...await this.listFiles(path.join(this.codexHome, 'archived_sessions'), true)
      ]).sort((a, b) => a.path.localeCompare(b.path));
      this.status.files = files.length;
      this.status.compressedFiles = files.filter(file => file.path.endsWith('.zst')).length;
      if (!files.length) this.status.errors.push('No session logs found. Check the configured ' + (this.provider === 'claude' ? 'CLAUDE_HOME' : 'CODEX_HOME') + ' path.');
      for (const file of files) {
        try { await this.readFile(file); }
        catch (error) { this.status.errors.push(path.basename(file.path) + ': ' + (error.code || error.message)); }
        this.status.processed++;
        await yieldLoop();
      }
      await this.titles();
      // Publish source availability together; imported usage remains permanent,
      // including sessions whose source logs are later removed.
      this.store.db.exec('BEGIN');
      try {
        if (!this.status.errors.length) this.store.db.prepare('UPDATE sessions SET seen=0 WHERE provider=?').run(this.provider);
        const mark = this.store.db.prepare('UPDATE sessions SET seen=1,archived=? WHERE id=?');
        for (const [id, archived] of this.seen) mark.run(archived, id);
        this.store.db.exec('COMMIT');
      } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
      this.status.initialized = true;
      this.status.lastScan = new Date().toISOString();
      await this.afterScan();
    } finally { this.status.running = false; }
  }
  start() {
    this.scan().catch(error => this.status.errors.push(error.message));
    this.timer = setInterval(() => this.scan().catch(error => this.status.errors.push(error.message)), this.interval);
    this.timer.unref();
  }
  async stop() {
    clearInterval(this.timer);
    if (this.current) await this.current;
  }
}
