import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// 浏览器检查真实 WXSS 与人员按钮模板的几何边界；微信渲染仍需开发者工具验收。
const root = new URL('../WeChat Mini Program/', import.meta.url);
const globalStyle = readFileSync(new URL('app.wxss', root), 'utf8');
const pageStyle = readFileSync(new URL('pages/index/index.wxss', root), 'utf8');
const template = readFileSync(new URL('pages/index/index.wxml', root), 'utf8');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  for (const width of [320, 375, 430, 768]) {
    for (const longText of [false, true]) {
      const value = longText ? 'AthleteABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3) : '运动员甲';
      const rows = [...template.matchAll(/<button\b[^>]*class="(?:morning-row|exec-row) [^"]*"[\s\S]*?<\/button>/g)].map(([row]) => row
        .replace(/\{\{([^}]+)\}\}/g, (_, expression) => expression.includes('?') ? '' : /sleepText|pulseText|fatigueText/.test(expression) ? '7.5' : value));
      assert.equal(rows.length, 2, '恢复日报和执行情况必须均被检查');
      const css = `${globalStyle}\n${pageStyle}`
        .replace(/@import[^;]+;/g, '')
        .replace(/([\d.]+)rpx/g, (_, number) => `${Number(number) * width / 750}px`)
        .replace(/\bpage\s*\{/g, 'body {');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.setContent(`<style>body { margin: 0; } view, text { display: block; } ${css}</style>
        <view class="page">${rows.map((row) => `<view class="card morning-card">${row}</view>`).join('')}
        <view class="card focus-card"><view class="focus-row"><view class="focus-row-head"><text class="focus-name">${value}</text><view class="focus-tags"><text class="focus-tag">${value}</text></view></view><view class="todo-note">${value}</view></view></view></view>`);
      const failures = await page.evaluate(() => {
        const errors = [];
        for (const row of document.querySelectorAll('.card-row-button, .focus-row')) {
          const card = row.closest('.card').getBoundingClientRect();
          const bounds = row.getBoundingClientRect();
          if (bounds.left < card.left || bounds.right > card.right + 1) errors.push('人员卡片超出外层卡片');
          if (row.scrollWidth > row.clientWidth + 1) errors.push('人员内容横向溢出');
        }
        if (getComputedStyle(document.querySelector('.exec-row')).display !== 'grid') errors.push('执行人员网格被公共按钮样式覆盖');
        if (document.documentElement.scrollWidth > innerWidth) errors.push('页面横向溢出');
        return errors;
      });
      assert.deepEqual(failures, [], `${width}px，${longText ? '超长' : '普通'}文本`);
      await page.close();
    }
  }
  console.log('小程序布局检查通过：4 种屏宽 × 普通/超长文本，人员卡片边界与网格布局正常。');
} finally {
  await browser.close();
}
