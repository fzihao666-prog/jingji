import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDirectory = process.argv[2] || 'artifacts-auth-layout';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5173';
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const errors = [];

try {
  for (const viewport of [
    { name: 'desktop-low', width: 1234, height: 720 },
    { name: 'desktop-tall', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(`${viewport.name} pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${viewport.name} console: ${message.text()}`);
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '申请新账号', exact: true }).click();
    await page.getByRole('heading', { name: '申请注册', exact: true }).waitFor();

    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.login-panel');
      const box = document.querySelector('.login-box-register');
      const story = document.querySelector('.login-story');
      if (!panel || !box || !story) throw new Error('注册页布局节点缺失');
      const panelRect = panel.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      const storyRect = story.getBoundingClientRect();
      return {
        panelTop: Math.round(panelRect.top),
        panelBottom: Math.round(panelRect.bottom),
        panelHeight: Math.round(panelRect.height),
        boxTop: Math.round(boxRect.top),
        boxBottom: Math.round(boxRect.bottom),
        boxHeight: Math.round(boxRect.height),
        storyHeight: Math.round(storyRect.height),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight
      };
    });

    if (layout.boxTop < layout.panelTop || layout.boxBottom > layout.panelBottom + 1) {
      throw new Error(`${viewport.name} 注册表单突出容器：${JSON.stringify(layout)}`);
    }
    if (layout.scrollWidth > layout.clientWidth) {
      throw new Error(`${viewport.name} 存在横向溢出：${JSON.stringify(layout)}`);
    }
    if (viewport.width > 860 && Math.abs(layout.panelHeight - layout.storyHeight) > 1) {
      throw new Error(`${viewport.name} 左右卡片高度不一致：${JSON.stringify(layout)}`);
    }
    if (viewport.width <= 620 && layout.storyHeight > 260) {
      throw new Error(`${viewport.name} 顶部品牌区高度异常：${JSON.stringify(layout)}`);
    }

    await page.screenshot({ path: `${outputDirectory}/${viewport.name}.png`, fullPage: true });
    console.log(JSON.stringify({ viewport: viewport.name, ...layout }));
    await page.close();
  }

  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
