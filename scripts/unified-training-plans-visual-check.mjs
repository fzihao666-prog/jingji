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
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let catalogMode = 'full';
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.addInitScript(() =>
    localStorage.setItem('training-monitor-token', 'visual-fixture-only')
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path === '/api/me')
      data = {
        user: { id: 1, displayName: '样例教练', username: 'fixture', role: 'SCC', athleteId: null },
      };
    else if (path === '/api/athletes')
      data = {
        athletes: [{ id: 101, name: '样例队员', project: 'ROWING', team: '一队', teamId: 10 }],
      };
    else if (path === '/api/preferences/current-project')
      data = { project: 'ROWING', projects: ['ROWING'] };
    else if (path === '/api/training-plans/catalog') {
      if (catalogMode === 'error')
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '计划读取测试失败' }),
        });
      data = { plans: catalogMode === 'empty' ? [] : plans };
    } else if (path === '/api/coach/plan-execution')
      data = {
        athletes: [
          {
            athleteId: 101,
            athleteName: '样例队员',
            plannedDays: 3,
            actualDays: 1,
            completionRate: 0.33,
            totalDurationMin: 60,
            todayStatus: 'recorded',
            status: 'partial',
            todayDurationMin: 60,
            todayDistanceKm: 0,
            todayRpeReported: true,
          },
        ],
      };
    else if (path === '/api/records') data = { records: [] };
    else if (path === '/api/strength-tests') data = { tests: [] };
    else if (path === '/api/strength-training/results') data = { sessions: [] };
    else if (path === '/api/training-plans') data = { plans: [] };
    else if (path === '/api/overview/teams') data = { teams: [] };
    else if (path === '/api/special-champion-models') data = { project: 'ROWING', events: [] };
    else if (path === '/api/special-champion-models/ergometer')
      data = { project: 'ROWING', gender: 'MALE', testType: '2000M', rows: [] };
    else {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '当前测试未提供分析数据' }),
      });
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(`${base}/training-plans`);
  await page.getByRole('button', { name: '查看计划：体能周期', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^查看计划：/ }).count(), 3);
  await page.getByRole('button', { name: '查看计划：体能周期', exact: true }).click();
  await page.getByText('33%', { exact: true }).waitFor();
  assert.match(await page.locator('.unified-plan-detail').innerText(), /基础力量/);
  assert.match(await page.locator('.unified-plan-detail').innerText(), /计划重量/);
  assert.match(await page.locator('.unified-plan-detail').innerText(), /60/);
  await mkdir('tmp/unified-plan-visual', { recursive: true });
  await page.screenshot({ path: 'tmp/unified-plan-visual/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '综合计划', exact: true }).click();
  await page.getByRole('button', { name: '查看计划：综合安排', exact: true }).click();
  assert.match(await page.locator('.unified-plan-detail').innerText(), /水上原始描述/);
  await page.getByRole('button', { name: '专项计划', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /^查看计划：/ }).count(), 1);
  await page.getByRole('button', { name: '查看计划：专项周计划', exact: true }).click();
  assert.match(await page.locator('.unified-plan-detail').innerText(), /未绑定运动员/);
  await page.getByRole('button', { name: '全部计划', exact: true }).click();
  await page.getByRole('combobox', { name: '筛选队伍', exact: true }).selectOption('10');
  assert.equal(await page.getByRole('button', { name: /^查看计划：/ }).count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'tmp/unified-plan-visual/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    '手机页不得整体横向溢出'
  );
  await page.goto(`${base}/#/special-schedule`);
  await page.getByRole('button', { name: '查看计划：专项周计划', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^查看计划：/ }).count(), 1);
  await page.goto(`${base}/#/strength-plan`);
  await page.getByRole('button', { name: '查看计划：体能周期', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^查看计划：/ }).count(), 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#/special-overview`);
  await page
    .locator('.overview-page-heading')
    .getByRole('button', { name: '训练计划', exact: true })
    .click();
  await page.getByRole('button', { name: '查看计划：专项周计划', exact: true }).waitFor();
  assert.match(page.url(), /type=special/);
  await page.getByRole('button', { name: '返回来源页面' }).click();
  assert.match(page.url(), /special-overview/);
  await page.goto(`${base}/#/strength-overview`);
  await page
    .locator('.overview-page-heading')
    .getByRole('button', { name: '训练计划', exact: true })
    .click();
  await page.getByRole('button', { name: '查看计划：体能周期', exact: true }).waitFor();
  assert.match(page.url(), /type=physical/);
  catalogMode = 'empty';
  await page.goto(`${base}/#/training-plans`);
  await page.getByText('暂无训练计划', { exact: true }).waitFor();
  catalogMode = 'error';
  await page.reload();
  await page.getByText('计划读取测试失败', { exact: true }).waitFor();
  catalogMode = 'full';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '查看计划：体能周期', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('统一训练计划：桌面/手机、三类详情、队伍筛选、执行反馈及旧入口兼容通过。');
} finally {
  await browser.close();
}
