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
  page.on('pageerror', (error) => errors.push(error.message));
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
  await page.getByText('原因：教练减量', { exact: true }).waitFor();
  await page.getByLabel('最终适用计划预览').selectOption('101');
  await page.getByText(/时长：60 分钟 · 距离：10 km/).waitFor();
  await mkdir('tmp/unified-plan-visual', { recursive: true });
  await page.screenshot({ path: 'tmp/unified-plan-visual/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '草稿', exact: true }).click();
  await page.getByText('暂无队伍训练计划', { exact: true }).waitFor();
  await page.getByRole('button', { name: '全部计划', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await page.getByRole('button', { name: '关闭菜单', exact: true }).first().click();
  await page.screenshot({ path: 'tmp/unified-plan-visual/mobile.png', fullPage: true });
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
  assert.deepEqual(errors, []);
  console.log(
    '队伍计划浏览器检查通过：统一课表、个人继承、状态筛选、移动布局、空态与错误重试。接口使用合成样例。'
  );
} finally {
  await browser.close();
}
