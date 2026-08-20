import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5173';
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

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDirectory}/training-login.png`, fullPage: true });
await page.getByRole('button', { name: '申请新账号' }).click();
await page.getByRole('heading', { name: '申请注册' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-register.png`, fullPage: true });
await page.getByRole('button', { name: /教练/ }).click();
await page.screenshot({ path: `${outputDirectory}/training-register-coach.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${outputDirectory}/training-register-mobile.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole('button', { name: /返回登录/ }).click();
await page.getByLabel('账号', { exact: true }).fill('coach01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outputDirectory}/training-overview.png`, fullPage: true });

await page.getByRole('button', { name: /训练日历/ }).click();
await page.getByRole('heading', { name: '训练日历' }).waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outputDirectory}/training-calendar.png`, fullPage: true });

await page.getByRole('button', { name: /个人档案/ }).click();
await page.getByRole('heading', { name: '个人训练档案' }).waitFor();
const athleteSelect = page.locator('.date-toolbar select');
const athleteOptions = athleteSelect.locator('option');
if (await athleteOptions.count() > 1) {
  const firstAthleteValue = await athleteOptions.nth(1).getAttribute('value');
  await athleteSelect.selectOption(firstAthleteValue);
}
await page.locator('.personal-identity-card').waitFor();
await page.locator('.strength-poster-web').waitFor();
await page.locator('.injury-recovery-module').waitFor();
await page.locator('.personal-calendar-section').waitFor();
await page.waitForTimeout(600);
const calendarRowBoxes = await page.locator('.calendar-week-row').evaluateAll((rows) => rows.map((row) => {
  const box = row.getBoundingClientRect();
  return { top: Math.round(box.top), height: Math.round(box.height), width: Math.round(box.width) };
}));
if (calendarRowBoxes.length !== 6 || new Set(calendarRowBoxes.map((row) => row.top)).size !== 6 || calendarRowBoxes.some((row) => row.height < 80)) {
  throw new Error(`个人训练日历周布局错误：${JSON.stringify(calendarRowBoxes)}`);
}
await page.getByRole('button', { name: '下个月', exact: true }).click();
await page.getByText('2026年 8月', { exact: true }).waitFor();
await page.getByRole('button', { name: '上个月', exact: true }).click();
await page.getByText('2026年 7月', { exact: true }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-personal.png`, fullPage: true });
await page.locator('.strength-module').screenshot({ path: `${outputDirectory}/training-strength-profile.png` });
await page.locator('.injury-recovery-module').screenshot({ path: `${outputDirectory}/personal-injury-recovery.png` });
await page.locator('.personal-calendar-section').screenshot({ path: `${outputDirectory}/personal-report-calendar.png` });

await page.getByRole('button', { name: '新增伤病记录', exact: true }).click();
await page.getByRole('heading', { name: '新增伤病与恢复记录', exact: true }).waitFor();
const coachRestrictionFields = await page.getByText('训练限制', { exact: true }).count();
if (!coachRestrictionFields) throw new Error('教练伤病记录表单缺少训练限制字段');
await page.screenshot({ path: `${outputDirectory}/personal-injury-editor.png`, fullPage: true });
await page.locator('.injury-dialog').getByRole('button', { name: '关闭', exact: true }).click();

