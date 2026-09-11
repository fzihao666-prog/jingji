import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

// 独立临时数据库；所有写入仅用于回归，不连接本地正式数据。
const directory = mkdtempSync(join(tmpdir(), 'special-dashboard-'));
const databasePath = join(directory, 'check.db');
const port = 8798;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath }, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
server.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
let browser;
let token;
async function request(path, body, method = 'POST') {
  const response = await fetch(base + path, { method: body ? method : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json();
  assert.ok(response.ok, `${path}：${response.status} ${payload.message || ''}`);
  return payload;
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { token = (await request('/api/auth/login', { username: 'admin01', password: 'demo123' })).token; break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(token, `测试服务启动失败：${stderr}`);
  const { athletes } = await request('/api/athletes');
  const athlete = athletes.find((row) => row.project === 'ROWING');
  assert.ok(athlete);
  await request('/api/preferences/current-project', { project: 'ROWING' }, 'PUT');
  await request('/api/special-training/sessions', { sessions: [1, 2, 4].map((day) => ({ athleteId: athlete.id, project: 'ROWING', date: `2026-09-0${day}`, type: '技术训练', content: `专项水上回归${day}`, duration: 60 + day, distance: 12 + day, rpe: 6, strokeRate: 28, heartRate: 145, maxHeartRate: 175, power: 320, source: 'manual' })) });
  const db = new DatabaseSync(databasePath);
  const user = db.prepare("SELECT id FROM users WHERE username = 'admin01'").get();
  for (const [day, time] of [[1, 430000], [4, 420000]]) {
    const event = db.prepare("INSERT INTO special_test_events (project, test_date, distance_m, boat_class, gender_group, created_by) VALUES ('赛艇', ?, 2000, '单人双桨', '男子组', ?)").run(`2026-09-0${day}`, user.id);
    db.prepare('INSERT INTO special_test_results (event_id, crew_name, member_athlete_ids, member_names, attempts_ms, average_ms, best_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(event.lastInsertRowid, '回归组合', JSON.stringify([athlete.id]), JSON.stringify(['回归运动员']), JSON.stringify([time]), time, time);
  }
  db.close();
  const response = await request(`/api/special-training/overview?from=2026-09-01&to=2026-09-05&project=ROWING&athleteId=${athlete.id}`);
  assert.equal(response.events.length, 2, '未读到旧项目名称下的真实成绩');
  assert.equal(response.training.summary.sessionCount, 3);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript((value) => localStorage.setItem('training-monitor-token', value), token);
  await page.goto(base);
  await page.getByRole('button', { name: '专项训练', exact: true }).click();
  await page.getByRole('heading', { name: '专项重要数据概览', exact: true }).waitFor();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || /ECharts/.test(message.text()) && message.type() === 'warning') errors.push(message.text()); });
  await page.getByLabel('开始日期', { exact: true }).fill('2026-09-01');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-09-05');
  await page.getByRole('heading', { name: '2000m · 单人双桨 · 男子组', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.app-echart canvas').length === 5);
  const headings = await page.locator('main h2').allTextContents();
  for (const name of ['专项重要数据概览', '专项训练量统计', '专项训练强度占比', '专项训练课占比', '专项训练负荷分析', '专项表现趋势', '最近专项训练']) assert.ok(headings.includes(name));
  assert.equal(await page.getByLabel('专项训练运动员筛选').inputValue(), '');
  const champion = await page.locator('.special-champion-model').innerHTML();
  const firstChart = page.locator('.app-echart').first();
  await firstChart.scrollIntoViewIfNeeded();
  await firstChart.screenshot({ path: '/tmp/special-dashboard-volume.png' });
  await page.screenshot({ path: '/tmp/special-dashboard-desktop.png', fullPage: true });
  await page.getByLabel('专项训练运动员筛选').selectOption(String(athlete.id));
  await page.getByRole('heading', { name: '专项重要数据概览', exact: true }).waitFor();
  assert.equal(await page.locator('.special-champion-model').innerHTML(), champion, '个人下钻改变了冠军模型');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '移动端页面横向溢出');
  assert.ok((await page.locator('.training-dashboard-metric').first().boundingBox()).height < 180, '移动端紧凑卡片被通用面板高度撑开');
  for (const chart of await page.locator('.app-echart').all()) assert.ok((await chart.boundingBox()).width > 0);
  await page.screenshot({ path: '/tmp/special-dashboard-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('选择项目大类').click();
  await page.getByRole('option').filter({ hasText: 'Canoe Slalom' }).click();
  await page.getByRole('heading', { name: '专项重要数据概览', exact: true }).waitFor();
  await page.getByText('暂无可靠专项成绩数据', { exact: true }).waitFor();
  assert.equal(await page.locator('.app-echart').count(), 0, '项目切换后残留旧图表');
  assert.deepEqual(errors, []);
  console.log('专项首页浏览器回归通过：真实接口、全部/个人筛选、日期联动、五张图表、旧成绩兼容、冠军模型不变、项目切换、移动端布局。');
} finally {
  await browser?.close();
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  rmSync(directory, { recursive: true, force: true });
}
