import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import { LOGIN_ERROR_MESSAGES } from '../../shared/login-errors.ts';

const fixture = vi.hoisted(() => {
  return { db: null as DatabaseSync | null };
});
vi.mock('../core/db.ts', () => ({
  upsertAthleteOrigin: vi.fn(),
  get db() {
    return fixture.db;
  },
}));

let server: Server;
let baseUrl: string;
let db: DatabaseSync;

const correctPassword = 'Secure123';

function login(username: string, password: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(async (response) => ({
    status: response.status,
    body: (await response.json()) as {
      message: string;
      code?: string;
      token?: string;
      user?: unknown;
    },
  }));
}

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-only-login-error-secret-not-for-deployment');
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, display_name TEXT,
      role TEXT, athlete_id INTEGER, active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 0);
    CREATE TABLE registration_requests (id INTEGER PRIMARY KEY, username TEXT, status TEXT);
  `);
  const { registerAuthRoutes } = await import('./auth-routes.ts');
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  registerAuthRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const result = app.listen(0, '127.0.0.1', () => resolve(result));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  db.exec('DELETE FROM users; DELETE FROM registration_requests;');
  const passwordHash = bcrypt.hashSync(correctPassword, 4);
  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, display_name, role, athlete_id, active, session_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertUser.run(1, 'active_user', passwordHash, '正常用户', 'ATL', null, 1, 0);
  insertUser.run(2, 'disabled_user', passwordHash, '停用用户', 'ATL', null, 0, 0);
  insertUser.run(3, 'broken_user', null, '异常用户', 'ATL', null, 1, 0);
  const insertRequest = db.prepare(
    'INSERT INTO registration_requests (id, username, status) VALUES (?, ?, ?)'
  );
  insertRequest.run(1, 'pending_user', 'pending');
  insertRequest.run(2, 'rejected_user', 'rejected');
});

afterAll(() => {
  server.close();
});

describe('登录接口错误码', () => {
  it('账号或密码为空返回统一提示', async () => {
    const empty = await login('', '');
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('MISSING_CREDENTIALS');
    expect(empty.body.message).toBe(LOGIN_ERROR_MESSAGES.MISSING_CREDENTIALS);

    const missingPassword = await login('active_user', '');
    expect(missingPassword.status).toBe(400);
    expect(missingPassword.body.code).toBe('MISSING_CREDENTIALS');
  });

  it('账号不存在与密码错误使用同一提示，不泄露账号是否存在', async () => {
    const unknownUser = await login('never_registered', correctPassword);
    const wrongPassword = await login('active_user', 'WrongPass123');
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.body.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknownUser.body.message).toBe(wrongPassword.body.message);
    expect(unknownUser.body.message).toBe(LOGIN_ERROR_MESSAGES.INVALID_CREDENTIALS);
  });

  it('待审核与审核未通过返回各自状态提示', async () => {
    const pending = await login('pending_user', correctPassword);
    expect(pending.status).toBe(403);
    expect(pending.body.code).toBe('ACCOUNT_PENDING');
    expect(pending.body.message).toBe(LOGIN_ERROR_MESSAGES.ACCOUNT_PENDING);

    const rejected = await login('rejected_user', correctPassword);
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe('ACCOUNT_REJECTED');
    expect(rejected.body.message).toBe(LOGIN_ERROR_MESSAGES.ACCOUNT_REJECTED);
  });

  it('停用账号在密码正确时提示已停用，密码错误时不暴露状态', async () => {
    const disabled = await login('disabled_user', correctPassword);
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe('ACCOUNT_DISABLED');
    expect(disabled.body.message).toBe(LOGIN_ERROR_MESSAGES.ACCOUNT_DISABLED);

    const disabledWrongPassword = await login('disabled_user', 'WrongPass123');
    expect(disabledWrongPassword.status).toBe(401);
    expect(disabledWrongPassword.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('正确凭据签发令牌并返回用户信息', async () => {
    const result = await login('active_user', correctPassword);
    expect(result.status).toBe(200);
    expect(typeof result.body.token).toBe('string');
    expect(result.body.user).toMatchObject({ username: 'active_user', role: 'ATL' });
  });

  it('登录内部异常返回统一提示，不暴露数据库或服务器错误', async () => {
    const failure = await login('broken_user', correctPassword);
    expect(failure.status).toBe(500);
    expect(failure.body.code).toBe('SERVER_ERROR');
    expect(failure.body.message).toBe(LOGIN_ERROR_MESSAGES.SERVER_ERROR);
    expect(JSON.stringify(failure.body)).not.toMatch(/Illegal|sqlite|bcrypt|arguments/i);
  });

  it('会话失效与登录失败使用不同错误码', async () => {
    const response = await fetch(`${baseUrl}/api/me`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { message: string; code?: string };
    expect(body.code).toBe('SESSION_EXPIRED');
  });
});
