import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = 'D:/CodexWork/reference-athlete-management';
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const audit = {};

async function snapshot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${outputDirectory}/${name}.png`, fullPage: true });
  audit[name] = {
    url: page.url(),
    text: (await page.locator('body').innerText()).slice(0, 10000),
    dialogs: await page.locator('[role="dialog"]:visible,.el-dialog:visible').evaluateAll((items) => items.map((item) => item.innerText.trim())),
    inputs: await page.locator('input:visible,textarea:visible').evaluateAll((items) => items.map((item) => ({ tag: item.tagName, type: item.type, placeholder: item.placeholder, value: item.value }))),
    buttons: await page.locator('button:visible').evaluateAll((items) => items.map((item) => item.innerText.trim()).filter(Boolean))
  };
}

async function loginAndOpenAthletes() {
  await page.goto('http://43.139.215.241:7401/#/login', { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByPlaceholder('请输入账号').fill('admin');
  await page.getByPlaceholder('请输入密码').fill('admin123');
  await page.getByRole('button', { name: '登录系统', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByText('运动员管理', { exact: true }).first().click();
  await page.waitForTimeout(1000);
}

await loginAndOpenAthletes();
await page.getByRole('button', { name: '高级筛选', exact: true }).click();
await snapshot('advanced-filter');
const advancedDialog = page.locator('[role="dialog"]:visible,.el-dialog:visible').last();
await advancedDialog.getByRole('button', { name: '取消', exact: true }).click();

await page.getByRole('button', { name: '新增', exact: true }).click();
await snapshot('create-athlete-dialog');
const createDialog = page.locator('[role="dialog"]:visible,.el-dialog:visible').last();
const createCancel = createDialog.getByRole('button', { name: /取消|关闭/ }).last();
if (await createCancel.count()) await createCancel.click(); else await page.keyboard.press('Escape');

const rowCheckboxes = page.locator('.el-table__body-wrapper .el-checkbox__inner');
if (await rowCheckboxes.count()) await rowCheckboxes.first().click();
await page.getByRole('button', { name: '修改', exact: true }).click();
await snapshot('edit-athlete-dialog');
const editDialog = page.locator('[role="dialog"]:visible,.el-dialog:visible').last();
const editCancel = editDialog.getByRole('button', { name: /取消|关闭/ }).last();
if (await editCancel.count()) await editCancel.click(); else await page.keyboard.press('Escape');

await page.getByRole('button', { name: '档案', exact: true }).first().click();
await page.waitForTimeout(2500);
await snapshot('athlete-profile');

const profileDialog = page.locator('[role="dialog"]:visible,.el-dialog:visible').last();
if (await profileDialog.count()) {
  const profileClose = profileDialog.locator('.el-dialog__headerbtn,.el-drawer__close-btn').first();
  if (await profileClose.count()) await profileClose.click(); else await page.keyboard.press('Escape');
} else {
  await page.keyboard.press('Escape');
}
await page.waitForTimeout(600);
await page.getByRole('button', { name: '伤病', exact: true }).first().click();
await snapshot('athlete-injury');
if (await page.locator('[role="dialog"]:visible,.el-dialog:visible').count()) {
  const injuryDialog = page.locator('[role="dialog"]:visible,.el-dialog:visible').last();
  const injuryCancel = injuryDialog.getByRole('button', { name: /取消|关闭/ }).last();
  if (await injuryCancel.count()) await injuryCancel.click(); else await page.keyboard.press('Escape');
}

await page.locator('.el-table__body-wrapper').getByRole('button', { name: '删除', exact: true }).first().click();
await snapshot('delete-athlete-confirm');
const cancelDelete = page.getByRole('button', { name: /取消/, exact: true }).last();
if (await cancelDelete.count()) await cancelDelete.click(); else await page.keyboard.press('Escape');

console.log(JSON.stringify(audit, null, 2));
await browser.close();
