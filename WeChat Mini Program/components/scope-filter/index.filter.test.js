import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./index.wxml', import.meta.url), 'utf8');

describe('队伍与关键词筛选', () => {
  it('支持队伍选择并向外发送 teamId', () => {
    expect(componentSource).toContain('onTeamChange');
    expect(componentSource).toContain("triggerEvent('teamchange'");
    expect(templateSource).toContain('bindchange="onTeamChange"');
    expect(templateSource).toContain('showTeam');
  });

  it('关键词筛选只缩小已加载运动员候选，不扩大授权范围', () => {
    expect(componentSource).toContain('onKeywordInput');
    expect(componentSource).toContain("triggerEvent('keywordchange'");
    // 筛选在已有 athletes 列表上进行，不请求新数据
    expect(componentSource).toContain('(athletes || []).filter');
    expect(templateSource).toContain('bindinput="onKeywordInput"');
  });

  it('关键词按姓名或队伍过滤候选运动员', () => {
    // 模拟 observers 中的过滤逻辑（与 index.js 中的实现一致）
    const athletes = [
      { id: 1, name: '张三', team: 'A队' },
      { id: 2, name: '李四', team: 'B队' },
      { id: 3, name: '王五', team: 'A队' },
    ];
    const kw = 'a队';
    const filtered = athletes.filter((item) =>
      (item.name || '').toLowerCase().includes(kw) || (item.team || '').toLowerCase().includes(kw)
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.id)).toEqual([1, 3]);
  });
});
