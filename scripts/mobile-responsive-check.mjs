import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5173';
const output = process.argv[3] || 'outputs/mobile-responsive';
await mkdir(output, { recursive: true });

const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
];

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

async function assertViewport(page, name, allowSelectors = []) {
  await page.waitForTimeout(450);
  const state = await page.evaluate((allowed) => {
    const rootOverflow = document.documentElement.scrollWidth - window.innerWidth;
    const bodyOverflow = document.body.scrollWidth - window.innerWidth;
    const allowedState = allowed.map((selector) => {
      const element = document.querySelector(selector);
      return element
        ? { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
        : { selector, missing: true };
    });
    return { rootOverflow, bodyOverflow, width: window.innerWidth, allowedState };
  }, allowSelectors);
  if (state.rootOverflow > 2 || state.bodyOverflow > 2)
    throw new Error(`${name}整页横向溢出: ${JSON.stringify(state)}`);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  return { name, ...state };
}

async function go(page, label) {
  // ≤860 时导航收进抽屉，需先点开；宽视口侧栏常驻
  const menuButton = page.locator('.mobile-header .icon-button');
  if ((await menuButton.count()) && (await menuButton.isVisible())) await menuButton.click();
  await page.locator('.primary-nav button').filter({ hasText: label }).click();
  await page.waitForTimeout(400);
}

const allResults = [];
for (const viewport of viewports) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (await page.locator('input[type="password"]').count()) {
    const textInputs = page.locator('input');
    await textInputs.nth(0).fill('admin01');
    await page.locator('input[type="password"]').fill('demo123');
    await page.locator('.login-button').click();
  }
  await page.locator('.primary-nav').waitFor();

  const results = [];
  results.push(await assertViewport(page, `${viewport.name}-01-overview`));
  await go(page, '运动员表现');
  await page.locator('.athlete-picker-trigger').click();
  const personalOptions = page.locator('.athlete-picker-options button');
  if ((await personalOptions.count()) > 1) await personalOptions.nth(1).click();
  await page.locator('.personal-identity-card').waitFor();
  results.push(await assertViewport(page, `${viewport.name}-02-personal`));
  if (await page.locator('.model-standard-card, .personal-calendar-section').count()) {
    throw new Error('运动员表现仍显示已删除模块');
  }
  await go(page, '体能训练');
  await page.locator('.strength-command-bar').waitFor();
  results.push(
    await assertViewport(page, `${viewport.name}-03-training-plan`, [
      '.strength-comparison-table',
      '.strength-result-table',
    ])
  );
  await go(page, '专项训练');
  results.push(await assertViewport(page, `${viewport.name}-04-special-tests`, ['.ranking-table-wrap']));

  if (browserErrors.length) throw new Error(`浏览器错误: ${browserErrors.join(' | ')}`);
  allResults.push({ viewport: viewport.name, pages: results });
  await page.close();
}

console.log(JSON.stringify({ status: 'passed', viewports: allResults }, null, 2));
await browser.close();
