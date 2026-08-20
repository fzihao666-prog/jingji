import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts-project-lanes';
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
  if (await page.getByLabel('账号', { exact: true }).count()) {
    await page.getByLabel('账号', { exact: true }).fill('admin01');
    await page.getByLabel('密码', { exact: true }).fill('demo123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
  }
  await page.getByRole('heading', { name: '训练总览' }).waitFor();

  const selector = page.locator('.project-lanes');
  const toolbar = page.locator('.date-toolbar');
  const projectFilter = page.locator('.project-filter');
  const buttons = selector.locator('button');
  const labels = await buttons.allTextContents();
  if (labels.join('|') !== '赛艇|皮划艇|激流') throw new Error(`项目标签不正确：${labels.join('|')}`);

  const metrics = await buttons.evaluateAll((items) => items.map((item) => ({
    label: item.textContent?.trim() || '',
    clientWidth: item.clientWidth,
    scrollWidth: item.scrollWidth,
    clientHeight: item.clientHeight,
    scrollHeight: item.scrollHeight,
    marks: item.querySelectorAll('.project-mark').length
  })));
  const overflow = metrics.filter((item) => item.scrollWidth > item.clientWidth || item.scrollHeight > item.clientHeight);
  if (overflow.length) throw new Error(`项目切换器存在溢出：${JSON.stringify(overflow)}`);
  if (metrics.some((item) => item.marks !== 1)) throw new Error('项目图标数量不正确');

  for (const label of labels) {
    const button = page.getByRole('button', { name: `切换到${label}` });
    await button.click();
    await page.waitForTimeout(250);
    if (!(await button.evaluate((item) => item.classList.contains('active')))) {
      throw new Error(`${label}切换后未进入选中状态`);
    }
    if (await projectFilter.locator('.project-mark').count() !== 1) {
      throw new Error(`${label}工具栏未使用项目专属图标`);
    }
    const selectedProject = await projectFilter.locator('select').inputValue();
    if (selectedProject !== label) throw new Error(`工具栏项目未同步：预期${label}，实际${selectedProject}`);
    const filterOverflow = await projectFilter.evaluate((item) => item.scrollWidth > item.clientWidth || item.scrollHeight > item.clientHeight);
    if (filterOverflow) throw new Error(`${label}工具栏项目选择器存在溢出`);
    await selector.screenshot({ path: `${outputDirectory}/${label}.png` });
    await toolbar.screenshot({ path: `${outputDirectory}/工具栏-${label}.png` });
    await page.locator('.athlete-picker-trigger').click();
    const pickerProject = page.locator('.athlete-picker-project');
    await pickerProject.waitFor();
    if (await pickerProject.locator('.project-mark').count() !== 1) {
      throw new Error(`${label}运动员下拉框未使用项目专属图标`);
    }
    await page.locator('.athlete-picker-menu').screenshot({ path: `${outputDirectory}/运动员下拉-${label}.png` });
    await page.locator('.athlete-picker-trigger').click();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobileFilterOverflow = await projectFilter.evaluate((item) => item.scrollWidth > item.clientWidth || item.scrollHeight > item.clientHeight);
  if (mobileFilterOverflow) throw new Error('手机端工具栏项目选择器存在溢出');
  await toolbar.screenshot({ path: `${outputDirectory}/工具栏-手机端.png` });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ labels, metrics, screenshots: labels.length * 3 + 1, errors }, null, 2));
} finally {
  await browser.close();
}
