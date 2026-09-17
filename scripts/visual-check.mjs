import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5173';
const task3RadarOnly = process.env.TASK3_RADAR_ONLY === '1';
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];

page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

if (task3RadarOnly) {
  const source = {
    name: '赛艇测试公开标准',
    url: 'https://example.com/rowing-standard',
    year: 2026,
    protocol: '标准测试协议',
  };
  const readyDimension = (key, label, unit, currentValue, referenceValue, achievedPercent) => ({
    key,
    label,
    unit,
    direction: 'higher_better',
    currentValue,
    referenceValue,
    achievedPercent,
    signedDifference: currentValue - referenceValue,
    status: 'ready',
    source,
  });
  await page.route('**/api/athletes/*/radar-models?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        special: {
          kind: 'special',
          dimensions: [
            readyDimension('rowing_erg_2000_time', '2000m测功仪', 's', 370, 360, 97.3),
            readyDimension('rowing_erg_5000_time', '5000m测功仪', 's', 1000, 1050, 105),
            readyDimension('rowing_erg_peak_power', '峰值功率', 'W', 920, 700, 150),
          ],
        },
        physical: {
          kind: 'physical',
          dimensions: [
            readyDimension('relative_squat', '相对深蹲', '倍体重', 2, 1.7, 117.6),
            readyDimension('vertical_jump', '纵跳', 'cm', 55, 50, 110),
            readyDimension('front_plank', '前支撑', 's', 190, 180, 105.6),
          ],
        },
      }),
    })
  );
}

async function verifyAthleteRadarCards() {
  await page.getByRole('button', { name: '运动员档案', exact: true }).click();
  await page.getByRole('heading', { name: '运动员档案', exact: true }).waitFor();
  await page.getByRole('heading', { name: '专项测试雷达', exact: true, level: 3 }).waitFor();
  await page.getByRole('heading', { name: '体能测试雷达', exact: true, level: 3 }).waitFor();
  const liveStatuses = page.locator(
    '.athlete-radar-card > .athlete-radar-root > .athlete-radar-live-status[aria-live="polite"]'
  );
  const liveStatusTexts = await liveStatuses.allTextContents();
  if (liveStatusTexts.length !== 2 || liveStatusTexts.some((text) => !text.trim()))
    throw new Error(`雷达卡片缺少持久且非空的 aria-live 状态文本：${liveStatusTexts.length}`);

  const textContrast = await page
    .locator('.athlete-radar-card')
    .first()
    .evaluate((card) => {
      const parseColor = (value) => {
        const channels = value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!channels || channels.length !== 3) throw new Error(`无法解析颜色：${value}`);
        return channels;
      };
      const luminance = (value) => {
        const [red, green, blue] = parseColor(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
      };
      const contrast = (foreground, background) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      };
      const summary = card.querySelector('.athlete-radar-summary');
      const detailLabel = card.querySelector('.athlete-radar-details dd small');
      const detailRow = detailLabel?.closest('.athlete-radar-details > div');
      if (!summary || !detailLabel || !detailRow) throw new Error('雷达文字对比度检查目标缺失');
      return {
        summary: contrast(getComputedStyle(summary).color, getComputedStyle(card).backgroundColor),
        detailLabel: contrast(
          getComputedStyle(detailLabel).color,
          getComputedStyle(detailRow).backgroundColor
        ),
      };
    });
  if (textContrast.summary < 4.5 || textContrast.detailLabel < 4.5)
    throw new Error(`雷达摘要或明细字段名文字对比度不足：${JSON.stringify(textContrast)}`);

  const sourceLink = page.getByRole('link', { name: /来源：赛艇测试公开标准/ }).first();
  await sourceLink.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const sourceFocus = await sourceLink.evaluate((element) => {
    const styles = getComputedStyle(element);
    const alphaMatch = styles.outlineColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
    return {
      active: document.activeElement === element,
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
      outlineAlpha: alphaMatch ? Number(alphaMatch[1]) : 1,
    };
  });
  if (
    !sourceFocus.active ||
    sourceFocus.outlineStyle === 'none' ||
    sourceFocus.outlineWidth < 3 ||
    sourceFocus.outlineAlpha < 1
  )
    throw new Error(`雷达来源链接键盘焦点不可清晰识别：${JSON.stringify(sourceFocus)}`);
}

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDirectory}/training-login.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${outputDirectory}/training-login-mobile.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole('button', { name: '运动员注册', exact: true }).click();
await page.getByRole('heading', { name: '运动员注册' }).waitFor();
const coachRegistrationEntries = await page.getByText('教练', { exact: true }).count();
if (coachRegistrationEntries !== 0)
  throw new Error(`注册页仍显示教练注册入口：${coachRegistrationEntries}`);
