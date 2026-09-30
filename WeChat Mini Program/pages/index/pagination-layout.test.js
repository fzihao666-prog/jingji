import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('../../components/pager-nav/index.wxml', import.meta.url), 'utf8');

describe('待办分页无障碍状态', () => {
  it('翻页控件在翻页后播报当前页，不依赖非标准 aria-role', () => {
    // 翻页 UI 已统一抽到 components/pager-nav，所有人员列表共用同一份标记。
    expect(template).toMatch(/class="pager-nav-indicator"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    expect(template).not.toContain('aria-role=');
  });

  it('页面不保留内联翻页标记，统一走 pager-nav 组件', () => {
    const page = readFileSync(new URL('./index.wxml', import.meta.url), 'utf8');
    expect(page).not.toContain('todo-pager');
    expect(page).toContain('pager-nav');
  });
});
