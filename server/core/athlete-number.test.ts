import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { initializeDatabase } from './db-initialize.ts';

it('旧库升级保留历史编号，多个数据库连接同时创建同名档案也不复用编号', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'jingji-athlete-number-'));
  const path = join(folder, 'test.db');
  const db = new DatabaseSync(path);
  try {
    initializeDatabase(db, { databasePath: path, databaseExistedBeforeStartup: false });
    db.exec(`
      CREATE UNIQUE INDEX idx_athletes_identity ON athletes(name, project, team);
      INSERT INTO athletes(id, name, project) VALUES (90000, '虚构历史运动员', 'ROWING'), (90001, '虚构已删除运动员', 'ROWING');
      DELETE FROM athletes WHERE id = 90001;
    `);
    initializeDatabase(db, { databasePath: path, databaseExistedBeforeStartup: true });
    expect(db.prepare('SELECT id FROM athletes WHERE id = 90000').get()).toEqual({ id: 90000 });
    expect(() => db.exec("INSERT INTO athletes(id, name, project) VALUES (90000, '虚构重复编号', 'ROWING')")).toThrow();

    const workers = Array.from({ length: 4 }, () => new Promise<number>((resolve, reject) => {
      const worker = new Worker(`
        const { DatabaseSync } = require('node:sqlite');
        const { parentPort, workerData } = require('node:worker_threads');
        const db = new DatabaseSync(workerData);
        db.exec('PRAGMA busy_timeout=5000');
        const result = db.prepare('INSERT INTO athletes(name, project) VALUES (?, ?)').run('虚构并发同名', 'ROWING');
        db.close();
        parentPort.postMessage(Number(result.lastInsertRowid));
      `, { eval: true, workerData: path });
      worker.once('message', resolve);
      worker.once('error', reject);
    }));
    const results = await Promise.all(workers);
    expect(new Set(results).size).toBe(4);
    expect(results.every(id => id > 90001)).toBe(true);
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
