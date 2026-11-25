import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

// 所有接口均拦截为脱敏固定样例；不登录真实账号、不读写业务数据库。
const base = process.env.PLAN_CHECK_BASE_URL || 'http://127.0.0.1:5179';
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const plans = [
  {
    key: 'training_plans:1',
    id: 1,
    source: 'training_plans',
    kind: 'physical',
    title: '体能周期',
    project: 'ROWING',
    teamId: 10,
    team: '一队',
    athleteId: 101,
    athleteName: '样例队员',
    startDate: date,
    endDate: date,
    createdBy: '样例教练',
    sourceStatus: '',
    data: {
      startDate: date,
      endDate: date,
      scheduleLabel: '四周周期',
      bodyWeight: 70,
      age: 20,
      exercises: [
        {
          id: 'squat',
          name: '深蹲',
          category: '基础力量',
          maxWeight: 100,
          unitNote: '动作标准优先',
          lines: [
            {
              weeks: {
                1: {
                  sets: '3',
                  reps: '5',
                  percentage: 60,
                  arrangement: '周一',
                  actualCompleted: '',
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    key: 'special_training_plans:1',
    id: 1,
    source: 'special_training_plans',
    kind: 'special',
    title: '专项周计划',
    project: 'ROWING',
    teamId: null,
    team: '',
    athleteId: null,
    athleteName: '',
    startDate: date,
    endDate: date,
    createdBy: '样例教练',
    sourceStatus: 'active',
    data: {
      sessions: [
        {
          session_date: date,
          content: '水上技术训练',
          training_type: '专项训练',
          target: { distanceKm: 0 },
        },
      ],
    },
  },
  {
    key: 'training_plans:2',
    id: 2,
    source: 'training_plans',
    kind: 'combined',
    title: '综合安排',
    project: 'ROWING',
    teamId: 20,
    team: '二队',
    athleteId: 102,
    athleteName: '样例乙',
    startDate: date,
    endDate: date,
    createdBy: '样例教练',
    sourceStatus: '',
    data: {
      weeklyPlans: [
        {
          days: [
            {
              date,
              focus: '专项与体能',
              exercises: [
                { name: '水上专项', duration: 60, distance: 0, rawText: '水上原始描述' },
                {
                  name: '深蹲',
                  sets: 3,
                  reps: 5,
                  percentage: 60,
                  plannedWeight: 60,
                  pace: '原计划配速',
                },
              ],
            },
          ],
        },
      ],
    },
  },
];
const teamPlans = [
  {
    id: 10,
    rootId: 10,
    version: 1,
    revision: 3,
    status: 'published',
    teamId: 10,
    project: 'ROWING',
    team: '一队',
    title: '队伍综合计划',
    startDate: date,
    endDate: date,
    publishedAt: new Date().toISOString(),
    archivedAt: null,
    data: {
      goal: '综合训练',
      focus: '专项与体能',
      sessions: [
        {
          id: 'am',
          date,
          category: 'special',
          period: '上午',
          content: '水上专项',
          durationMin: 90,
          distanceKm: 16,
          intensity: 'U2',
          sets: null,
          reps: null,
          load: null,
          notes: '',
        },
        {
          id: 'pm',
          date,
          category: 'physical',
          period: '下午',
          content: '力量训练',
          durationMin: 60,
          distanceKm: null,
          intensity: '',
          sets: 3,
          reps: 8,
          load: 40,
          notes: '',
        },
      ],
      overrides: [
        {
          athleteId: 101,
          sessionId: 'am',
          changes: { durationMin: 60, distanceKm: 10 },
          reason: '教练减量',
        },
      ],
    },
  },
];
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let mode = 'full';
  const savedPayloads = [];
  let saveConflict = false;
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.addInitScript(() =>
    localStorage.setItem('training-monitor-token', 'visual-fixture-only')
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const athletes = [{ id: 101, name: '样例队员', project: 'ROWING', team: '一队', teamId: 10 }];
    let data = {};
    if (path === '/api/me')
      data = {
        user: { id: 1, displayName: '样例教练', username: 'fixture', role: 'SCC', athleteId: null },
      };
    else if (path === '/api/athletes') data = { athletes };
    else if (path === '/api/preferences/current-project')
      data = { project: 'ROWING', projects: ['ROWING'] };
    else if (path === '/api/team-plans') {
      if (mode === 'error')
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '计划读取测试失败' }),
        });
      data = {
        plans: mode === 'empty' ? [] : teamPlans,
        teams: [{ id: 10, name: '一队', project: 'ROWING' }],
        athletes,
      };
    } else if (/^\/api\/team-plans\/\d+$/.test(path) && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (saveConflict) {
        saveConflict = false;
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: '计划已变化，请重新载入' }),
        });
      }
      const index = teamPlans.findIndex((plan) => plan.id === Number(path.split('/').at(-1)));
      assert.equal(body.revision, teamPlans[index].revision);
      savedPayloads.push(structuredClone(body));
      teamPlans[index] = { ...teamPlans[index], ...body, revision: body.revision + 1 };
      data = { plan: teamPlans[index] };
    } else if (/^\/api\/team-plans\/\d+\/transition$/.test(path)) {
      const body = route.request().postDataJSON();
      const plan = teamPlans.find((plan) => plan.id === Number(path.split('/').at(-2)));
      assert.equal(body.revision, plan.revision);
      if (body.action === 'revise') {
        const revised = {
          ...structuredClone(plan),
          id: 11,
          version: 2,
          revision: 1,
          status: 'draft',
          publishedAt: null,
          archivedAt: null,
        };
        teamPlans.push(revised);
        data = { plan: revised };
      } else {
        if (body.action === 'publish') {
          assert.equal(body.confirmed, true);
          for (const older of teamPlans)
            if (older.id !== plan.id && older.rootId === plan.rootId) older.status = 'archived';
        }
        plan.status =
          body.action === 'submit'
            ? 'pending'
            : body.action === 'publish'
              ? 'published'
              : body.action === 'return'
                ? 'draft'
                : 'archived';
        plan.revision += 1;
        if (plan.status === 'published') plan.publishedAt = new Date().toISOString();
        data = { plan };
      }
    } else if (path === '/api/training-plans/catalog')
      data = { plans: mode === 'empty' ? [] : plans };
    else if (path === '/api/coach/plan-execution')
      data = {
        athletes: [
          {
            athleteId: 101,
            athleteName: '样例队员',
            plannedDays: 1,
            actualDays: 1,
            completionRate: null,
            totalDurationMin: 60,
            todayRpeReported: true,
          },
        ],
      };
    else if (path === '/api/records') data = { records: [] };
    else if (path === '/api/overview/teams') data = { teams: [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(`${base}/training-plans`);
  await page.getByRole('button', { name: '查看计划：队伍综合计划 V1', exact: true }).waitFor();
  await page.getByRole('button', { name: '查看计划：队伍综合计划 V1', exact: true }).click();
  await page.getByRole('heading', { name: '上午 · 专项', exact: false }).waitFor();
  await page.getByText('查看已调整运动员与差异', { exact: true }).click();
  await page.getByText(/原因：教练减量/).waitFor();
  await page.getByLabel('最终适用计划预览').selectOption('101');
  await page.getByText(/时长：60 分钟 · 距离：10 km/).waitFor();
  await mkdir('tmp/unified-plan-visual', { recursive: true });
  await page.screenshot({ path: 'tmp/unified-plan-visual/desktop.png', fullPage: true });
  // 使用真实前端交互验证既有 API 契约，接口持久化仅在内存合成样例中发生。
  await page.getByRole('button', { name: '创建修订草稿', exact: true }).click();
  await page.getByRole('button', { name: '编辑队伍课', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '编辑队伍课', exact: true }).first().click();
  await page.keyboard.press('Tab');
  await page.getByLabel('训练日期', { exact: true }).evaluate((element) => {
    if (document.activeElement !== element) throw Error('Tab 必须进入训练日期字段');
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑队伍课', exact: true }).first().click();
  await page.getByLabel('训练名称、目标与内容', { exact: true }).fill('   ');
  await page.getByRole('button', { name: '保存训练课', exact: true }).click();
  await page.getByLabel('训练名称、目标与内容', { exact: true }).evaluate((element) => {
    if (element.getAttribute('aria-invalid') !== 'true') throw Error('空白内容必须关联校验错误');
  });
  await page
    .getByLabel('训练名称、目标与内容', { exact: true })
    .fill('水上有氧训练\n热身 → 主训练 → 整理');
  await page.getByLabel('计划时长（分钟）', { exact: true }).fill('75');
  await page
    .getByRole('region', { name: '周计划编排', exact: true })
    .screenshot({ path: 'tmp/unified-plan-visual/editor.png', animations: 'disabled' });
  await page.getByRole('button', { name: '保存训练课', exact: true }).click();
  await page
    .getByText('已加入草稿，周视图已更新；请保存草稿以同步到服务器。', { exact: true })
    .waitFor();
  const selectedDate = await page.getByLabel('选择日期', { exact: true }).inputValue();
  page.removeAllListeners('dialog');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  assert.equal(await page.getByLabel('选择日期', { exact: true }).inputValue(), selectedDate);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await page.getByRole('button', { name: '返回本周', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存到服务器。', { exact: true }).waitFor();
  assert.equal(savedPayloads.at(-1).data.sessions[0].durationMin, 75);
  assert.equal(savedPayloads.at(-1).data.goal, '综合训练');
  assert.equal(savedPayloads.at(-1).data.focus, '专项与体能');
  await page.getByRole('button', { name: '个人调整', exact: true }).first().click();
  await page.getByLabel('适用运动员', { exact: true }).evaluate((element) => {
    if (document.activeElement !== element) throw Error('个人调整必须聚焦运动员选择');
  });
  await page.getByLabel('适用运动员', { exact: true }).selectOption('101');
  await page.getByLabel('计划时长（分钟）', { exact: true }).fill('50');
  await page.getByLabel('调整原因', { exact: true }).fill('周视图减量');
  await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存到服务器。', { exact: true }).waitFor();
  assert.deepEqual(savedPayloads.at(-1).data.overrides[0].changes, {
    durationMin: 50,
    distanceKm: 10,
  });
  await page.getByRole('button', { name: '编辑队伍课', exact: true }).first().click();
  await page.getByLabel('计划时长（分钟）', { exact: true }).fill('78');
  await page.getByRole('button', { name: '保存训练课', exact: true }).click();
  saveConflict = true;
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '计划已变化，请重新载入' }).waitFor();
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await page.getByText('已载入最新版本。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /下移训练课：上午/ }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存到服务器。', { exact: true }).waitFor();
  assert.deepEqual(
    savedPayloads.at(-1).data.sessions.map((session) => session.id),
    ['pm', 'am']
  );
  await page.getByRole('button', { name: '删除训练课', exact: true }).last().click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByText('草稿已保存到服务器。', { exact: true }).waitFor();
  assert.equal(savedPayloads.at(-1).data.overrides.length, 0);
  assert.deepEqual(
    savedPayloads.at(-1).data.sessions.map((session) => session.id),
    ['pm']
  );
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await page.getByLabel('我已核对每日训练安排、个人差异与完整发布周期', { exact: true }).waitFor();
  await page.getByLabel('我已核对每日训练安排、个人差异与完整发布周期', { exact: true }).check();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByText('操作成功：已发布 V2。', { exact: true }).waitFor();
  assert.equal(teamPlans[0].status, 'archived');
  assert.equal(teamPlans[0].data.sessions[0].durationMin, 90, '修订不能改写原发布版本');
  await page.getByRole('button', { name: '查看计划：队伍综合计划 V2', exact: true }).click();
  await page.getByRole('button', { name: '草稿', exact: true }).click();
  await page.getByText('暂无队伍训练计划', { exact: true }).waitFor();
  await page.getByRole('button', { name: '全部计划', exact: true }).click();
  await page.getByRole('button', { name: '查看计划：队伍综合计划 V2', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await page.getByRole('button', { name: '关闭菜单', exact: true }).first().click();
  await page.screenshot({
    path: 'tmp/unified-plan-visual/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    '手机页不得横向溢出'
  );
  mode = 'empty';
  await page.reload();
  await page.getByText('暂无队伍训练计划', { exact: true }).waitFor();
  mode = 'error';
  await page.reload();
  await page.getByText('计划读取测试失败', { exact: true }).waitFor();
  mode = 'full';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '查看计划：队伍综合计划 V1', exact: true }).waitFor();
  const extended = {
    ...structuredClone(teamPlans[1]),
    id: 12,
    rootId: 12,
    title: '扩展字段计划',
    status: 'draft',
    data: { ...structuredClone(teamPlans[1].data), unsupportedField: '原始值' },
  };
  teamPlans.push(extended);
  await page.reload();
  await page.getByRole('button', { name: '查看计划：扩展字段计划 V2', exact: true }).click();
  await page.getByRole('note').filter({ hasText: '包含当前保存接口尚不支持的扩展字段' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '编辑队伍课', exact: true }).count(), 0);
  assert.equal(extended.data.unsupportedField, '原始值');
  assert.deepEqual(errors, []);
  console.log(
    '队伍计划浏览器检查通过：周视图、逐课编辑、个人差异、未保存切换、并发冲突、排序删除、修订发布、移动布局及空态重试。接口使用合成样例。'
  );
} finally {
  await browser.close();
}