await page.screenshot({ path: `${outputDirectory}/training-register.png`, fullPage: true });
await page.screenshot({ path: `${outputDirectory}/training-register-athlete.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${outputDirectory}/training-register-mobile.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole('button', { name: /返回登录/ }).click();
await page.getByLabel('账号', { exact: true }).fill(task3RadarOnly ? 'athlete01' : 'coach01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录系统', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
if (task3RadarOnly) {
  await verifyAthleteRadarCards();
  console.log(JSON.stringify({ athleteRadarCards: 'ok', browserErrors: errors }, null, 2));
  await browser.close();
  process.exit(0);
}
await page.waitForTimeout(1200);
const removedNavEntries = await page
  .getByRole('button', { name: /^(训练日历|周期报告|AI识别导入)$/ })
  .count();
if (removedNavEntries !== 0) throw new Error('已移除模块仍出现在主导航');
await page.screenshot({ path: `${outputDirectory}/training-overview.png`, fullPage: true });
await page.locator('.birthplace-map-panel').scrollIntoViewIfNeeded();
await page
  .locator('.birthplace-map-panel')
  .screenshot({ path: `${outputDirectory}/overview-birthplace-live-roster.png` });
const birthplaceRows = await page.locator('.birthplace-athlete-scroll > div').count();
const birthplaceScroll = await page.locator('.birthplace-athlete-scroll').evaluate((element) => ({
  clientHeight: element.clientHeight,
  scrollHeight: element.scrollHeight,
}));
const birthplaceRealtimeLabel = await page
  .locator('.birthplace-detail-heading')
  .getByText('实时人数', { exact: true })
  .count();
if (!birthplaceRealtimeLabel || !birthplaceRows)
  throw new Error('生源地地图缺少实时人数或人员基本信息');
if (birthplaceRows > 3 && birthplaceScroll.scrollHeight <= birthplaceScroll.clientHeight)
  throw new Error('生源地全部人员未使用滚动方式承载');
const originalProvincePath = page.locator('.birthplace-map-stage path.is-active');
const originalProvinceLabel = await originalProvincePath.getAttribute('aria-label');
const otherProvincePath = page
  .locator('.birthplace-map-stage path.has-origin-data:not(.is-active)')
  .first();
const otherProvinceLabel = await otherProvincePath.getAttribute('aria-label');
await otherProvincePath.dispatchEvent('mouseenter');
if (
  (await page.locator('.birthplace-map-stage path.is-active').getAttribute('aria-label')) !==
  originalProvinceLabel
) {
  throw new Error('鼠标经过省份时不应自动切换选中地区');
}
await otherProvincePath.evaluate((path) =>
  path.dispatchEvent(new MouseEvent('click', { bubbles: true }))
);
if (
  (await page.locator('.birthplace-map-stage path.is-active').getAttribute('aria-label')) !==
  otherProvinceLabel
) {
  throw new Error('点击省份后未锁定选中地区');
}
await page
  .locator(`.birthplace-map-stage path[aria-label="${originalProvinceLabel}"]`)
  .evaluate((path) => path.dispatchEvent(new MouseEvent('click', { bubbles: true })));

await page.getByRole('button', { name: '教练管理', exact: true }).click();
await page.getByRole('heading', { name: '教练管理', exact: true }).waitFor();
await page.locator('.coach-directory-table tbody tr').first().waitFor();
const coachSelfServiceCount = await page.locator('.coach-directory-table tbody tr').count();
const coachUnauthorizedAdjust = await page.getByRole('button', { name: /新增教练|调配/ }).count();
const coachUnauthorizedCategoryEdit = await page.locator('.coach-detail-category').count();
const coachSelfCollaborationText = await page.getByText(/协作/).count();
if (coachSelfServiceCount !== 1 || coachUnauthorizedAdjust !== 0)
  throw new Error(
    `教练本人责任域权限不正确：教练${coachSelfServiceCount}，调配按钮${coachUnauthorizedAdjust}`
  );
if (coachUnauthorizedCategoryEdit !== 0) throw new Error('教练本人不应拥有类别编辑权限');
if (coachSelfCollaborationText !== 0) throw new Error('教练页面仍显示协作信息');
await page.screenshot({
  path: `${outputDirectory}/training-coach-self-service.png`,
  fullPage: true,
});

await verifyAthleteRadarCards();
await page.locator('.athlete-picker-trigger').click();
const athleteOptions = page.locator('.athlete-picker-options button');
if ((await athleteOptions.count()) > 1) await athleteOptions.nth(1).click();
await page.locator('.personal-identity-card').waitFor();
await page.locator('.strength-poster-web').waitFor();
await page.locator('.injury-recovery-module').waitFor();
await page.waitForTimeout(600);
const removedPersonalModules = await page
  .locator('.model-standard-card, .personal-calendar-section')
  .count();
if (removedPersonalModules !== 0) throw new Error('运动员表现仍显示分析标准或训练记录与报告模块');
if (await page.locator('.strength-advice-shell').count())
  throw new Error('运动员表现仍显示训练建议方案模块');
await page.screenshot({ path: `${outputDirectory}/training-personal.png`, fullPage: true });
await page
  .locator('.strength-module')
  .screenshot({ path: `${outputDirectory}/training-strength-profile.png` });
await page
  .locator('.injury-recovery-module')
  .screenshot({ path: `${outputDirectory}/personal-injury-recovery.png` });

await page.getByRole('button', { name: '新增伤病记录', exact: true }).click();
await page.getByRole('heading', { name: '新增伤病与恢复记录', exact: true }).waitFor();
const coachRestrictionFields = await page.getByText('训练限制', { exact: true }).count();
if (!coachRestrictionFields) throw new Error('教练伤病记录表单缺少训练限制字段');
await page.screenshot({ path: `${outputDirectory}/personal-injury-editor.png`, fullPage: true });
await page.locator('.injury-dialog').getByRole('button', { name: '关闭', exact: true }).click();

await page
  .getByRole('button', { name: /编辑本次数据|录入新测试|录入第一次测试/ })
  .first()
  .click();
await page.getByRole('heading', { name: /录入新测试|编辑本次数据/ }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-strength-editor.png`, fullPage: true });
await page.locator('.strength-editor-modal').getByRole('button', { name: '关闭' }).click();

const strengthDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
await page.getByRole('button', { name: '导出运动员表现', exact: true }).click();
const strengthDownload = await strengthDownloadPromise;
await strengthDownload.saveAs(`${outputDirectory}/personal-strength-profile.pdf`);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outputDirectory}/training-mobile.png`, fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
await page.evaluate(() => localStorage.clear());
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('admin01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录系统', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.waitForTimeout(500);
const adminNameEditButtons = await page.locator('.name-edit-trigger').count();
await page.getByRole('button', { name: '教练管理', exact: true }).click();
await page.getByRole('heading', { name: '教练管理', exact: true }).waitFor();
await page.locator('.coach-directory-table tbody tr').first().waitFor();
const oldRosterEntry = await page.getByRole('button', { name: '人员关系', exact: true }).count();
if (oldRosterEntry !== 0) throw new Error('原人员关系入口仍然存在');
if (await page.getByText(/协作/).count()) throw new Error('教练名册仍显示协作信息');
const categoryFilter = page.getByLabel('筛选教练类别', { exact: true });
const categoryFilterOptions = await categoryFilter.locator('option').count();
if (categoryFilterOptions !== 3)
  throw new Error(`教练类别筛选项数量错误：${categoryFilterOptions}`);
await categoryFilter.selectOption({ label: '专项教练' });
if (!(await page.locator('.coach-directory-table tbody tr').count()))
  throw new Error('按专项教练筛选后未显示已有教练');
await categoryFilter.selectOption('');
await page.screenshot({ path: `${outputDirectory}/training-coach-management.png`, fullPage: true });
await page.getByRole('button', { name: '新增教练', exact: true }).click();
await page.getByRole('heading', { name: '新增教练', exact: true }).waitFor();
const createCategoryOptions = await page
  .locator('.coach-create-fields label')
  .filter({ hasText: '教练类别' })
  .locator('select option')
  .count();
if (createCategoryOptions !== 2) throw new Error(`新增教练类别数量错误：${createCategoryOptions}`);
await page.screenshot({ path: `${outputDirectory}/training-coach-create.png`, fullPage: true });
await page
  .locator('.coach-create-modal')
  .getByRole('button', { name: '关闭', exact: true })
  .click();
await page
  .locator('.coach-directory-table tbody tr')
  .first()
  .getByRole('button', { name: '查看', exact: true })
  .click();
await page.getByRole('heading', { name: '教练档案', exact: true }).waitFor();
await page.waitForTimeout(300);
const editableCoachName = page.locator('.coach-detail-identity .name-edit-trigger').first();
if (!(await editableCoachName.count())) throw new Error('未找到可编辑的教练姓名');
const categoryEditorOptions = await page.locator('.coach-detail-category select option').count();
if (categoryEditorOptions !== 2)
  throw new Error(`教练档案类别编辑项数量错误：${categoryEditorOptions}`);
if (await page.getByText(/协作/).count()) throw new Error('教练档案仍显示协作信息');
await page.screenshot({ path: `${outputDirectory}/training-coach-detail.png`, fullPage: true });
await page
  .locator('.coach-detail-section')
  .getByRole('button', { name: '调整', exact: true })
  .click();
await page.getByRole('heading', { name: /调整.+的责任范围/ }).waitFor();
const responsibilityOptions = await page
  .locator('.coach-scope-list input[type="checkbox"]')
  .count();
if (!responsibilityOptions) throw new Error('教练责任范围缺少可选运动员');
if (await page.getByText(/协作/).count()) throw new Error('责任范围编辑仍显示协作信息');
await page.screenshot({
  path: `${outputDirectory}/training-coach-scope-editor.png`,
  fullPage: true,
});
await page.locator('.coach-scope-modal').getByRole('button', { name: '关闭', exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
await page.screenshot({
  path: `${outputDirectory}/training-coach-management-mobile.png`,
  fullPage: true,
});
const coachMobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth
);
if (coachMobileOverflow > 1) throw new Error(`教练管理移动端横向溢出：${coachMobileOverflow}px`);
await page.setViewportSize({ width: 1440, height: 1000 });
await page
  .locator('.coach-directory-table tbody tr')
  .first()
  .getByRole('button', { name: '查看', exact: true })
  .click();
await page.getByRole('heading', { name: '教练档案', exact: true }).waitFor();
await editableCoachName.click();
await page.getByRole('heading', { name: '修改教练姓名' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-name-editor.png`, fullPage: true });
await page.locator('.name-editor-modal').getByRole('button', { name: '关闭', exact: true }).click();
await page.locator('.name-editor-modal').waitFor({ state: 'detached' });
await page
  .locator('.coach-detail-drawer')
  .getByRole('button', { name: '关闭', exact: true })
  .click();
