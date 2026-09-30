import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./index.wxml', import.meta.url), 'utf8');

describe('待办分页无障碍状态', () => {
  it('在翻页后播报当前页，不依赖非标准 aria-role', () => {
    expect(template).toMatch(/class="todo-pager-indicator"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    expect(template).not.toContain('aria-role="text"');
  });
});
