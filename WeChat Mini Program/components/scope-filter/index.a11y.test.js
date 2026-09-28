import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./index.wxml', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./index.wxss', import.meta.url), 'utf8');

describe('项目筛选无障碍', () => {
  it('向读屏公开时间范围的当前选择，并提供可见焦点提示', () => {
    expect(template).toContain("aria-label=\"时间范围：{{item.label}}，{{range === item.value ? '已选中' : '未选中'}}\"");
    expect(styles).toContain('.scope-picker:focus');
    expect(styles).toContain('.scope-range button:focus');
  });
});