await page.getByRole('button', { name: '账户审核' }).click();
await page.getByRole('heading', { name: '账户审核' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-account-review.png`, fullPage: true });

await page.getByRole('button', { name: '账号权限' }).click();
await page.getByRole('heading', { name: '账号权限' }).waitFor();
await page.screenshot({ path: `${outputDirectory}/training-account-access.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({
  path: `${outputDirectory}/training-account-access-mobile.png`,
  fullPage: true,
});
await page.setViewportSize({ width: 1440, height: 1000 });

await page.evaluate(() => localStorage.clear());
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByLabel('账号', { exact: true }).fill('regional01');
await page.getByLabel('密码', { exact: true }).fill('demo123');
await page.getByRole('button', { name: '登录系统', exact: true }).click();
await page.getByRole('heading', { name: '训练总览' }).waitFor();
await page.waitForTimeout(800);
const regionalAthleteRows = await page.locator('.roster-preview tbody tr').count();
const regionalOwnNameEdit = await page.locator('.sidebar-footer .name-edit-trigger').count();
await page.screenshot({
  path: `${outputDirectory}/training-regional-overview.png`,
  fullPage: true,
});

console.log(
  JSON.stringify(
    {
      title: await page.title(),
      strengthProfileName: strengthDownload.suggestedFilename(),
      removedNavEntries,
      coachSelfServiceCount,
      coachUnauthorizedAdjust,
      coachUnauthorizedCategoryEdit,
      coachRegistrationEntries,
      coachSelfCollaborationText,
      categoryFilterOptions,
      createCategoryOptions,
      categoryEditorOptions,
      adminNameEditButtons,
      regionalAthleteRows,
      regionalOwnNameEdit,
      responsibilityOptions,
      coachMobileOverflow,
      browserErrors: errors,
    },
    null,
    2
  )
);

await browser.close();
