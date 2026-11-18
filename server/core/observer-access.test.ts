import { describe, expect, it } from 'vitest';
import { observerRequestAllowed, observerResponse } from './observer-access.ts';

describe('外部阅览接口边界', () => {
  it.each([
    '/api/access/accounts',
    '/api/admin/teams',
    '/api/athletes/1/injuries',
    '/api/athletes/1/reports/preview',
    '/api/training-plans/1/export',
    '/api/athletes/1/reports/12345678-1234-1234-1234-123456789abc/pdf',
    '/api/unknown-new-feature',
  ])('默认拒绝内部接口或下载 %s', (path) => {
    expect(observerRequestAllowed('GET', path)).toBe(false);
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('拒绝业务写入 %s', (method) => {
    expect(observerRequestAllowed(method, '/api/athletes/1/training-sessions')).toBe(false);
    expect(observerRequestAllowed(method, '/api/team-plans')).toBe(false);
  });
  it('保留阅览、正常退出与密码维护', () => {
    expect(observerRequestAllowed('GET', '/api/athletes/1/training-sessions')).toBe(true);
    expect(
      observerRequestAllowed('GET', '/api/athletes/1/reports/12345678-1234-1234-1234-123456789abc')
    ).toBe(true);
    expect(observerRequestAllowed('POST', '/api/auth/logout')).toBe(true);
    expect(observerRequestAllowed('POST', '/api/auth/change-password')).toBe(true);
  });
  it('剔除嵌套历史快照的私人信息和内部自由备注，保留训练数值', () => {
    expect(
      observerResponse({
        athletes: [
          {
            id: 1,
            name: '甲',
            phone: 'private',
            homeAddress: 'private',
            notes: '内部诊断',
            coaches: '教练甲',
          },
        ],
        data: {
          totals: { duration: 10 },
          injuries: [{ note: 'private' }],
          nested: { identityNumber: 'private', phone: 'private' },
        },
        commentary: { highlights: ['私人医疗信息'], concerns: [], suggestions: [] },
      })
    ).toEqual({
      athletes: [{ id: 1, name: '甲', coaches: '教练甲' }],
      data: { totals: { duration: 10 }, nested: {} },
      commentary: { highlights: [], concerns: [], suggestions: [] },
    });
  });
});

it('观察员读取不包含导入与模型内部元数据', () => {
  expect(
    observerResponse({
      sessions: [
        {
          id: 1,
          sourceFilename: 'private.xlsx',
          modelUsed: 'internal',
          importedAt: 'private',
          sets: [{ actualReps: 5, importBatchId: 'internal', confidence: 0.9 }],
        },
      ],
    })
  ).toEqual({ sessions: [{ id: 1, sets: [{ actualReps: 5 }] }] });
});
