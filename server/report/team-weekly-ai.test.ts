import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { registerTeamWeeklyRoutes } from './team-weekly-routes.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyAiInput, teamWeeklyFingerprint } from './team-weekly-ai.ts';
import type { AuthUser } from '../core/shared-server.ts';
const query = { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType:'special' } as const;
const commentary = {
  summary: '本周有训练记录，待教练核对。',
  training: '按已记录课次回顾训练。',
  strength: '结合实际组次查看。',
  recovery: '恢复资料留在本地，请教练补充。',
  nextWeek: '结合已发布计划安排。',
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function setup() {
  const db = createTeamWeeklyFixture();
  const user: AuthUser = {
    id: 1,
    username: 'test',
    displayName: '测试',
    role: 'SCC',
    athleteId: null,
    sessionVersion: 1,
  };
  const state = {
    ids: [1, 3],
    current: user as AuthUser | null,
    generate: vi.fn(async (data: ReturnType<typeof teamWeeklyAiInput>): Promise<unknown> => {
      void data;
      return commentary;
    }),
  };
  const app = express();
  app.use(express.json());
  registerTeamWeeklyRoutes(app, {
    db,
    requireAuth: (req, res, next) => {
      if (req.headers['x-deny']) {
        res.sendStatus(401);
        return;
      }
      req.authUser = { ...user, role: req.headers['x-athlete'] ? 'ATL' : 'SCC' };
      next();
    },
    currentUser: () => state.current,
    accessibleIds: () => state.ids,
    generate: (data) => state.generate(data),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  cleanups.push(async () => {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    db.close();
  });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports/weekly`;
  const fingerprint = teamWeeklyFingerprint(readTeamWeeklyReport(db, query, state.ids));
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(root + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return {
    db,
    state,
    post,
    body: { query, fingerprint, consent: true, coachNotes: '' },
    fingerprint,
  };
}
describe('队伍周报AI和核对导出', () => {
  it('同一账号生成期间拒绝重复请求，完成后释放名额', async () => {
    const { post, body, state } = await setup();
    let started!: () => void;
    let finish!: (value: unknown) => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    state.generate.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = post('/commentary', body);
    await entered;
    expect((await post('/commentary', body)).status).toBe(429);
    finish(commentary);
    expect((await first).status).toBe(200);
    expect((await post('/commentary', body)).status).toBe(200);
  });

  it('训练白名单排除身份健康备注，并保留数据指纹', () => {
    const db = createTeamWeeklyFixture();
    try {
      const report = readTeamWeeklyReport(db, query, [1, 3]);
      const input = JSON.stringify(teamWeeklyAiInput(report));
      expect(input).not.toContain('示例队员');
      expect(input).not.toContain('合成测试队');
      expect(input).not.toContain('sleep');
      expect(teamWeeklyFingerprint({ ...report, generatedAt: 'different' })).toBe(
        teamWeeklyFingerprint(report)
      );
    } finally {
      db.close();
    }
  });
  it('认证、角色、同意和指纹必须有效，非法请求不调用模型', async () => {
    const { post, body, state } = await setup();
    expect((await post('/commentary', body, { 'x-deny': '1' })).status).toBe(401);
    expect((await post('/commentary', body, { 'x-athlete': '1' })).status).toBe(403);
    expect((await post('/commentary', { ...body, consent: false })).status).toBe(400);
    expect((await post('/commentary', { ...body, fingerprint: 'a'.repeat(64) })).status).toBe(409);
    expect((await post('/commentary', { ...body, query: { ...query, teamId: 2 } })).status).toBe(
      403
    );
    expect(state.generate).not.toHaveBeenCalled();
  });
  it('返回验证后的AI草稿，导出必须确认并复核数据', async () => {
    const { post, body, db } = await setup();
    const response = await post('/commentary', body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(commentary);
    const pdfBody = { query, fingerprint: body.fingerprint, commentary, confirmed: true };
    expect((await post('/pdf', { ...pdfBody, confirmed: false })).status).toBe(400);
    const pdf = await post('/pdf', pdfBody);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('cache-control')).toBe('no-store');
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString()
    ).toBe('%PDF-');
    db.exec('UPDATE training_sessions SET duration_min=61 WHERE id=1');
    expect((await post('/pdf', pdfBody)).status).toBe(409);
  });
  it('模型格式错误和模型失败不伪造成功，之后可重试', async () => {
    const { post, body, state } = await setup();
    state.generate.mockResolvedValueOnce({ summary: 'bad' });
    expect((await post('/commentary', body)).status).toBe(502);
    state.generate.mockRejectedValueOnce(new Error('internal secret'));
    const failed = await post('/commentary', body);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('secret');
    expect((await post('/commentary', body)).status).toBe(200);
  });
  it('等待模型期间权限或数据变化，拒绝回传草稿', async () => {
    const { post, body, state, db } = await setup();
    state.generate.mockImplementationOnce(async () => {
      state.current = null;
      return commentary;
    });
    expect((await post('/commentary', body)).status).toBe(403);
    state.current = {
      id: 1,
      username: 'test',
      displayName: '测试',
      role: 'SCC',
      athleteId: null,
      sessionVersion: 1,
    };
    state.generate.mockImplementationOnce(async () => {
      db.exec('UPDATE training_sessions SET duration_min=62 WHERE id=1');
      return commentary;
    });
    expect((await post('/commentary', body)).status).toBe(409);
  });
});
