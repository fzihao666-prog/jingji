import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const outputDirectory = path.resolve(process.argv[2] || 'outputs/training-plan-module');
const baseUrl = process.argv[3] || 'http://127.0.0.1:8787';
await fs.mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('coach01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.getByRole('button', { name: /训练计划/ }).click();
await page.getByRole('heading', { name: '训练计划', exact: true }).waitFor();
await page.locator('.plan-matrix').waitFor();

await page.getByRole('button', { name: /识别已有计划/ }).click();
await page.getByRole('heading', { name: /把已有计划录入给/ }).waitFor();
const initialImportTargets = await page.locator('.import-roster-list > button.selected').count();
await page.locator('.import-roster-list > button').nth(1).click();
const multiImportTargets = await page.locator('.import-roster-list > button.selected').count();
const dynamicScheduleCopy = await page.getByText('训练日按文件实际内容识别并可修改；同一份确认后的计划可以一次导入多人。', { exact: true }).count();
if (initialImportTargets !== 1 || multiImportTargets !== 2 || dynamicScheduleCopy !== 1) {
  throw new Error(`AI多人导入初始化错误：initial=${initialImportTargets}, selected=${multiImportTargets}, schedule=${dynamicScheduleCopy}`);
}
await page.screenshot({ path: path.join(outputDirectory, 'AI识别多人计划导入.png'), fullPage: true });

const firstMax = await page.locator('.max-cell input').first().inputValue();
const firstPercentage = await page.getByLabel('第1周百分比').first().inputValue();
const firstWeight = (await page.locator('.weight-cell').first().textContent())?.trim();
const startDate = await page.getByLabel('开始日期').inputValue();
const endDate = await page.getByLabel('结束日期').inputValue();
const coachDeleteButtons = await page.getByRole('button', { name: '删除历史', exact: true }).count();
const radarStage = page.locator('.radar-stage');
const initialRadarRatios = JSON.parse(await radarStage.getAttribute('data-ratio-array'));
const firstWeekActualInputs = page.getByLabel('第1周实际完成次数');
for (const [index, value] of ['8', '8', '6', '4', '3', '8', '8', '6', '4', '8', '12', '7', '7', '15', '15'].entries()) {
  await firstWeekActualInputs.nth(index).fill(value);
}
const actualCompletedEditable = (await firstWeekActualInputs.first().inputValue()) === '8';
const radarSlotCount = Number(await radarStage.getAttribute('data-slot-count'));
const radarProjects = JSON.parse(await radarStage.getAttribute('data-project-array'));
const radarRatios = JSON.parse(await radarStage.getAttribute('data-ratio-array'));
const expectedRadarProjectCount = await page.locator('.exercise-cell textarea').evaluateAll((items) => items.filter((item) => item.value.trim()).length);
const radarAnatomyCount = await page.locator('.radar-body-figure').count();
const oldSummaryFields = await page.getByText(/^(卧拉 kg|卧推 kg|深蹲 kg|3000米|总时 min|薄弱项)$/).count();
const projectExtraFields = await page.locator('.exercise-cell > input, .exercise-cell .exercise-volume-fields').count();
const plannedRadarSeries = await page.locator('.recharts-radar-polygon').count();
const orderedRatios = radarRatios.every((value, index) => index === 0 || radarRatios[index - 1] >= value);
if (firstMax !== '65' || firstPercentage !== '70' || firstWeight !== '45.5 kg') {
  throw new Error(`重量联动显示错误：MAX=${firstMax}, %= ${firstPercentage}, weight=${firstWeight}`);
}
if (startDate !== '2026-07-28' || endDate !== '2026-08-27' || coachDeleteButtons !== 1) {
  throw new Error(`月度日期或历史删除入口错误：${startDate}—${endDate}, delete=${coachDeleteButtons}`);
}
if (
  radarSlotCount !== expectedRadarProjectCount
  || radarProjects.length !== expectedRadarProjectCount
  || radarProjects.some((project) => !project)
  || radarProjects.length > 8
  || radarRatios.length !== radarProjects.length
  || radarAnatomyCount !== 1
  || oldSummaryFields !== 0
  || projectExtraFields !== 0
  || plannedRadarSeries !== 1
  || !orderedRatios
  || radarRatios.some((value) => value < 0 || value > 100)
  || JSON.stringify(initialRadarRatios) === JSON.stringify(radarRatios)
  || !radarRatios.some((value) => value > 0)
) {
  throw new Error(`雷达数组或人体图错误：slots=${radarSlotCount}, projects=${JSON.stringify(radarProjects)}, anatomy=${radarAnatomyCount}, old=${oldSummaryFields}, series=${plannedRadarSeries}, ordered=${orderedRatios}`);
}
await page.locator('.plan-matrix-scroll').evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: path.join(outputDirectory, '训练计划页面_桌面端.png'), fullPage: true });
await page.locator('.plan-matrix-shell').screenshot({ path: path.join(outputDirectory, '训练计划四周矩阵.png') });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outputDirectory, '训练计划页面_移动端.png'), fullPage: true });

await page.evaluate(() => localStorage.clear());
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('athlete01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.getByRole('button', { name: /训练计划/ }).click();
await page.getByRole('heading', { name: '训练计划', exact: true }).waitFor();
await page.locator('.plan-matrix').waitFor();
const athleteEditableInputs = await page.locator('.plan-matrix input:not([disabled]), .plan-matrix textarea:not([disabled])').count();
const athleteSaveButtons = await page.getByRole('button', { name: '保存计划', exact: true }).count();
const athleteDeleteButtons = await page.getByRole('button', { name: '删除历史', exact: true }).count();
if (athleteEditableInputs !== 0 || athleteSaveButtons !== 0 || athleteDeleteButtons !== 0) throw new Error('运动员端仍可编辑或删除训练计划。');
await page.screenshot({ path: path.join(outputDirectory, '训练计划页面_运动员只读.png'), fullPage: true });

console.log(JSON.stringify({
  firstMax,
  firstPercentage,
  firstWeight,
  startDate,
  endDate,
  coachDeleteButtons,
  initialImportTargets,
  multiImportTargets,
  dynamicScheduleCopy,
  actualCompletedEditable,
  initialRadarRatios,
  radarSlotCount,
  expectedRadarProjectCount,
  radarProjects,
  radarRatios,
  radarAnatomyCount,
  oldSummaryFields,
  projectExtraFields,
  radarSeriesCount: plannedRadarSeries,
  orderedRatios,
  athleteEditableInputs,
  athleteSaveButtons,
  athleteDeleteButtons,
  browserErrors: errors
}, null, 2));
await browser.close();
