import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// 浏览器检查真实 WXSS 与人员按钮模板的几何边界；微信渲染仍需开发者工具验收。
const root = new URL('../WeChat Mini Program/', import.meta.url);
const globalStyle = readFileSync(new URL('app.wxss', root), 'utf8');
const pageStyle = readFileSync(new URL('pages/index/index.wxss', root), 'utf8');
const template = readFileSync(new URL('pages/index/index.wxml', root), 'utf8');
const pagerStyle = readFileSync(new URL('components/pager-nav/index.wxss', root), 'utf8');
const pagerTemplate = readFileSync(new URL('components/pager-nav/index.wxml', root), 'utf8');
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
      const actionsMatch = template.match(/<view class="focus-actions">[\s\S]*?<\/view>/);
      assert.ok(actionsMatch, '状态监测操作按钮必须被检查');
      const actions = actionsMatch[0].replace(/\{\{([^}]+)\}\}/g, (_, expression) => expression.includes('?') ? (longText ? '已跟进 · 撤销' : '标记已跟进') : '1');
      const pager = `<pager-nav>${pagerTemplate.replace(/\{\{([^}]+)\}\}/g, (_, expression) => expression.includes('?') || expression.includes('>') || expression.includes('<=') ? '' : expression === 'page + 1' ? '10000' : expression === 'label' ? '运动员' : expression === 'unit' ? '人' : '99999')}</pager-nav>`;
      const css = `${globalStyle}\n${pageStyle}\n${pagerStyle}`
        .replace(/@import[^;]+;/g, '')
        .replace(/([\d.]+)rpx/g, (_, number) => `${Number(number) * width / 750}px`)
        .replace(/\bpage\s*\{/g, 'body {')
        .replace(/:host/g, 'pager-nav');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.setContent(`<style>body { margin: 0; } view, text { display: block; } button { width: 100%; } ${css}</style>
        <view class="page">${rows.map((row) => `<view class="card morning-card">${row}${pager}</view>`).join('')}
        <view class="card focus-card"><view class="focus-row"><view class="focus-row-head"><text class="focus-name">${value}</text><view class="focus-tags"><text class="focus-tag">${value}</text></view></view><view class="todo-note">${value}</view>${actions}</view>${pager}</view></view>`);
      const failures = await page.evaluate(() => {
        const errors = [];
        for (const host of document.querySelectorAll('pager-nav')) {
          if (getComputedStyle(host).display !== 'block') errors.push('分页组件外层未建立块级宽度边界');
        }
        for (const row of document.querySelectorAll('.card-row-button, .focus-row, pager-nav, .pager-nav, .pager-nav-button, .pager-nav-indicator')) {
          const card = row.closest('.card').getBoundingClientRect();
          const bounds = row.getBoundingClientRect();
          if (bounds.left < card.left || bounds.right > card.right + 1) errors.push('人员卡片超出外层卡片');
          if (row.scrollWidth > row.clientWidth + 1) errors.push('人员内容横向溢出');
        }
        const actionButtons = [...document.querySelectorAll('.focus-actions button')];
        if (actionButtons.length !== 5) errors.push('状态监测操作按钮缺失');
        if (Math.abs(actionButtons[0].getBoundingClientRect().top - actionButtons[1].getBoundingClientRect().top) > 1) errors.push('操作按钮未优先横向排列');
        for (const button of actionButtons) {
          const parent = button.parentElement.getBoundingClientRect();
          const bounds = button.getBoundingClientRect();
          if (bounds.left < parent.left - 1 || bounds.right > parent.right + 1) errors.push('操作按钮超出容器');
        }
        for (const indicator of document.querySelectorAll('.pager-nav-indicator')) {
          for (const text of indicator.children) {
            if (text.scrollWidth > text.clientWidth + 1 || text.getBoundingClientRect().width < 1) errors.push('分页信息被挤压或裁剪');
          }
        }
        if (getComputedStyle(document.querySelector('.exec-row')).display !== 'grid') errors.push('执行人员网格被公共按钮样式覆盖');
        if (document.documentElement.scrollWidth > innerWidth) errors.push('页面横向溢出');
        return errors;
      });
      assert.deepEqual(failures, [], `${width}px，${longText ? '超长' : '普通'}文本`);
      await page.close();
    }
  }
  console.log('小程序布局检查通过：4 种屏宽 × 普通/超长文本，含分页按钮、五位数页码及总人数。');
} finally {
  await browser.close();
}
