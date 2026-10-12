export const REGISTRATION_GENDERS = ['男', '女'] as const;

export function validateRegistrationDemographics(
  input: { gender: unknown; birthDate: unknown },
  today: string
): Partial<Record<'gender' | 'birthDate', string>> {
  const errors: Partial<Record<'gender' | 'birthDate', string>> = {};
  if (input.gender !== '男' && input.gender !== '女') errors.gender = '请选择性别';
  const value = input.birthDate;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.birthDate = '请选择有效出生日期';
  } else {
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      errors.birthDate = '请选择有效出生日期';
    } else if (value > today) errors.birthDate = '出生日期不能晚于今天';
  }
  return errors;
}
