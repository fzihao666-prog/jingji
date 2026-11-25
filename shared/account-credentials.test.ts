import { expect, it } from 'vitest';
import { accountCredentialsSchema } from './account-credentials.js';

it('新账号必须明确提供非空凭据', () => {
  expect(accountCredentialsSchema.safeParse({ username: '', password: '' }).success).toBe(false);
  expect(
    accountCredentialsSchema.safeParse({ username: '    ', password: 'Secure123' }).success
  ).toBe(false);
});

it('规范化账号，保留密码原值并限制账号字符', () => {
  expect(accountCredentialsSchema.parse({ username: ' User_01 ', password: 'Secure123' })).toEqual({
    username: 'user_01',
    password: 'Secure123',
  });
  expect(
    accountCredentialsSchema.safeParse({ username: '账号测试', password: 'Secure123' }).success
  ).toBe(false);
});

it.each(['Secure123 ', ' Secure123', 'a'.repeat(73), 'abc123汉'.repeat(9), 'abcdefgh', '12345678'])(
  '拒绝不符合规则的初始密码 %#',
  (password) => {
    expect(accountCredentialsSchema.safeParse({ username: 'user_01', password }).success).toBe(
      false
    );
  }
);
