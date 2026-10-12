import { describe, expect, it, vi } from 'vitest';

vi.mock('../core/db.ts', () => ({ db: {}, upsertAthleteOrigin: vi.fn() }));
import { readAthleteAdminPayload, selfAthleteProfileSchema } from './athlete-module.ts';

const input = {
  name: '测试运动员',
  gender: '女',
  birthDate: '2000-02-29',
};

describe('运动员资料数据最小化', () => {
  it.each(['identityNumber', 'identity_number'])('管理资料不收集历史字段 %s', (field) => {
    const payload = readAthleteAdminPayload({ ...input, [field]: '不应采集' });
    expect(payload).not.toHaveProperty(field);
    expect(payload).toMatchObject(input);
  });
  it.each(['identityNumber', 'identity_number'])('个人资料拒绝历史字段 %s', (field) => {
    const payload: Record<string, unknown> = readAthleteAdminPayload(input);
    delete payload.coachId;
    expect(selfAthleteProfileSchema.safeParse(payload).success).toBe(true);
    expect(selfAthleteProfileSchema.safeParse({ ...payload, [field]: '不应采集' }).success).toBe(
      false
    );
  });
});
