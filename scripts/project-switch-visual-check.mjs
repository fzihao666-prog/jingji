import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'outputs/project-isolation-20260731';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
if (await page.getByLabel('账号', { exact: true }).count()) {
  await page.getByLabel('账号', { exact: true }).fill('admin01');
  await page.getByLabel('密码', { exact: true }).fill('demo123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.locator('.project-filter select').selectOption('赛艇');
await page.waitForTimeout(500);
await page.locator('.athlete-picker-trigger').click();
const rowingOptions = await page.locator('.athlete-picker-options button').allTextContents();
await page.locator('.athlete-search-box input').fill('四川');
const rowingSearchResults = await page.locator('.athlete-picker-options button').allTextContents();
await page.screenshot({ path: `${output}/rowing-search.png`, fullPage: true });
await page.keyboard.press('Escape');

await page.locator('.project-filter select').selectOption('皮划艇');
await page.waitForTimeout(500);
await page.locator('.athlete-picker-trigger').click();
const canoeOptions = await page.locator('.athlete-picker-options button').allTextContents();
await page.locator('.athlete-search-box input').fill('广东');
const canoeSearchResults = await page.locator('.athlete-picker-options button').allTextContents();
await page.screenshot({ path: `${output}/canoe-search.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.project-filter select').selectOption('皮划艇');
await page.locator('.athlete-picker-trigger').click();
await page.locator('.athlete-search-box input').fill('广东');
await page.screenshot({ path: `${output}/canoe-search-mobile.png`, fullPage: true });

if (!rowingOptions.length || !canoeOptions.length) throw new Error('project athlete selectors are empty');
if (rowingSearchResults.length !== 3 || canoeSearchResults.length !== 3) throw new Error('athlete search did not filter by region');
const sameNamedOptions = rowingOptions.filter((name) => name && !name.startsWith('全部') && canoeOptions.includes(name));
if (sameNamedOptions.length) throw new Error(`athlete options leaked between projects: ${sameNamedOptions.join(',')}`);
if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
console.log(JSON.stringify({ rowingOptions, rowingSearchResults, canoeOptions, canoeSearchResults, screenshots: 3, status: 'passed' }, null, 2));
await browser.close();
