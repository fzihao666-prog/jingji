import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts-personal-profile-title';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5173';
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});

async function login(page, username) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('demo123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: /训练总览/ }).waitFor();
}

async function openPersonalArchive(page) {
  await page.getByRole('button', { name: '个人档案', exact: true }).click();
  await page.getByRole('heading', { name: '个人档案', exact: true }).waitFor();
  const picker = page.locator('.athlete-picker-trigger');
  if (await picker.count()) {
    await picker.click();
    const athleteOption = page.locator('.athlete-picker-options > button').filter({ hasText: '林舟' }).first();
    if (await athleteOption.count()) await athleteOption.click();
  }
  await page.locator('.strength-module').waitFor();
  await page.locator('.strength-poster-web').waitFor();
}

try {
  const coachPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const coachErrors = [];
  coachPage.on('pageerror', (error) => coachErrors.push(`pageerror: ${error.message}`));
  coachPage.on('console', (message) => { if (message.type() === 'error') coachErrors.push(`console: ${message.text()}`); });

  await login(coachPage, 'coach01');
  await openPersonalArchive(coachPage);

  const moduleTitle = (await coachPage.locator('.strength-module-title strong').textContent())?.trim();
  const posterTitle = (await coachPage.locator('.strength-poster-web h2').textContent())?.trim();
  const archiveRows = await coachPage.locator('.archive-score-table tbody tr').count();
  const radarCount = await coachPage.locator('.archive-radar').count();
  const legacyBodyMap = await coachPage.locator('.strength-body-map').count();
  const importButtons = await coachPage.getByRole('button', { name: /导入数据|下载导入模板/ }).count();
  const newButtons = await coachPage.getByRole('button', { name: '录入新测试', exact: true }).count();
  const editButtons = await coachPage.getByRole('button', { name: '编辑本次数据', exact: true }).count();
  if (moduleTitle !== '个人档案' || !posterTitle?.includes('个人档案信息表')) throw new Error(`档案标题错误：${moduleTitle} / ${posterTitle}`);
  if (archiveRows !== 8 || radarCount !== 1 || legacyBodyMap !== 0) throw new Error(`档案结构错误：rows=${archiveRows}, radar=${radarCount}, legacy=${legacyBodyMap}`);
  if (importButtons !== 0 || newButtons !== 1 || editButtons !== 1) throw new Error(`教练操作入口错误：import=${importButtons}, new=${newButtons}, edit=${editButtons}`);

  await coachPage.locator('.strength-module').screenshot({ path: `${outputDirectory}/个人档案.png` });
  const pdfDownloadPromise = coachPage.waitForEvent('download', { timeout: 60000 });
  await coachPage.getByRole('button', { name: '导出个人档案', exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  await pdfDownload.saveAs(`${outputDirectory}/个人档案.pdf`);

  await coachPage.getByRole('button', { name: '录入新测试', exact: true }).click();
  await coachPage.locator('.archive-entry-modal').waitFor();
  const entryRows = await coachPage.locator('.archive-entry-fields .strength-entry-row').count();
  const livePreview = await coachPage.locator('.archive-live-preview').count();
  if (entryRows < 15 || livePreview !== 1) throw new Error(`录入工作区结构错误：rows=${entryRows}, preview=${livePreview}`);
  await coachPage.locator('#metric-bodyFatPct').fill('16');
  await coachPage.getByLabel('体脂率教练目标').fill('15');
  await coachPage.locator('#metric-verticalJumpCm').fill('46');
  await coachPage.getByLabel('垂直纵跳教练目标').fill('45');
  await coachPage.getByRole('button', { name: '保存草稿', exact: true }).click();
  await coachPage.getByText('草稿已保存在本机，仅当前浏览器可见。', { exact: true }).waitFor();
  const previewScore = (await coachPage.locator('.archive-preview-stats > div').nth(1).textContent())?.trim();
  if (!previewScore || previewScore.includes('—')) throw new Error(`实时评分未更新：${previewScore}`);
  await coachPage.screenshot({ path: `${outputDirectory}/个人档案数据录入.png`, fullPage: true });
  await coachPage.locator('.archive-entry-modal').getByRole('button', { name: '关闭' }).click();

  await coachPage.getByRole('button', { name: '编辑本次数据', exact: true }).click();
  const editDateDisabled = await coachPage.locator('.archive-entry-meta input[type="date"]').isDisabled();
  if (!editDateDisabled) throw new Error('编辑本次数据时测试日期仍可修改。');
  await coachPage.locator('.archive-entry-modal').getByRole('button', { name: '关闭' }).click();

  await coachPage.setViewportSize({ width: 390, height: 844 });
  await coachPage.locator('.archive-sheet-scroll').scrollIntoViewIfNeeded();
  const mobileOverflow = await coachPage.locator('.archive-sheet-scroll').evaluate((element) => element.scrollWidth > element.clientWidth);
  if (!mobileOverflow) throw new Error('移动端个人档案未启用横向查看。');
  await coachPage.locator('.archive-sheet-scroll').screenshot({ path: `${outputDirectory}/个人档案移动端.png` });
  if (coachErrors.length) throw new Error(coachErrors.join('\n'));

  const athleteContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const athletePage = await athleteContext.newPage();
  const athleteErrors = [];
  athletePage.on('pageerror', (error) => athleteErrors.push(`pageerror: ${error.message}`));
  athletePage.on('console', (message) => { if (message.type() === 'error') athleteErrors.push(`console: ${message.text()}`); });
  await login(athletePage, 'athlete01');
  await openPersonalArchive(athletePage);
  const athleteWriteButtons = await athletePage.getByRole('button', { name: /录入|编辑|保存草稿|沿用上次目标|导入/ }).count();
  const athleteExportButtons = await athletePage.getByRole('button', { name: '导出个人档案', exact: true }).count();
  if (athleteWriteButtons !== 0 || athleteExportButtons !== 1) throw new Error(`运动员权限错误：write=${athleteWriteButtons}, export=${athleteExportButtons}`);

  const athleteLoginResponse = await athletePage.request.post(`${baseUrl}/api/auth/login`, { data: { username: 'athlete01', password: 'demo123' } });
  const athleteLogin = await athleteLoginResponse.json();
  const forbiddenWrite = await athletePage.request.post(`${baseUrl}/api/strength-tests`, {
    headers: { authorization: `Bearer ${athleteLogin.token}` },
    data: { athleteId: athleteLogin.user.athleteId, testDate: '2026-08-22', metrics: { verticalJumpCm: 44 }, targets: {}, notes: 'permission-check' }
  });
  if (forbiddenWrite.status() !== 403) throw new Error(`运动员写入接口未拒绝：${forbiddenWrite.status()}`);
  await athletePage.locator('.strength-module').screenshot({ path: `${outputDirectory}/运动员只读个人档案.png` });
  if (athleteErrors.length) throw new Error(athleteErrors.join('\n'));

  console.log(JSON.stringify({
    moduleTitle,
    posterTitle,
    archiveRows,
    radarCount,
    legacyBodyMap,
    importButtons,
    coachNewButton: newButtons,
    coachEditButton: editButtons,
    entryRows,
    livePreview,
    previewScore,
    editDateDisabled,
    mobileOverflow,
    athleteWriteButtons,
    athleteExportButtons,
    athleteApiWriteStatus: forbiddenWrite.status(),
    pdfName: pdfDownload.suggestedFilename(),
    errors: [...coachErrors, ...athleteErrors]
  }, null, 2));
  await athleteContext.close();
} finally {
  await browser.close();
}
