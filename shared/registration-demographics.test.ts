import { describe, expect, it } from 'vitest';
import { validateRegistrationDemographics } from './registration-demographics.js';

describe('注册性别与出生日期', () => {
  it('接受真实闰日及当天', () => {
    expect(
      validateRegistrationDemographics({ gender: '女', birthDate: '2000-02-29' }, '2026-10-12')
    ).toEqual({});
    expect(
      validateRegistrationDemographics({ gender: '男', birthDate: '2026-10-12' }, '2026-10-12')
    ).toEqual({});
  });
  it.each(['2001-02-29', '2000-02-30', '2026-13-01', '2026-1-01', '0000-01-01', '', null, 123])(
    '拒绝非法日期 %s',
    (birthDate) => {
      expect(
        validateRegistrationDemographics({ gender: '男', birthDate }, '2026-10-12').birthDate
      ).toBeTruthy();
    }
  );
  it('独立验证性别与未来日期', () => {
    expect(
      validateRegistrationDemographics({ gender: '', birthDate: '2026-10-13' }, '2026-10-12')
    ).toEqual({ gender: expect.any(String), birthDate: expect.any(String) });
  });
});

it('以调用方北京时间日期边界判定未来', () => {
  expect(
    validateRegistrationDemographics({ gender: '男', birthDate: '2026-10-13' }, '2026-10-12')
      .birthDate
  ).toBeTruthy();
  expect(
    validateRegistrationDemographics({ gender: '男', birthDate: '2026-10-13' }, '2026-10-13')
  ).toEqual({});
});
