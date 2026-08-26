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

// 仅用于视觉回归，不写入数据库；同日两场用于验证横轴不会合并场次。
await page.route('**/api/strength-training/results?*', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ sessions: [
    { id: 9101, trainingDate: '2026-08-03', sessionOrder: 1, sessionLabel: '上午力量', rpe: 7.4, volume: 3850, source: 'file_import', sourceFilename: '训练结果.xlsx', modelUsed: '', importedAt: '2026-08-03T10:00:00Z', sets: [
      { id: 9201, exerciseName: '卧拉', setIndex: 1, targetReps: 8, actualReps: 8, actualWeightKg: 45.5, rpe: 7, completed: true, note: '', importBatchId: 'visual', confidence: 1 },
      { id: 9202, exerciseName: '卧推', setIndex: 1, targetReps: 8, actualReps: 7, actualWeightKg: 38.5, rpe: 8, completed: false, note: '', importBatchId: 'visual', confidence: 1 }
    ] },
    { id: 9102, trainingDate: '2026-08-03', sessionOrder: 2, sessionLabel: '下午辅助', rpe: null, volume: 2280, source: 'ai_import', sourceFilename: '训练记录.jpg', modelUsed: 'qwen', importedAt: '2026-08-03T18:00:00Z', sets: [
      { id: 9203, exerciseName: '坐姿上举', setIndex: 1, targetReps: 10, actualReps: 10, actualWeightKg: 28, rpe: null, completed: true, note: '', importBatchId: 'visual', confidence: .94 }
    ] },
    { id: 9103, trainingDate: '2026-08-10', sessionOrder: 1, sessionLabel: '力量训练', rpe: 8.3, volume: 4620, source: 'file_import', sourceFilename: '训练结果.xlsx', modelUsed: '', importedAt: '2026-08-10T10:00:00Z', sets: [
      { id: 9204, exerciseName: '卧拉', setIndex: 1, targetReps: 6, actualReps: 6, actualWeightKg: 52, rpe: 8.3, completed: true, note: '', importBatchId: 'visual', confidence: 1 }
    ] }
  ] })
}));

async function login(username) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('demo123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '训练总览' }).waitFor();
  await page.getByRole('button', { name: /体能训练/ }).click();
  await page.locator('.strength-command-bar').waitFor();
}

await login('coach01');
if (await page.getByRole('button', { name: '训练日历', exact: true }).count()) throw new Error('训练日历仍在导航中。');
await page.getByRole('button', { name: /计划编排/ }).click();
await page.locator('.plan-matrix').waitFor();
const firstMax = await page.locator('.max-cell input').first().inputValue();
const firstPercentage = await page.getByLabel('第1周百分比').first().inputValue();
const firstWeight = (await page.locator('.weight-cell').first().textContent())?.trim();
const startDate = await page.getByText('开始日期', { exact: true }).locator('..').locator('input').inputValue();
const endDate = await page.getByText('结束日期', { exact: true }).locator('..').locator('input').inputValue();
const weekBands = await page.locator('.plan-matrix .week-band').count();
const completedInputs = await page.locator('.plan-matrix .actual-cell input:not([disabled])').count();
const aiButtons = await page.getByRole('button', { name: 'AI生成计划', exact: true }).count();
const importButtons = await page.getByRole('button', { name: '导入训练结果', exact: true }).count();
if (firstMax !== '65' || firstPercentage !== '70' || firstWeight !== '45.5 kg') throw new Error(`重量联动错误：${firstMax}/${firstPercentage}/${firstWeight}`);
if (startDate !== '2026-07-28' || endDate !== '2026-08-27' || weekBands < 4 || completedInputs < 1 || aiButtons !== 1 || importButtons !== 1) throw new Error('周期、四周矩阵、完成次数或核心入口不完整。');
await page.locator('.strength-view-tabs button').filter({ hasText: '训练结果' }).click();
const resultsImportButtons = await page.getByRole('button', { name: /导入/ }).count();
const resultVisuals = await page.locator('.strength-load-visual').count();
const personalPhotoActions = await page.getByText(/上传照片|更换照片|上传证件照/).count();
if (resultsImportButtons !== 1) throw new Error(`训练结果页存在${resultsImportButtons}个导入入口，应只保留顶部1个。`);
if (resultVisuals !== 1) throw new Error(`训练结果页存在${resultVisuals}个可视化，应只保留训练负荷趋势图。`);
if (personalPhotoActions !== 0) throw new Error('体能训练页仍包含个人证件照操作。');
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(outputDirectory, '体能训练结果_单一导入口.png'), fullPage: true });
await page.locator('.strength-view-tabs button').filter({ hasText: '计划编排' }).click();
await page.locator('.plan-matrix').waitFor();
await page.screenshot({ path: path.join(outputDirectory, '体能训练页面_桌面端.png'), fullPage: true });
await page.locator('.plan-matrix-shell').screenshot({ path: path.join(outputDirectory, '体能训练周编排.png') });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
const mobileOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
if (mobileOverflow > 2) throw new Error(`移动端横向溢出：${mobileOverflow}px`);
await page.screenshot({ path: path.join(outputDirectory, '体能训练页面_移动端.png'), fullPage: true });
await page.locator('.strength-view-tabs button').filter({ hasText: '训练结果' }).click();
await page.locator('.strength-load-visual').waitFor();
await page.waitForTimeout(250);
const mobileResultsOverflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
if (mobileResultsOverflow > 2) throw new Error(`训练结果移动端横向溢出：${mobileResultsOverflow}px`);
await page.screenshot({ path: path.join(outputDirectory, '体能训练结果_移动端.png'), fullPage: true });

await page.evaluate(() => localStorage.clear());
await page.setViewportSize({ width: 1440, height: 900 });
await login('athlete01');
await page.getByRole('button', { name: /计划编排/ }).click();
await page.locator('.plan-matrix').waitFor();
const athleteEditableInputs = await page.locator('.strength-plan-meta input:not([disabled]), .plan-matrix input:not([disabled]), .plan-matrix textarea:not([disabled])').count();
const athleteSaveButtons = await page.getByRole('button', { name: '保存更改', exact: true }).count();
const athleteImportButtons = await page.getByRole('button', { name: /导入训练结果|导入结果/ }).count();
if (athleteEditableInputs !== 0 || athleteSaveButtons !== 0 || athleteImportButtons !== 0) throw new Error('运动员端仍可编辑或导入体能训练。');
await page.screenshot({ path: path.join(outputDirectory, '体能训练页面_运动员只读.png'), fullPage: true });

if (errors.length) throw new Error(`浏览器错误：${errors.join(' | ')}`);
console.log(JSON.stringify({ firstMax, firstPercentage, firstWeight, startDate, endDate, weekBands, completedInputs, aiButtons, importButtons, resultsImportButtons, resultVisuals, personalPhotoActions, mobileOverflow, mobileResultsOverflow, athleteEditableInputs, athleteSaveButtons, athleteImportButtons, browserErrors: errors }, null, 2));
await browser.close();
