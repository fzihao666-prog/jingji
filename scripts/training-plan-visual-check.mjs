import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const outputDirectory = path.resolve(process.argv[2] || 'outputs/training-plan-module');
const baseUrl = process.argv[3] || 'http://127.0.0.1:8787';
await fs.mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

const setDefaults = {
  targetReps: 8, actualReps: 8, plannedWeightKg: 55, actualWeightKg: 57.5,
  durationMin: 15, distanceKm: 0, intensityPercent: 82, intensityZone: 'AN',
  rpe: 7, completed: true, note: '', importBatchId: 'visual', confidence: 1
};
const sessionRows = [
  ['2026-08-03', '上午基础力量', '基础力量', '下肢', '场馆', '深蹲', 3850, 7.4, 70, 0],
  ['2026-08-05', '功能训练', '功能性体能', '全身', '陆上', '药球旋转抛', 2280, 6.2, 45, 0],
  ['2026-08-07', '核心稳定', '核心力量', '核心', '场馆', '平板支撑', 980, 6.5, 38, 0],
  ['2026-08-10', '水上专项', '专项力量', '全身', '水上', '水上抗阻划', 4620, 8.3, 85, 12.5],
  ['2026-08-12', '测功仪间歇', '代谢训练', '全身', '测功仪', '测功仪间歇', 3200, 8.8, 56, 6]
];
const sessions = sessionRows.map((row, index) => ({
  id: 9101 + index, trainingDate: row[0], sessionOrder: 1, sessionLabel: row[1],
  trainingType: '力量训练', structureType: row[4], intensityZone: index === 4 ? 'TPT' : index === 3 ? 'U2' : 'AN',
  rpe: row[7], volume: row[6], durationMin: row[8], distanceKm: row[9], srpe: Number(row[7]) * Number(row[8]),
  source: 'file_import', sourceFilename: '训练结果.xlsx', modelUsed: '', importedAt: `${row[0]}T10:00:00Z`,
  sets: [{ id: 9201 + index, exerciseName: row[5], setIndex: 1, ...setDefaults, trainingCategory: row[2], bodyPosition: row[3], trainingEnvironment: row[4], durationMin: row[8], distanceKm: row[9], intensityZone: index === 4 ? 'TPT' : index === 3 ? 'U2' : 'AN', rpe: row[7] }]
}));

await page.route('**/api/strength-training/results?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions }) }));
await page.route('**/api/strength-tests?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tests: [
  { id: 2, athleteId: 1, testDate: '2026-08-27', metrics: { squatKg: 135, benchPressKg: 95, frontPlankSec: 168, highPullKg: 82, wingatePeakPowerWkg: 15.5 }, targets: { squatKg: 140, benchPressKg: 100, frontPlankSec: 180, highPullKg: 85, wingatePeakPowerWkg: 16 }, notes: '', updatedAt: '', updatedBy: 'coach' },
  { id: 1, athleteId: 1, testDate: '2026-06-27', metrics: { squatKg: 125, benchPressKg: 90, frontPlankSec: 160, highPullKg: 76, wingatePeakPowerWkg: 14.8 }, targets: { squatKg: 140, benchPressKg: 100, frontPlankSec: 180, highPullKg: 85, wingatePeakPowerWkg: 16 }, notes: '', updatedAt: '', updatedBy: 'coach' }
] }) }));

async function login(username) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('demo123');
  await page.getByRole('button', { name: '登录系统', exact: true }).click();
  await page.getByRole('heading', { name: '训练总览' }).waitFor();
}

async function openStrength(label) {
  let target = page.locator('.strength-nav .special-nav-tree button').filter({ hasText: label });
  if (!(await target.count())) {
    await page.locator('.strength-nav .special-nav-parent').click();
    target = page.locator('.strength-nav .special-nav-tree button').filter({ hasText: label });
  }
  await target.click();
  await page.locator('.strength-page-head').waitFor();
}

await login('coach01');
await openStrength('体能总览');
await page.locator('.strength-kpi-grid article').first().waitFor();
if (await page.locator('.strength-kpi-grid article').count() !== 5) throw new Error('体能总览核心指标卡数量不是5。');
if (await page.locator('.strength-dashboard-grid .strength-chart-card').count() !== 6) throw new Error('体能总览图表数量不是6。');
if (await page.getByText('低中高强度占比').count()) throw new Error('体能总览仍显示低中高强度占比。');
if (await page.getByRole('heading', { name: '训练完成情况', exact: true }).count()) throw new Error('体能总览仍单独显示训练完成情况。');
if (await page.locator('.strength-load-split-card').count() !== 1) throw new Error('体能总览缺少新版水陆负荷面板。');
if (await page.locator('.strength-lesson-card').count() !== 1) throw new Error('体能总览缺少新版训练课类型构成面板。');
if (await page.locator('.strength-category-execution-card').count() !== 1) throw new Error('体能总览缺少五类体能训练构成与完成合并面板。');
if (await page.locator('.strength-body-map-card .body-map-stage img').count() !== 1) throw new Error('体能总览缺少身体部位图。');
await page.screenshot({ path: path.join(outputDirectory, '01体能总览.png'), fullPage: true });

await openStrength('训练安排');
await page.locator('.plan-matrix').waitFor();
if (await page.locator('.strength-category-tabs button').count() !== 5) throw new Error('训练安排缺少五类训练Tab。');
const firstMax = await page.locator('.max-cell input').first().inputValue();
const firstWeight = (await page.locator('.weight-cell').first().textContent())?.trim();
if (firstMax !== '65' || firstWeight !== '45.5 kg') throw new Error(`计划重量联动错误：${firstMax}/${firstWeight}`);
await page.screenshot({ path: path.join(outputDirectory, '02训练安排.png'), fullPage: true });

await openStrength('训练记录');
await page.locator('.strength-results-panel').waitFor();
if (await page.locator('.strength-session-card').count() < 1) throw new Error('训练记录未显示已导入场次。');
if (await page.getByRole('button', { name: '导入训练结果', exact: true }).count() !== 1) throw new Error('训练记录导入入口数量异常。');
await page.screenshot({ path: path.join(outputDirectory, '03训练记录.png'), fullPage: true });

await openStrength('训练分析');
if (await page.locator('.strength-analysis-summary article').count() !== 4) throw new Error('训练分析摘要数量不是4。');
if (await page.locator('.strength-dashboard-grid.analysis .strength-chart-card').count() !== 4) throw new Error('训练分析四宫格不完整。');
await page.screenshot({ path: path.join(outputDirectory, '04训练分析.png'), fullPage: true });

await openStrength('体能评估');
if (await page.locator('.strength-assessment-cards article').count() !== 5) throw new Error('体能评估五类能力卡不完整。');
await page.screenshot({ path: path.join(outputDirectory, '05体能评估.png'), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
const mobileOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
if (mobileOverflow > 2) throw new Error(`移动端横向溢出：${mobileOverflow}px`);
await page.screenshot({ path: path.join(outputDirectory, '体能评估_移动端.png'), fullPage: true });

if (errors.length) throw new Error(`浏览器错误：${errors.join(' | ')}`);
console.log(JSON.stringify({ overviewCards: 5, overviewCharts: 4, planTabs: 5, firstMax, firstWeight, analysisCharts: 4, assessmentCards: 5, mobileOverflow, browserErrors: errors }, null, 2));
await browser.close();
