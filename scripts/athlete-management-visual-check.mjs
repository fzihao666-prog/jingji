import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts/athlete-management';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5174';
mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('admin01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录系统', exact: true }).click();
await page.getByRole('button', { name: '运动员管理', exact: true }).click();
await page.getByRole('heading', { name: '运动员管理', exact: true }).waitFor();
await page.locator('.athlete-directory-table tbody tr').first().waitFor();
const rows = await page.locator('.athlete-directory-table tbody tr').count();
if (rows < 1 || rows > 6) throw new Error(`每页运动员数量错误：${rows}`);
await page.screenshot({ path: `${outputDirectory}/athlete-management.png`, fullPage: true });

await page.getByRole('button', { name: '高级筛选', exact: true }).click();
await page.getByRole('heading', { name: '高级筛选', exact: true }).waitFor();
await page.screenshot({ path: `${outputDirectory}/athlete-advanced-filter.png`, fullPage: true });
await page.getByRole('button', { name: '关闭', exact: true }).click();

await page.getByRole('button', { name: '新增运动员', exact: true }).click();
await page.getByRole('heading', { name: '新增运动员', exact: true }).waitFor();
for (const label of ['姓名', '运动项目', '所属队伍', '身体状态', '技术等级', '训练场地', '登录账号', '初始密码']) {
  if (!await page.getByText(new RegExp(`^${label}`)).count()) throw new Error(`新增表单缺少字段：${label}`);
}
await page.screenshot({ path: `${outputDirectory}/athlete-editor.png`, fullPage: true });
await page.getByRole('button', { name: '关闭', exact: true }).click();

await page.locator('.athlete-row-actions').first().getByRole('button', { name: '伤病', exact: true }).click();
await page.getByRole('heading', { name: /伤病记录/ }).waitFor();
await page.screenshot({ path: `${outputDirectory}/athlete-injury.png`, fullPage: true });
await page.getByRole('button', { name: '关闭', exact: true }).click();

await page.getByRole('button', { name: /选择/ }).nth(1).click();
await page.getByRole('button', { name: '批量修改', exact: true }).click();
await page.getByRole('heading', { name: /批量修改/ }).waitFor();
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.locator('.athlete-row-actions').first().getByRole('button', { name: '档案', exact: true }).click();
await page.getByRole('heading', { name: '个人档案', exact: true }).waitFor();
await page.getByRole('button', { name: '运动员管理', exact: true }).click();
await page.getByRole('heading', { name: '运动员管理', exact: true }).waitFor();

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: '关闭菜单', exact: true }).evaluate((button) => button.click());
await page.waitForTimeout(300);
await page.screenshot({ path: `${outputDirectory}/athlete-management-mobile.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
if (overflow) throw new Error('运动员管理移动端出现页面级横向溢出');

await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
console.log(JSON.stringify({ rows, screenshots: outputDirectory, status: 'passed' }, null, 2));
