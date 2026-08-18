import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5173';
const output = process.argv[3] || 'outputs/mobile-responsive';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });

await page.goto(baseUrl, { waitUntil: 'networkidle' });
if (await page.locator('input[type="password"]').count()) {
  const textInputs = page.locator('input');
  await textInputs.nth(0).fill('admin01');
  await page.locator('input[type="password"]').fill('demo123');
  await page.locator('.login-button').click();
}
await page.locator('.mobile-header').waitFor();

const results = [];
async function assertViewport(name, allowSelectors = []) {
  await page.waitForTimeout(450);
  const state = await page.evaluate((allowed) => {
    const rootOverflow = document.documentElement.scrollWidth - window.innerWidth;
    const bodyOverflow = document.body.scrollWidth - window.innerWidth;
    const allowedState = allowed.map((selector) => {
      const element = document.querySelector(selector);
      return element ? { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth } : { selector, missing: true };
    });
    return { rootOverflow, bodyOverflow, width: window.innerWidth, allowedState };
  }, allowSelectors);
  if (state.rootOverflow > 2 || state.bodyOverflow > 2) throw new Error(`${name}整页横向溢出: ${JSON.stringify(state)}`);
  results.push({ name, ...state });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}

async function go(label) {
  await page.locator('.mobile-header .icon-button').click();
  await page.locator('.primary-nav button').filter({ hasText: label }).click();
  await page.waitForTimeout(400);
}

await assertViewport('01-overview');
await go('训练日历');
await assertViewport('02-calendar');
await go('个人档案');
await page.locator('.athlete-picker-trigger').click();
const personalOptions = page.locator('.athlete-picker-options button');
if (await personalOptions.count() > 1) await personalOptions.nth(1).click();
await page.locator('.personal-identity-card').waitFor();
await assertViewport('03-personal');
await page.locator('.personal-calendar-section').scrollIntoViewIfNeeded();
await page.locator('.personal-calendar-section').screenshot({ path: `${output}/03b-personal-calendar.png` });
await go('训练计划');
await page.locator('.plan-overview-grid').waitFor();
await assertViewport('04-training-plan', ['.plan-matrix-scroll']);
await go('周期报告');
await page.locator('.report-sheet').first().waitFor();
await assertViewport('05-report');
await go('专项测试');
await assertViewport('06-special-tests', ['.ranking-table-wrap']);

if (browserErrors.length) throw new Error(`浏览器错误: ${browserErrors.join(' | ')}`);
console.log(JSON.stringify({ status: 'passed', viewport: '390x844', pages: results }, null, 2));
await browser.close();
