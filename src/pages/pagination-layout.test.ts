import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rosterSource = readFileSync(new URL('./RosterPage.tsx', import.meta.url), 'utf8');
const athleteManagementSource = readFileSync(
  new URL('./AthleteManagementPage.tsx', import.meta.url),
  'utf8'
);
const stylesDir = new URL('../styles/', import.meta.url);
const styles = [
  readFileSync(new URL('../styles.css', import.meta.url), 'utf8'),
  ...readdirSync(stylesDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(new URL(name, stylesDir), 'utf8')),
].join('\n');

describe('分页窄屏布局', () => {
  it('花名册在窄屏使用当前页摘要，完整页码由样式隐藏', () => {
    expect(rosterSource).toContain('roster-pagination-summary');
    expect(styles).toMatch(/\.roster-pagination-summary\s*\{[^}]*display:\s*none/s);
    expect(styles).toMatch(
      /@media[^}]*(?:max-width:\s*540px|width\s*<=\s*540px)[\s\S]*?\.roster-pagination-summary\s*\{[^}]*display:\s*inline/s
    );
  });

  it('两个 Web 翻页区都有不小于 36px 的按钮与上一页、下一页名称', () => {
    expect(rosterSource).toContain('aria-label="上一页"');
    expect(rosterSource).toContain('aria-label="下一页"');
    expect(athleteManagementSource).toContain('aria-label="上一页"');
    expect(athleteManagementSource).toContain('aria-label="下一页"');
    expect(styles).toMatch(/\.roster-pagination button\s*\{[^}]*min-height:\s*36px/s);
    expect(styles).toMatch(
      /\.athlete-directory-card > footer nav button\s*\{[^}]*min-height:\s*36px/s
    );
  });

  it('翻页后向读屏用户播报当前页状态', () => {
    expect(rosterSource).toMatch(/visually-hidden[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    expect(athleteManagementSource).toMatch(
      /visually-hidden[^>]*aria-live="polite"[^>]*aria-atomic="true"/
    );
    expect(rosterSource).not.toContain('className="roster-pagination-summary" aria-live');
    expect(rosterSource).toContain('aria-label={`第 ${item.page} 页`}');
  });
});
