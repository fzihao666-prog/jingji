import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { validateRegistrationDemographics as sharedValidate } from '../../shared/registration-demographics';

const helperModule = { exports: {} };
vm.runInNewContext(readFileSync(new URL('./registration-demographics.js', import.meta.url), 'utf8'), { module: helperModule });
const validate = helperModule.exports.validateRegistrationDemographics;

describe('小程序与共享注册资料规则一致', () => {
  it.each([
    [{ gender: '男', birthDate: '2000-02-29' }, {}],
    [{ gender: '女', birthDate: '2026-10-12' }, {}],
    [{ gender: '男', birthDate: '2026-10-13' }, { birthDate: '出生日期不能晚于今天' }],
    [{ gender: '', birthDate: '' }, { gender: '请选择性别', birthDate: '请选择有效出生日期' }],
    [{ gender: '其他', birthDate: '1900-02-29' }, { gender: '请选择性别', birthDate: '请选择有效出生日期' }],
    [{ gender: '女', birthDate: '2026-04-31' }, { birthDate: '请选择有效出生日期' }],
    [{ gender: '女', birthDate: '0000-01-01' }, { birthDate: '请选择有效出生日期' }],
    [{ gender: '男', birthDate: '2026-1-1' }, { birthDate: '请选择有效出生日期' }],
    [{ gender: null, birthDate: 20260101 }, { gender: '请选择性别', birthDate: '请选择有效出生日期' }]
  ])('校验 %j', (input, errors) => {
    expect(validate(input, '2026-10-12')).toEqual(errors);
    expect(validate(input, '2026-10-12')).toEqual(sharedValidate(input, '2026-10-12'));
  });
});
