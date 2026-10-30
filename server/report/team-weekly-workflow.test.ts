import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { AuthUser } from '../core/shared-server.ts';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { registerTeamWeeklyRoutes } from './team-weekly-routes.ts';
import { renderTeamWeeklyDocx } from './team-weekly-docx.ts';
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
const input = { query: { project: 'ROWING', teamId: 1, date: '2026-10-05' }, consent: true };
async function setup() {
  const db = createTeamWeeklyFixture();
  const state = { active: true, ids: [1, 3], role: 'SCC' as AuthUser['role'] };
  const user = (): AuthUser => ({
    id: 1,
    username: 'synthetic',
    displayName: '合成教练',
    role: state.role,
    athleteId: null,
    sessionVersion: 1,
  });
  const generate = vi.fn(async (): Promise<unknown> => ({
    summary: '合成AI总结',
    training: '专项',
    strength: '体能',
    recovery: '',
    nextWeek: '',
  }));
  const renderDocx = vi.fn(renderTeamWeeklyDocx);
  const app = express();
  app.use(express.json());
  registerTeamWeeklyRoutes(app, {
    db,
    generate,
    renderDocx,
    currentUser: () => (state.active ? user() : null),
    accessibleIds: () => state.ids,
    requireAuth: (req, res, next) => {
      if (req.headers['x-deny']) {
        res.sendStatus(401);
        return;
      }
      req.authUser = user();
      next();
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closes.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports/weekly`;
  const post = (body: unknown = input, headers = {}) =>
    fetch(base + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { db, state, generate, renderDocx, base, post };
}
it('一次请求返回可编辑Word；不建历史表、不写训练事实，旧入口均删除', async () => {
  const s = await setup();
  const before = s.db.prepare('SELECT count(*) AS n FROM training_sessions').get();
  const response = await s.post();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('wordprocessingml.document');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-disposition')).toContain('attachment;');
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  expect(await zip.file('word/document.xml')!.async('string')).toContain('合成AI总结');
  expect(s.db.prepare('SELECT count(*) AS n FROM training_sessions').get()).toEqual(before);
  expect(
    s.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('team_weekly_reports','team_weekly_photos')"
      )
      .all()
  ).toEqual([]);
  for (const path of ['/history', '/preview', '/pdf', '/history/old/docx', '/photos/id'])
    expect((await fetch(s.base + path)).status).toBe(404);
  for (const path of ['/save', '/commentary', '/pdf', '/photos'])
    expect((await fetch(s.base + path, { method: 'POST' })).status).toBe(404);
});
it('AI失败仍可下载基础Word，未同意时不调用AI', async () => {
  const s = await setup();
  s.generate.mockRejectedValue(new Error('unavailable'));
  expect((await s.post()).status).toBe(200);
  s.generate.mockClear();
  expect((await s.post({ ...input, consent: false })).status).toBe(200);
  expect(s.generate).not.toHaveBeenCalled();
});
it('认证、角色、项目、非法输入及等待中权限收紧仍被服务端拒绝', async () => {
  const s = await setup();
  expect((await s.post(input, { 'x-deny': '1' })).status).toBe(401);
  s.state.role = 'ATL';
  expect((await s.post()).status).toBe(403);
  s.state.role = 'SCC';
  expect(
    (await s.post({ ...input, query: { ...input.query, project: 'CANOE_SPRINT' } })).status
  ).toBe(403);
  expect((await s.post({ ...input, confirmed: true })).status).toBe(400);
  expect(
    (await s.post({ ...input, query: { ...input.query, reportType: 'physical' } })).status
  ).toBe(400);
  s.generate.mockImplementation(async () => {
    s.state.ids = [];
    return {};
  });
  expect((await s.post()).status).toBe(403);
  expect(s.renderDocx).not.toHaveBeenCalled();
});
it('照片随请求压缩内嵌，不需要上传ID或持久化；无效照片拒绝', async () => {
  const s = await setup();
  const photo = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  const form = (buffer: Uint8Array) => {
    const value = new FormData();
    value.set('input', JSON.stringify({ ...input, consent: false }));
    value.append('files', new Blob([buffer as Uint8Array<ArrayBuffer>]), 'photo.png');
    return value;
  };
  const response = await fetch(s.base + '/generate', {
    method: 'POST',
    body: form(new Uint8Array(photo)),
  });
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  expect(
    Object.keys(zip.files).filter((p) => p.startsWith('word/media/') && !zip.files[p].dir)
  ).toHaveLength(1);
  expect(
    (
      await fetch(s.base + '/generate', {
        method: 'POST',
        body: form(new TextEncoder().encode('invalid')),
      })
    ).status
  ).toBe(400);
});
it('同账号生成期间拒绝重复请求；导出期间权限收紧不发送文件', async () => {
  const s = await setup();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.renderDocx.mockImplementation(async () => {
    started();
    await wait;
    return Buffer.from('word');
  });
  const pending = s.post({ ...input, consent: false });
  await ready;
  expect((await s.post()).status).toBe(429);
  s.state.active = false;
  release();
  expect((await pending).status).toBe(403);
});
