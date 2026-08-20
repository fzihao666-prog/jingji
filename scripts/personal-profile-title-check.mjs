import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts-personal-profile-title';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5173';
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
  await page.getByLabel('账号', { exact: true }).fill('admin01');
  await page.getByLabel('密码', { exact: true }).fill('demo123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '训练总览', exact: true }).waitFor();
  await page.getByRole('button', { name: '个人档案', exact: true }).click();
  await page.getByRole('heading', { name: '个人档案', exact: true }).waitFor();

  await page.locator('.athlete-picker-trigger').click();
  const athleteOption = page.locator('.athlete-picker-options > button').filter({ hasText: '林舟' }).first();
  await athleteOption.waitFor();
  await athleteOption.click();
  await page.locator('.strength-module').waitFor();
  await page.locator('.strength-poster-web').waitFor();

  const moduleTitle = (await page.locator('.strength-module-title strong').textContent())?.trim();
  const posterTitle = (await page.locator('.strength-poster-web h2').textContent())?.trim();
  const exportLabel = (await page.locator('.strength-module-actions .primary-button').textContent())?.trim();
  if (moduleTitle !== '个人档案') throw new Error(`网页模块标题错误：${moduleTitle}`);
  if (posterTitle !== '个人档案') throw new Error(`档案标题错误：${posterTitle}`);
  if (exportLabel !== '导出个人档案') throw new Error(`导出按钮标题错误：${exportLabel}`);
  if (errors.length) throw new Error(errors.join('\n'));

  await page.locator('.strength-module').screenshot({ path: `${outputDirectory}/个人档案.png` });
  console.log(JSON.stringify({ moduleTitle, posterTitle, exportLabel, errors }, null, 2));
} finally {
  await browser.close();
}
