import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = 'D:/CodexWork/reference-athlete-management';
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto('http://43.139.215.241:7401/#/coachProfile', { waitUntil: 'networkidle', timeout: 60000 });
await page.screenshot({ path: `${outputDirectory}/login-or-page.png`, fullPage: true });
await page.getByPlaceholder('请输入账号').fill('admin');
await page.getByPlaceholder('请输入密码').fill('admin123');
await page.getByRole('button', { name: '登录系统', exact: true }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${outputDirectory}/after-login.png`, fullPage: true });
await page.getByText('运动员管理', { exact: true }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outputDirectory}/athlete-management.png`, fullPage: true });
console.log(JSON.stringify({
  title: await page.title(),
  url: page.url(),
  text: (await page.locator('body').innerText()).slice(0, 6000),
  inputs: await page.locator('input').evaluateAll((items) => items.map((item) => ({ type: item.type, placeholder: item.placeholder, value: item.value, name: item.name }))),
  buttons: await page.locator('button').evaluateAll((items) => items.map((item) => item.innerText.trim()).filter(Boolean)),
  selects: await page.locator('select').evaluateAll((items) => items.map((item) => ({ value: item.value, options: [...item.options].map((option) => option.text) }))),
  links: await page.locator('a').evaluateAll((items) => items.map((item) => ({ text: item.innerText.trim(), href: item.getAttribute('href') })).filter((item) => item.text))
}, null, 2));
await browser.close();
