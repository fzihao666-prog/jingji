import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts-ai-import';
const workbookPath = process.argv[3];
const baseUrl = process.argv[4] || 'http://127.0.0.1:5173';

if (!workbookPath) throw new Error('请提供要检查的工作簿路径');
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];

page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('账号', { exact: true }).fill('coach01');
  await page.getByLabel('密码', { exact: true }).fill('demo123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '训练总览' }).waitFor();
  await page.getByRole('button', { name: /AI识别导入/ }).click();
  await page.getByRole('heading', { name: '导入训练文件', exact: true }).waitFor();
  await page.screenshot({ path: `${outputDirectory}/ai-import-intake.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDirectory}/ai-import-intake-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);

  await page.locator('input[type="file"]').setInputFiles(workbookPath);
  await page.getByText('文件结构已读取', { exact: true }).waitFor({ timeout: 60_000 });
  const sectionCards = page.locator('.ai-section-grid > button');
  const sectionCount = await sectionCards.count();
  if (sectionCount !== 37) throw new Error(`工作表目录数量错误：预期37，实际${sectionCount}`);
  await page.getByText(/当前将分成约37个 AI 批次/).waitFor();
  await page.screenshot({ path: `${outputDirectory}/ai-import-37-sheets.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDirectory}/ai-import-37-sheets-mobile.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '体能训练', exact: true }).click();
  await page.getByRole('heading', { name: '体能训练', exact: true }).waitFor();
  const athleteSelect = page.locator('.plan-athlete-select select');
  const athleteOptions = await athleteSelect.locator('option').evaluateAll((options) => options.map((option) => ({
    value: option.value,
    label: option.textContent || ''
  })));
  const linZhou = athleteOptions.find((option) => option.label.includes('林舟'));
  if (!linZhou) throw new Error('体能训练页未找到林舟');
  await athleteSelect.selectOption(linZhou.value);
  const historySelect = page.locator('.plan-history-select select');
  await historySelect.waitFor();
  const historyOptions = await historySelect.locator('option').evaluateAll((options) => options.map((option) => ({
    value: option.value,
    label: option.textContent || ''
  })));
  const importedPlan = historyOptions.find((option) => option.label.includes('国家赛艇周计划表'));
  if (!importedPlan) throw new Error('体能训练历史中未找到刚导入的国家赛艇周计划表');
  await historySelect.selectOption(importedPlan.value);
  const openedTitle = await page.locator('.plan-meta-title input').inputValue();
  if (openedTitle !== '国家赛艇周计划表') throw new Error(`打开的计划标题不正确：${openedTitle}`);
  await page.screenshot({ path: `${outputDirectory}/ai-import-saved-plan.png`, fullPage: true });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ sectionCount, importedPlanId: Number(importedPlan.value), openedTitle, screenshots: 5, errors }, null, 2));
} finally {
  await browser.close();
}
