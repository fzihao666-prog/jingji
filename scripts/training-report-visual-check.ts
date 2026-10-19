import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { registerReportRoutes } from '../server/report/report-routes.ts';
import { createReportFixture } from '../server/report/report-fixture.ts';

// 完整报告交互只使用合成内存库；不启动 index.ts，不加载环境密钥或正式数据库。
const output = resolve(process.argv[2] || 'outputs/training-report-check');
await mkdir(output, { recursive: true });
const db = createReportFixture();
const app = express();
app.use(express.json());
const user = {
  id: 1,
  username: 'fixture',
  displayName: '合成示例',
  role: 'ATL' as const,
  athleteId: 1,
  sessionVersion: 1,
};
registerReportRoutes(app, {
  db,
  requireAuth: (req, _res, next) => {
    req.authUser = user;
    next();
  },
  hasAccess: (_user, id) => id === 1,
  currentUser: () => user,
  generate: async () => ({
    highlights: ['本周期记录了三次训练。'],
    concerns: ['部分课次时长缺失，请核对。'],
    suggestions: ['补齐训练时长与 RPE 后再复核负荷。'],
  }),
});
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>训练报告合成验证</title></head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import '/src/styles.css';
import {TrainingReport} from '/src/components/TrainingReport.tsx';
import {TrainingReportFigures} from '/src/components/TrainingReport.tsx';
import {Empty, Partial} from '/src/components/TrainingReport.stories.tsx';
const state = new URL(location.href).searchParams.get('state');
const root = createRoot(document.getElementById('root'));
root.render(state ? React.createElement('section', {className:'training-report'}, React.createElement(TrainingReportFigures, (state === 'empty' ? Empty : Partial).args)) : React.createElement(TrainingReport,{athleteId:1,athleteName:'合成示例',initialDate:'2026-10-05'}));
</script></body></html>`;
app.get('/__training-report', async (_req, res) =>
  res.type('html').send(await vite.transformIndexHtml('/__training-report', html))
);
app.use(vite.middlewares);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((done) => server.once('listening', done));
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/__training-report`);
  await page.getByRole('button', { name: '预览图表' }).waitFor();
  await page.getByRole('combobox', { name: '报告类型' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.getByLabel('所在周 / 月的日期').evaluate((el) => el === document.activeElement),
    true
  );
  await page.getByRole('button', { name: '预览图表' }).click();
  await page.getByRole('heading', { name: '测试变化', exact: true }).waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '生成 AI 点评' }).click();
  await page.getByText('AI 草稿已生成，请核对后保存。').waitFor();
  await page.getByRole('textbox', { name: '主要表现' }).fill('已人工核对训练记录。');
  await page.getByRole('textbox', { name: '主要表现' }).press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('第二条记录。');
  assert.equal(
    await page.getByRole('textbox', { name: '主要表现' }).inputValue(),
    '已人工核对训练记录。\n第二条记录。'
  );
  await page.getByRole('button', { name: '确认并保存报告' }).click();
  await page.getByText('报告已确认保存，两端可在历史报告中查看。').waitFor();
  await page.screenshot({ path: resolve(output, 'report-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '历史报告' }).click();
  await page.getByRole('button', { name: /2026-10-05 — 2026-10-11/ }).click();
  await page.getByText('已人工核对训练记录。', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'report-mobile-web.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    '窄屏横向溢出'
  );
  // 样例故事通过同一 Vite 转译器加载，验证空、部分数据和可聚焦控件。
  await page.evaluate(async () => {
    const stories = await import('/src/components/TrainingReport.stories.tsx');
    if (!stories.Empty || !stories.Partial || !stories.Controls.play)
      throw new Error('故事状态缺失');
    await stories.Controls.play({ canvasElement: document.getElementById('root') });
  });
  await page.goto(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/__training-report?state=empty`
  );
  await page.getByText('当前范围暂无有效训练记录', { exact: true }).waitFor();
  await page.goto(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/__training-report?state=partial`
  );
  await page.getByText('有效填报 1/1 课次', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      screenshots: output,
      checks: [
        '真实本地接口预览',
        'AI草稿人工编辑保存',
        '历史快照',
        '键盘焦点',
        '390px无溢出',
        '无页面异常',
      ],
    })
  );
} finally {
  await browser.close();
  await vite.close();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
