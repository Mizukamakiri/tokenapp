import { backup, DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dateFormatter, dayKey } from './usage.mjs';

export class Backups {
  constructor(store, directory, timezone = 'Europe/Helsinki') {
    this.store = store;
    this.directory = directory;
    this.formatter = dateFormatter(timezone);
    this.status = { directory, lastBackup: null, file: null, error: null, automatic: 'daily' };
  }
  async daily() {
    const day = dayKey(Date.now(), this.formatter);
    const filename = 'usage-daily-' + day + '.sqlite';
    try {
      const stat = await fs.stat(path.join(this.directory, filename));
      if (!this.status.lastBackup) Object.assign(this.status, { lastBackup: stat.mtime.toISOString(), file: filename });
      return this.status;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.create(filename);
  }
  async manual() {
    return this.create('usage-manual-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8) + '.sqlite');
  }
  async create(filename) {
    if (this.current) return this.current;
    this.current = this.perform(filename).finally(() => { this.current = null; });
    return this.current;
  }
  async perform(filename) {
    const target = path.join(this.directory, filename);
    const partial = target + '.partial';
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await backup(this.store.db, partial);
      const check = new DatabaseSync(partial);
      try {
        // Make the completed snapshot portable without WAL/SHM sidecar files.
        check.exec('PRAGMA journal_mode=DELETE');
        const result = check.prepare('PRAGMA quick_check').get();
        if (Object.values(result)[0] !== 'ok') throw new Error('Backup failed its integrity check.');
      } finally { check.close(); }
      await fs.rename(partial, target);
      Object.assign(this.status, { lastBackup: new Date().toISOString(), file: filename, error: null });
      return this.status;
    } catch (error) {
      this.status.error = error.message;
      throw error;
    }
  }
}
