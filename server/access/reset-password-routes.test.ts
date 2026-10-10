import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';

const fixture = vi.hoisted(() => {
  return { db: null as DatabaseSync | null };
});
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));

let server: Server;
let baseUrl: string;
let db: DatabaseSync;
let secret: string;
const initialPassword = 'OriginalTest123';
const newPassword = 'ReplacementTest456';

function token(id: number, sessionVersion = 0) {
  return jwt.sign({ id, sessionVersion }, secret, { expiresIn: '5m' });
}
async function reset(
  id: number | string,
  actor = 1,
  body: unknown = { newPassword },
  ip = '192.0.2.1'
) {
  return fetch(`${baseUrl}/api/access/accounts/${id}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token(actor)}`,
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify(body),
  });
}
function snapshot(id = 2) {
  return db
    .prepare('SELECT password_hash, session_version, active FROM users WHERE id = ?')
    .get(id);
}

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-only-password-reset-secret-not-for-deployment');
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT,
      athlete_id INTEGER, active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 0, password_hash TEXT);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  const { registerResetPasswordRoutes } = await import('./reset-password-routes.ts');
  const auth = await import('../core/auth.ts');
  secret = auth.jwtSecret;
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  registerResetPasswordRoutes(app);
  app.get('/session', auth.requireAuth, (_req, res) => res.json({ ok: true }));
  server = await new Promise<Server>((resolve) => {
    const result = app.listen(0, '127.0.0.1', () => resolve(result));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  vi.useRealTimers();
  vi.setSystemTime(new Date());
  // 每个用例使用不同时间窗口，避免限流状态串扰。
  clock += 16 * 60 * 1000;
  vi.spyOn(Date, 'now').mockReturnValue(clock);
  db.exec(
    'DELETE FROM users; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions; DELETE FROM user_team_permissions; DELETE FROM audit_logs;'
  );
  for (const [id, role, province, project, team] of [
    [1, 'PRJ', '四川', 'ROWING', 'A队'],
    [2, 'ATL', '四川', 'ROWING', 'A队'],
    [3, 'PRJ', '四川', 'ROWING', 'A队'],
    [4, 'SCC', '四川', 'ROWING', 'A队'],
    [5, 'ATL', '浙江', 'ROWING', 'A队'],
    [6, 'ATL', '四川', 'CANOE_SPRINT', 'A队'],
    [7, 'ATL', '四川', 'ROWING', 'B队'],
    [8, 'DMD', '四川', 'ROWING', 'A队'],
  ] as const) {
    db.prepare(
      'INSERT INTO users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(id, `test${id}`, `测试${id}`, role, bcrypt.hashSync(initialPassword, 4));
    db.prepare('INSERT INTO user_area_permissions VALUES (?, ?, ?, ?, ?)').run(
      id,
      'province',
      province,
      '',
      ''
    );
    db.prepare('INSERT INTO user_project_permissions VALUES (?, ?)').run(id, project);
    db.prepare('INSERT INTO user_team_permissions VALUES (?, ?, ?)').run(id, project, team);
  }
});
let clock = Date.now();
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});

describe('上级重置下级账号密码', () => {
  it('保存 bcrypt 哈希、递增会话版本且审计不含密码，旧会话失效', async () => {
    expect((await reset(2)).status).toBe(200);
    const row = snapshot();
    expect(row?.session_version).toBe(1);
    expect(bcrypt.compareSync(newPassword, String(row?.password_hash))).toBe(true);
    expect(bcrypt.compareSync(initialPassword, String(row?.password_hash))).toBe(false);
    const logs = db.prepare('SELECT * FROM audit_logs').all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      user_id: 1,
      action: 'RESET_ACCOUNT_PASSWORD',
      entity_type: 'user',
      entity_id: 2,
      detail: null,
    });
    expect(JSON.stringify(logs)).not.toContain(newPassword);
    expect(
      (await fetch(`${baseUrl}/session`, { headers: { Authorization: `Bearer ${token(2)}` } }))
        .status
    ).toBe(401);
    expect(
      (await fetch(`${baseUrl}/session`, { headers: { Authorization: `Bearer ${token(2, 1)}` } }))
        .status
    ).toBe(200);
  });
  it.each([1, 3, 5, 6, 7, 8, 999])('拒绝本人、同级、上级、范围外或不存在的目标 %s', async (id) => {
    const before = snapshot(id);
    expect((await reset(id)).status).toBe(404);
    expect(snapshot(id)).toEqual(before);
    expect(db.prepare('SELECT * FROM audit_logs').all()).toHaveLength(0);
  });
  it('SCC 可重置范围内运动员，ATL 不能重置任何账号', async () => {
    expect((await reset(4, 2)).status).toBe(403);
    expect((await reset(2, 4)).status).toBe(200);
  });
  it.each([
    { newPassword: 'short1' },
    { newPassword: ' Abc12345' },
    { newPassword: 'Abc12345 ' },
    { newPassword: '123456789' },
    { newPassword: 'abcdefgh' },
    { newPassword: '汉'.repeat(30) + 'Ab12' },
    { newPassword: 12345678 },
    { newPassword, role: 'DMD' },
    {},
  ])('拒绝非法密码或额外字段 %#', async (body) => {
    const before = snapshot();
    expect((await reset(2, 1, body)).status).toBe(400);
    expect(snapshot()).toEqual(before);
  });
  it.each(['A1' + 'x'.repeat(70), '汉'.repeat(23) + 'Ab1'])(
    '接受恰好72字节的有效密码 %#',
    async (password) => {
      expect((await reset(2, 1, { newPassword: password })).status).toBe(200);
      expect(bcrypt.compareSync(password, String(snapshot()?.password_hash))).toBe(true);
    }
  );
  it('多个操作人共享来源 IP 时仍受 IP 限流', async () => {
    for (const actor of [1, 3, 4, 8]) {
      for (let i = 0; i < 5; i++) expect((await reset(2, actor, {})).status).toBe(400);
    }
    expect((await reset(2, 8, {})).status).toBe(429);
  });
  it('拒绝无效 ID 和未认证请求', async () => {
    expect((await reset('abc')).status).toBe(400);
    expect((await reset('-1')).status).toBe(400);
    expect(
      (await fetch(`${baseUrl}/api/access/accounts/2/reset-password`, { method: 'POST' })).status
    ).toBe(401);
  });
  it('保留停用状态', async () => {
    db.prepare('UPDATE users SET active = 0 WHERE id = 2').run();
    expect((await reset(2)).status).toBe(200);
    expect(snapshot()?.active).toBe(0);
  });
  it('审计写入失败时回滚密码和会话版本', async () => {
    db.exec(
      "CREATE TRIGGER reject_reset_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
    );
    try {
      const before = snapshot();
      expect((await reset(2)).status).toBe(500);
      expect(snapshot()).toEqual(before);
    } finally {
      db.exec('DROP TRIGGER reject_reset_audit');
    }
  });
  it('同一操作人切换来源 IP 仍受账号限流', async () => {
    for (let i = 0; i < 6; i++)
      expect((await reset(2, 1, {}, `192.0.2.${i + 1}`)).status).toBe(400);
    expect((await reset(2, 1, { newPassword }, '192.0.2.100')).status).toBe(429);
  });
  it('限制连续重置请求频率', async () => {
    for (let i = 0; i < 6; i++) expect((await reset(2, 1, {})).status).toBe(400);
    expect((await reset(2)).status).toBe(429);
  });
});
