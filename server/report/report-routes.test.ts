import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { AuthUser } from '../core/shared-server.ts';
import { registerReportRoutes } from './report-routes.ts';
import { createReportFixture } from './report-fixture.ts';
import { reportPreviewSchema, savedReportSchema } from '../../shared/training-report.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
const range = { from: '2026-10-05', to: '2026-10-11', kind: 'week' };
const commentary = {
  highlights: ['训练记录已汇总。'],
  concerns: ['部分课次缺少时长。'],
  suggestions: ['核对缺失记录。'],
};
async function setup() {
  const db = createReportFixture();
  const user: AuthUser = {
    id: 1,
    username: 'synthetic',
    displayName: '合成测试',
    role: 'ATL',
    athleteId: 1,
    sessionVersion: 1,
  };
  const state = {
    authorized: true,
    active: true,
    generate: async (): Promise<unknown> => commentary,
  };
  const app = express();
  app.use(express.json());
  registerReportRoutes(app, {
    db,
    requireAuth: (req, res, next) => {
      if (req.headers['x-test-deny']) {
        res.status(401).json({ message: '未登录' });
        return;
      }
      req.authUser = user;
      next();
    },
    hasAccess: (_user, id) => state.authorized && id === 1,
    currentUser: () => (state.active ? user : null),
    generate: () => state.generate(),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    db.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/athletes/1/reports`;
  const getPreview = async () =>
    reportPreviewSchema.parse(
      await (await fetch(`${base}/preview?${new URLSearchParams(range)}`)).json()
    );
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { db, state, base, getPreview, post };
}
describe('训练报告 API 权限与失败边界', () => {
  it('PDF仅导出授权的历史快照，拒绝越权和无效编号', async () => {
    const { base, db, post, getPreview, state } = await setup();
    const preview = await getPreview();
    const saved = savedReportSchema.parse(await (await post('', { range, fingerprint: preview.fingerprint, commentary, confirmed: true })).json());
    db.exec('DELETE FROM training_sessions');
    const response = await fetch(`${base}/${saved.id}/pdf`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await fetch(`${base}/${saved.id}/pdf`, { headers: { 'x-test-deny': 'true' } })).status).toBe(401);
    expect((await fetch(`${base.replace('/1/', '/2/')}/${saved.id}/pdf`)).status).toBe(403);
    expect((await fetch(`${base}/bad/pdf`)).status).toBe(400);
    expect((await fetch(`${base}/00000000-0000-4000-8000-000000000001/pdf`)).status).toBe(404);
    state.authorized = false;
    expect((await fetch(`${base}/${saved.id}/pdf`)).status).toBe(403);
  });
  it('预览、确认、两端共用历史、不可改写快照', async () => {
    const { base, db, getPreview, post } = await setup();
    const preview = await getPreview();
    const response = await post('', {
      range,
      fingerprint: preview.fingerprint,
      commentary,
      confirmed: true,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const saved = savedReportSchema.parse(await response.json());
    db.exec('UPDATE training_sessions SET duration_min = 80 WHERE id = 1');
    const detail = savedReportSchema.parse(await (await fetch(`${base}/${saved.id}`)).json());
    expect(detail.data.totals.duration).toBe(60);
    expect(detail.commentary).toEqual(commentary);
    expect(await (await fetch(base)).json()).toHaveLength(1);
    expect((await getPreview()).data.totals.duration).toBe(80);
  });
  it('未登录、越权、未知报告均拒绝，不能读取别人的报告', async () => {
    const { base } = await setup();
    expect((await fetch(base, { headers: { 'x-test-deny': 'true' } })).status).toBe(401);
    expect((await fetch(base.replace('/1/', '/2/'))).status).toBe(403);
    expect((await fetch(`${base}/00000000-0000-4000-8000-000000000001`)).status).toBe(404);
  });
  it('拒绝伪造统计、未确认、过期数据指纹，不污染事实表', async () => {
    const { db, post, getPreview } = await setup();
    const preview = await getPreview();
    const body = { range, fingerprint: preview.fingerprint, commentary, confirmed: true };
    expect((await post('', { ...body, totals: { duration: 9999 } })).status).toBe(400);
    expect((await post('', { ...body, confirmed: false })).status).toBe(400);
    db.exec('UPDATE training_sessions SET duration_min = 61 WHERE id = 1');
    expect((await post('', body)).status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS n FROM training_reports').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM training_sessions').get()?.n).toBe(8);
  });
  it('无同意不调用模型，模型失败仍能预览保存', async () => {
    const { state, post, getPreview } = await setup();
    const preview = await getPreview();
    state.generate = async () => {
      throw new Error('private provider details');
    };
    expect((await post('/commentary', { range, fingerprint: preview.fingerprint })).status).toBe(
      400
    );
    const response = await post('/commentary', {
      range,
      fingerprint: preview.fingerprint,
      consent: true,
    });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private');
    expect((await getPreview()).data.totals.sessions).toBe(3);
    expect(
      (await post('', { range, fingerprint: preview.fingerprint, commentary, confirmed: true }))
        .status
    ).toBe(201);
  });
  it('模型输出必须通过结构验证，不执行模型内容', async () => {
    const { state, post, getPreview } = await setup();
    const preview = await getPreview();
    state.generate = async () => ({ ...commentary, sql: 'DELETE FROM athletes' });
    expect(
      (await post('/commentary', { range, fingerprint: preview.fingerprint, consent: true })).status
    ).toBe(502);
  });
  it('模型等待后重新检查账号和项目权限', async () => {
    const { state, post, getPreview } = await setup();
    const preview = await getPreview();
    state.generate = async () => {
      state.active = false;
      return commentary;
    };
    expect(
      (await post('/commentary', { range, fingerprint: preview.fingerprint, consent: true })).status
    ).toBe(403);
  });
  it('模型等待时数据变化拒绝旧点评', async () => {
    const { db, state, post, getPreview } = await setup();
    const preview = await getPreview();
    state.generate = async () => {
      db.exec('UPDATE training_sessions SET duration_min = 70 WHERE id = 1');
      return commentary;
    };
    expect(
      (await post('/commentary', { range, fingerprint: preview.fingerprint, consent: true })).status
    ).toBe(409);
  });
  it('成功点评只返回草稿，每账号限流不无限调用', async () => {
    const { post, getPreview } = await setup();
    const preview = await getPreview();
    const body = { range, fingerprint: preview.fingerprint, consent: true };
    expect(await (await post('/commentary', body)).json()).toEqual(commentary);
    await post('/commentary', body);
    await post('/commentary', body);
    await post('/commentary', body);
    await post('/commentary', body);
    await post('/commentary', body);
    expect((await post('/commentary', body)).status).toBe(429);
  });
});