await page.getByRole('button', { name: '更新测试', exact: true }).click();
await page.getByRole('heading', { name: /录入测试结果/ }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-strength-editor.png`, fullPage: true });
await page.locator('.strength-editor-modal').getByRole('button', { name: '关闭' }).click();

const strengthDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
await page.getByRole('button', { name: '导出力量档案', exact: true }).click();
const strengthDownload = await strengthDownloadPromise;
await strengthDownload.saveAs(`${outputDirectory}/personal-strength-profile.pdf`);

async function savePersonalPdf(buttonName, fileName) {
  const personalDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: buttonName, exact: true }).first().click();
  const personalDownload = await personalDownloadPromise;
  await personalDownload.saveAs(`${outputDirectory}/${fileName}`);
  return personalDownload.suggestedFilename();
}

const dailySummaryName = await savePersonalPdf('下载日总结', 'personal-daily-summary.pdf');
const dailyLogName = await savePersonalPdf('下载训练日志', 'personal-daily-log.pdf');
await page.locator('.calendar-week-rail').filter({ hasText: '课' }).first().click();
await page.getByRole('button', { name: '下载周训练总结', exact: true }).waitFor();
const weeklySummaryName = await savePersonalPdf('下载周训练总结', 'personal-weekly-summary.pdf');
const weeklyLogName = await savePersonalPdf('下载周日志', 'personal-weekly-log.pdf');
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.personal-calendar-section').scrollIntoViewIfNeeded();
await page.locator('.personal-calendar-section').screenshot({ path: `${outputDirectory}/personal-report-calendar-mobile.png` });
await page.setViewportSize({ width: 1440, height: 1000 });

await page.getByRole('button', { name: /周期报告/ }).click();
await page.getByRole('heading', { name: '周期报告', exact: true }).waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outputDirectory}/training-report.png`, fullPage: true });
const reportSourceText = (await page.locator('.report-source-banner').textContent()) || '';
const reportSchedulePages = await page.locator('.report-schedule-sheet').count();
const reportScheduleRows = await page.locator('.report-schedule-table tbody tr').count();
const reportHorizontalBars = await page.locator('.horizontal-bar-list > div').count();
if (!reportSourceText.includes('数据口径已锁定')) throw new Error('周期报告未显示日期数据口径');
if (!reportSchedulePages || !reportScheduleRows) throw new Error('周期报告未生成所选时段训练安排');
if (reportHorizontalBars < 2) throw new Error('周期报告训练分类柱状图缺失');

const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
await page.getByRole('button', { name: '导出PDF', exact: true }).click();
const download = await downloadPromise;
await download.saveAs(`${outputDirectory}/training-period-report.pdf`);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDirectory}/training-mobile.png`, fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
await page.evaluate(() => localStorage.clear());
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('admin01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.waitForTimeout(500);
const adminNameEditButtons = await page.locator('.name-edit-trigger').count();
const editableAthleteRow = page.locator('.roster-preview tbody tr').first();
const originalAthleteName = (await editableAthleteRow.locator('.editable-name-value').first().textContent())?.trim();
if (!originalAthleteName) throw new Error('未找到可编辑的运动员姓名');
await editableAthleteRow.locator('.name-edit-trigger').first().click();
await page.getByRole('heading', { name: '修改运动员姓名' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-name-editor.png`, fullPage: true });
const temporaryAthleteName = `${originalAthleteName}测`;
await page.locator('.name-editor-modal input').fill(temporaryAthleteName);
await page.locator('.name-editor-modal').getByRole('button', { name: '保存姓名' }).click();
await page.locator('.name-editor-modal').waitFor({ state: 'detached' });
if (!(await editableAthleteRow.textContent()).includes(temporaryAthleteName)) throw new Error('界面改名后未更新运动员姓名');
await editableAthleteRow.locator('.name-edit-trigger').first().click();
await page.locator('.name-editor-modal input').fill(originalAthleteName);
await page.locator('.name-editor-modal').getByRole('button', { name: '保存姓名' }).click();
await page.locator('.name-editor-modal').waitFor({ state: 'detached' });
if (!(await editableAthleteRow.textContent()).includes(originalAthleteName)) throw new Error('运动员姓名恢复失败');
await page.getByRole('button', { name: '账户审核' }).click();
await page.getByRole('heading', { name: '账户审核' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-account-review.png`, fullPage: true });

await page.getByRole('button', { name: '账号权限' }).click();
await page.getByRole('heading', { name: '账号权限' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-account-access.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${outputDirectory}/training-account-access-mobile.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });

await page.evaluate(() => localStorage.clear());
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('regional01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.waitForTimeout(800);
const regionalAthleteRows = await page.locator('.roster-preview tbody tr').count();
const regionalHasImport = await page.getByRole('button', { name: 'AI识别导入' }).count();
const regionalOwnNameEdit = await page.locator('.sidebar-footer .name-edit-trigger').count();
await page.screenshot({ path: `${outputDirectory}/training-regional-overview.png`, fullPage: true });

console.log(JSON.stringify({
  title: await page.title(),
  pdfSuggestedName: download.suggestedFilename(),
  weeklySummaryName,
  weeklyLogName,
  dailySummaryName,
  dailyLogName,
  strengthProfileName: strengthDownload.suggestedFilename(),
  reportSchedulePages,
  reportScheduleRows,
  reportHorizontalBars,
  adminNameEditButtons,
  regionalAthleteRows,
  regionalHasImport,
  regionalOwnNameEdit,
  browserErrors: errors
}, null, 2));

await browser.close();
