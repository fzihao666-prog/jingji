import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { registerTeamWeeklyRoutes } from './team-weekly-routes.ts';
import { registerWeeklyHistoryRoutes } from './team-weekly-history-routes.ts';
import { createTeamWeeklyPhotoStore } from './team-weekly-photos.ts';
import { renderTeamWeeklyPdf } from './team-weekly-pdf.ts';
import { weeklyDraftSchema } from '../../shared/team-weekly-workflow.ts';
import { savedTeamWeeklyReportSchema } from '../../shared/team-weekly-storage.ts';
import type { AuthUser } from '../core/shared-server.ts';
import type { teamWeeklyAiInput } from './team-weekly-ai.ts';
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closes.splice(0)) await close();
});
const commentary = {
  summary: '本周以动作控制为重点，训练统计见图表，现场情况待教练核对。',
  training: '按照当前已记录的专项训练安排进行回顾。',
  strength: '',
  recovery: '',
  nextWeek: '下周重点由教练结合已发布课表补充。',
};
const input = {
  query: { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'special' },
  stage: '恢复训练周',
  coachNotes: '本周以动作控制为主。',
  consent: true,
};
async function setup() {
  const db = createTeamWeeklyFixture();
  const dir = await mkdtemp(join(tmpdir(), 'weekly-flow-'));
  const photoStore = createTeamWeeklyPhotoStore(db, dir);
  const user: AuthUser = {
    id: 1,
    username: 'synthetic',
    displayName: '测试',
    role: 'SCC',
    athleteId: null,
    sessionVersion: 1,
  };
  const state = { active: true, ids: [1, 3], role: 'SCC' as AuthUser['role'] };
  const generate = vi.fn(
    async (data: ReturnType<typeof teamWeeklyAiInput>, signal: AbortSignal): Promise<unknown> => {
      void data;
      void signal;
      return commentary;
    }
  );
  const auth: express.RequestHandler = (req, res, next) => {
    if (req.headers['x-deny']) {
      res.sendStatus(401);
      return;
    }
    req.authUser = { ...user, role: state.role };
    next();
  };
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const deps = {
    db,
    photoStore,
    requireAuth: auth,
    currentUser: () => (state.active ? { ...user, role: state.role } : null),
    accessibleIds: () => state.ids,
  };
  registerTeamWeeklyRoutes(app, { ...deps, generate });
  registerWeeklyHistoryRoutes(app, {
    ...deps,
    authorizeScope: (_u, scope) => {
      if (scope.teamId !== 1 || scope.project !== 'ROWING') throw new Error('denied');
    },
    renderPdf: (saved, buffers) =>
      renderTeamWeeklyPdf(
        saved.report,
        saved.commentary,
        buffers.map((data, i) => ({
          data,
          width: saved.photos[i].width,
          height: saved.photos[i].height,
        }))
      ),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closes.push(async () => {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports/weekly`;
  const post = (path: string, body: unknown) =>
    fetch(root + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { db, state, photoStore, root, post, generate };
}
describe('两类周报的一键生成、确认和历史', () => {
  it('教练训练观察参与AI，生成不保存；敏感观察保留本地；失败仍返回基础图文', async () => {
    const s = await setup();
    const response = await s.post('/generate', input);
    expect(response.status).toBe(200);
    const draft = weeklyDraftSchema.parse(await response.json());
    expect(draft.data.stage).toBe(input.stage);
    expect(draft.aiStatus).toBe('generated');
    expect(s.generate.mock.calls[0][0].coachObservation).toBe(input.coachNotes);
    expect(s.db.prepare('SELECT count(*) AS n FROM team_weekly_reports').get()?.n).toBe(0);
    const privateNotes = '示例队员本周腰部疼痛，电话13800138000';
    const withheld = weeklyDraftSchema.parse(
      await (await s.post('/generate', { ...input, coachNotes: privateNotes })).json()
    );
    expect(withheld.data.coachNotes).toBe(privateNotes);
    expect(withheld.messages.join('')).toContain('未发送');
    expect(JSON.stringify(s.generate.mock.calls[1][0])).not.toContain('13800138000');
    s.generate.mockRejectedValueOnce(new Error('internal secret'));
    const fallback = weeklyDraftSchema.parse(await (await s.post('/generate', input)).json());
    expect(fallback.aiStatus).toBe('fallback');
    expect(fallback.commentary.summary.length).toBeGreaterThan(20);
    expect(fallback.data.daily).toHaveLength(7);
  });
  it('保存与替换按唯一键，历史不因补录重算，旧修订不能覆盖', async () => {
    const s = await setup();
    const draft = weeklyDraftSchema.parse(await (await s.post('/generate', input)).json());
    const body = {
      report: draft.data,
      fingerprint: draft.fingerprint,
      commentary: draft.commentary,
      photoIds: [],
      expectedRevision: draft.expectedRevision,
      confirmed: true,
    };
    const first = savedTeamWeeklyReportSchema.parse(await (await s.post('/save', body)).json());
    expect(first.revision).toBe(1);
    expect((await s.post('/save', body)).status).toBe(409);
    const next = weeklyDraftSchema.parse(await (await s.post('/generate', input)).json());
    const replaced = savedTeamWeeklyReportSchema.parse(
      await (
        await s.post('/save', {
          ...body,
          report: next.data,
          fingerprint: next.fingerprint,
          expectedRevision: next.expectedRevision,
          commentary: { ...commentary, summary: '更正后的教练总结' },
        })
      ).json()
    );
    expect(replaced.id).toBe(first.id);
    expect(replaced.revision).toBe(2);
    const physical = weeklyDraftSchema.parse(
      await (
        await s.post('/generate', {
          ...input,
          query: { ...input.query, reportType: 'physical' },
          consent: false,
        })
      ).json()
    );
    expect(physical.aiStatus).toBe('skipped');
    expect(
      (
        await s.post('/save', {
          report: physical.data,
          fingerprint: physical.fingerprint,
          commentary: physical.commentary,
          photoIds: [],
          expectedRevision: 0,
          confirmed: true,
        })
      ).status
    ).toBe(200);
    expect(s.db.prepare('SELECT count(*) AS n FROM team_weekly_reports').get()?.n).toBe(2);
    s.db.exec('UPDATE training_sessions SET duration_min=99 WHERE id=1');
    const historical = savedTeamWeeklyReportSchema.parse(
      await (await fetch(s.root + `/history/${first.id}`)).json()
    );
    expect(historical.report.totals.duration).toBe(first.report.totals.duration);
    expect(historical.commentary.summary).toBe('更正后的教练总结');
    const pdf = await fetch(s.root + `/history/${first.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString()
    ).toBe('%PDF-');
    s.state.ids = [1];
    expect((await fetch(s.root + `/history/${first.id}`)).status).toBe(403);
  });
  it('照片与确认快照贯通；生成期间变更数据会拒绝；缺报告类型明确报错', async () => {
    const s = await setup();
    const image = await sharp({
      create: { width: 60, height: 40, channels: 3, background: '#176f7f' },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('teamId', '1');
    form.set('reportType', 'special');
    form.append('files', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'photo.png');
    const upload = await fetch(s.root + '/photos', { method: 'POST', body: form });
    expect(upload.status).toBe(200);
    const photos = (await upload.json()) as { photos: { id: string }[] };
    const draft = weeklyDraftSchema.parse(await (await s.post('/generate', input)).json());
    const saved = savedTeamWeeklyReportSchema.parse(
      await (
        await s.post('/save', {
          report: draft.data,
          fingerprint: draft.fingerprint,
          commentary: draft.commentary,
          photoIds: photos.photos.map((p) => p.id),
          expectedRevision: 0,
          confirmed: true,
        })
      ).json()
    );
    expect(saved.photos).toHaveLength(1);
    const pdf = await fetch(s.root + `/history/${saved.id}/pdf`);
    expect(pdf.status).toBe(200);
    s.generate.mockImplementationOnce(async () => {
      s.db.exec('UPDATE training_sessions SET duration_min=80 WHERE id=1');
      return commentary;
    });
    expect((await s.post('/generate', input)).status).toBe(409);
    expect((await fetch(s.root + '/preview?project=ROWING&teamId=1&date=2026-10-05')).status).toBe(
      400
    );
  });
});
