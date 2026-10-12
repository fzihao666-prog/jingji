import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import { passwordPool, PasswordPoolError } from '../core/password-pool.ts';
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
let afterCompare: (() => void) | undefined;
let passwordFailure: PasswordPoolError | undefined;

const correctPassword = 'Secure123';

function login(username: string, password: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(async (response) => ({
    status: response.status,
    retryAfter: response.headers.get('Retry-After'),
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
    CREATE TABLE registration_requests (id INTEGER PRIMARY KEY, username TEXT UNIQUE, status TEXT DEFAULT 'pending',
      password_hash TEXT, display_name TEXT, requested_role TEXT, project TEXT, team TEXT, gender TEXT,
      birth_date TEXT, native_place TEXT, phone TEXT, region TEXT, city TEXT, county TEXT,
      reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER DEFAULT 1);
    INSERT INTO project_teams (id, project, name) VALUES (1, 'ROWING', '测试队伍');
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, project TEXT, team TEXT, team_id INTEGER, gender TEXT, birth_date TEXT);
    CREATE UNIQUE INDEX idx_athletes_identity ON athletes (name,project,team);
    CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT);
  `);
  const { registerAuthRoutes } = await import('./auth-routes.ts');
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  registerAuthRoutes(app, {
    hash: async (password) => {
      if (passwordFailure) throw passwordFailure;
      return passwordPool.hash(password);
    },
    compare: async (password, hash) => {
      if (passwordFailure) throw passwordFailure;
      const result = await passwordPool.compare(password, hash);
      afterCompare?.();
      return result;
    },
  });
  server = await new Promise<Server>((resolve) => {
    const result = app.listen(0, '127.0.0.1', () => resolve(result));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  afterCompare = undefined;
  passwordFailure = undefined;
  db.exec(
    'DELETE FROM users; DELETE FROM registration_requests; DELETE FROM athletes; DELETE FROM app_metadata;'
  );
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

describe('异步密码校验期间账户变化', () => {
  it('密码计算期间停用账号后不得签发令牌', async () => {
    afterCompare = () => {
      db.prepare('UPDATE users SET active = 0 WHERE id = 1').run();
    };
    const result = await login('active_user', correctPassword);
    expect(result.status).toBe(403);
    expect(result.body.token).toBeUndefined();
  });

  it('密码计算期间会话版本变化后不得签发令牌', async () => {
    afterCompare = () => {
      db.prepare('UPDATE users SET session_version = 1 WHERE id = 1').run();
    };
    const result = await login('active_user', correctPassword);
    expect(result.status).toBe(401);
    expect(result.body.token).toBeUndefined();
  });

  it('密码计算期间改密后不得签发令牌', async () => {
    afterCompare = () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run('changed-hash');
    };
    const result = await login('active_user', correctPassword);
    expect(result.status).toBe(401);
    expect(result.body.token).toBeUndefined();
  });
});

describe('异步密码接口容量与并发', () => {
  it('工作池拒绝时返回可重试的503且不泄露内部失败原因', async () => {
    passwordFailure = new PasswordPoolError('OVERLOADED');
    const result = await login('active_user', correctPassword);
    expect(result.status).toBe(503);
    expect(result.retryAfter).toBe('1');
    expect(result.body.code).toBe('SERVICE_BUSY');
    expect(result.body.token).toBeUndefined();
  });

  it('同账号并发注册只有一个申请成功且保持cost11', async () => {
    const submit = () =>
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'new_coach',
          password: correctPassword,
          displayName: '测试教练',
          role: 'SCC',
          project: 'ROWING',
          team: '测试队伍',
          phone: '13800000000',
          gender: '男',
          birthDate: '2000-02-29',
        }),
      });
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const records = db
      .prepare('SELECT password_hash FROM registration_requests WHERE username = ?')
      .all('new_coach') as Array<{ password_hash: string }>;
    expect(records).toHaveLength(1);
    expect(records[0].password_hash).toMatch(/^\$2[aby]\$11\$/);
  });
});

it('超长登录密码返回凭据错误且不占用密码池', async () => {
  passwordFailure = new PasswordPoolError('OVERLOADED');
  const result = await login('active_user', 'A1'.repeat(37));
  expect(result.status).toBe(401);
  expect(result.body.code).toBe('INVALID_CREDENTIALS');
});

it('注册快速查重不占用已满的密码池', async () => {
  passwordFailure = new PasswordPoolError('OVERLOADED');
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'pending_user',
      password: correctPassword,
      displayName: '测试教练',
      role: 'SCC',
      project: 'ROWING',
      team: '测试队伍',
      phone: '13800000000',
      gender: '男',
      birthDate: '2000-02-29',
    }),
  });
  expect(response.status).toBe(409);
});

const registrationInput = {
  username: 'new_person',
  password: correctPassword,
  displayName: '测试人员',
  project: 'ROWING',
  team: '测试队伍',
  phone: '13800000000',
  gender: '女',
  birthDate: '2000-02-29',
  nativePlace: '浙江/杭州市',
};
async function registerInput(input: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
describe('独立注册人口信息', () => {
  it.each(['ATL', 'SCC'])('角色%s不需要身份证并保存性别生日', async (role) => {
    const response = await registerInput({ ...registrationInput, role });
    expect(response.status).toBe(201);
    expect(
      db
        .prepare('SELECT gender,birth_date FROM registration_requests WHERE username=?')
        .get(registrationInput.username)
    ).toEqual({ gender: '女', birth_date: '2000-02-29' });
  });
  it.each([
    { gender: undefined },
    { gender: '未知' },
    { birthDate: undefined },
    { birthDate: '2001-02-29' },
    { birthDate: '9999-01-01' },
  ])('非法人口信息返回字段错误 %#', async (invalid) => {
    const response = await registerInput({ ...registrationInput, role: 'SCC', ...invalid });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fieldErrors: expect.any(Object) });
  });
});

it.each(['identityNumber', 'identity_number'])(
  '拒绝历史证件字段 %s 且不创建申请',
  async (field) => {
    const response = await registerInput({
      ...registrationInput,
      role: 'ATL',
      [field]: '不应采集',
    });
    expect(response.status).toBe(400);
    expect(
      db
        .prepare('SELECT id FROM registration_requests WHERE username=?')
        .get(registrationInput.username)
    ).toBeUndefined();
  }
);
it('拒绝申请重提独立更新生日性别', async () => {
  const response = await registerInput({
    ...registrationInput,
    role: 'SCC',
    username: 'rejected_user',
  });
  expect(response.status).toBe(201);
  expect(
    db
      .prepare("SELECT gender,birth_date FROM registration_requests WHERE username='rejected_user'")
      .get()
  ).toEqual({ gender: '女', birth_date: '2000-02-29' });
});

it('关闭审核时已有档案冲突明确返回错误，申请保留待人工核对', async () => {
  db.exec("INSERT INTO app_metadata VALUES ('registration_approval_enabled','0')");
  db.prepare('INSERT INTO athletes VALUES (10,?,?,?,?,?,?)').run(
    registrationInput.displayName,
    'ROWING',
    '测试队伍',
    1,
    '女',
    '2000-02-29'
  );
  const response = await registerInput({ ...registrationInput, role: 'ATL' });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    status: 'pending',
    message: expect.stringContaining('联系管理员'),
  });
  expect(db.prepare('SELECT id FROM users WHERE athlete_id=10').get()).toBeUndefined();
  expect(
    db
      .prepare('SELECT status FROM registration_requests WHERE username=?')
      .get(registrationInput.username)
  ).toEqual({ status: 'pending' });
});

it('关闭审核时教练申请仍保持待审核', async () => {
  db.exec("INSERT INTO app_metadata VALUES ('registration_approval_enabled','0')");
  const response = await registerInput({ ...registrationInput, role: 'SCC' });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ status: 'pending' });
});
