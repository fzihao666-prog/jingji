import { readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
function loadPage() {
  let page;
  vm.runInNewContext(readFileSync(new URL('pages/login/login.js', root), 'utf8'), {
    require: () => ({}),
    Page: (definition) => { page = definition; },
  });
  return page;
}

describe('小程序登录图片预算与降级', () => {
  it('50 个图标和 hero 均随包发布，hero 小于 200KB', () => {
    const page = loadPage();
    expect(page.data.olympicIcons).toHaveLength(50);
    for (const icon of page.data.olympicIcons) {
      expect(icon.src).toMatch(/^\/assets\/olympic-sports\/.+\.png$/);
      expect(statSync(new URL(icon.src.slice(1), root)).size).toBeGreaterThan(0);
    }
    expect(statSync(new URL(page.data.heroUrl.slice(1), root)).size).toBeLessThan(200 * 1024);
    const config = JSON.parse(readFileSync(new URL('project.config.json', root), 'utf8'));
    expect(config.packOptions.ignore.some((entry) => entry.value === 'assets/olympic-sports')).toBe(false);
  });

  it('图片失败切换到静态兜底，不重试请求', () => {
    const page = loadPage();
    const updates = [];
    page.setData = (update) => updates.push(update);
    page.onHeroError();
    page.onIconError({ currentTarget: { dataset: { index: 0 } } });
    page.onIconError({ currentTarget: { dataset: { index: -1 } } });
    expect(updates).toEqual([{ heroFailed: true }, { 'olympicIcons[0].failed': true }]);
    const template = readFileSync(new URL('pages/login/login.wxml', root), 'utf8');
    expect(template).toContain('binderror="onHeroError"');
    expect(template).toContain('lazy-load binderror="onIconError"');
    expect(template).toContain('wx:else class="olympic-fallback"');
  });
});
