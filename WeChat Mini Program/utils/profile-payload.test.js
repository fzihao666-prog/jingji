import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// 在独立上下文执行小程序 CommonJS 模块，不依赖微信运行时。
const source = readFileSync(new URL('./profile-payload.js', import.meta.url), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(source, context);
const { personalProfilePayload } = context.module.exports;

describe('个人资料提交格式', () => {
  it('清理空格并将未补零日期转成服务端要求的日期格式', () => {
    const result = personalProfilePayload({ name: ' 测试姓名 ', birthDate: ' 2006-9-3 ', startSportDate: '2024-2-29' });
    expect(result.name).toBe('测试姓名');
    expect(result.birthDate).toBe('2006-09-03');
    expect(result.startSportDate).toBe('2024-02-29');
  });

  it('空的选填字段提交为空字符串，组织和未知字段不提交', () => {
    const result = personalProfilePayload({ name: '测试姓名', project: '赛艇', team: '测试队伍', region: '测试地区', isAdmin: true });
    expect(result.birthDate).toBe('');
    expect(result.phone).toBe('');
    expect(result).not.toHaveProperty('project');
    expect(result).not.toHaveProperty('team');
    expect(result).not.toHaveProperty('region');
    expect(result).not.toHaveProperty('isAdmin');
  });

  it.each([' ', '测', '测'.repeat(21)])('提前拒绝不符合服务端长度的姓名：%s', (name) => {
    expect(() => personalProfilePayload({ name })).toThrow('姓名须为2—20个字符。');
  });

  it.each(['2025-2-29', '2026-4-31', '2026-13-1', '2026/9/3'])('拒绝无效出生日期：%s', (birthDate) => {
    expect(() => personalProfilePayload({ name: '测试姓名', birthDate })).toThrow('出生日期');
  });

  it('开始运动日期错误时指出对应字段', () => {
    expect(() => personalProfilePayload({ name: '测试姓名', startSportDate: '2026-2-30' })).toThrow('开始运动日期');
  });
});
