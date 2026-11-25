import { describe, expect, it, vi } from 'vitest';

vi.mock('../core/db.ts', () => ({ db: {}, upsertAthleteOrigin: vi.fn() }));
import {
  adminAthleteProfileSchema,
  readAthleteAdminPayload,
  selfAthleteProfileSchema,
} from './athlete-module.ts';

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

describe('旧运动员教练字段兼容校验', () => {
  const profile = { ...input, project: 'ROWING', team: '回归队' };

  it.each([undefined, null, '', 0, '0'])('未指定教练 %s 规范化为 0', (coachId) => {
    expect(adminAthleteProfileSchema.parse({ ...profile, coachId }).coachId).toBe(0);
  });

  it('兼容旧表单数字字符串且不裁剪其他合法档案字段', () => {
    expect(adminAthleteProfileSchema.parse({ ...profile, coachId: '12' })).toMatchObject({
      ...profile,
      coachId: 12,
    });
  });

  it.each(['NaN', '1e2', true, -1, 1.5, {}, []])('拒绝非法教练 ID %s', (coachId) => {
    expect(adminAthleteProfileSchema.safeParse({ ...profile, coachId }).success).toBe(false);
  });

  it('拒绝未知字段以防止绕过责任关系校验', () => {
    expect(adminAthleteProfileSchema.safeParse({ ...profile, coachIds: [1] }).success).toBe(false);
  });
});


describe('技术等级共用口径', () => {
  it.each(['未定级', '国家一级运动员', '一级', '国家运动健将'])('档案校验和读取一致支持 %s', level => {
    const parsed = adminAthleteProfileSchema.safeParse({ ...input, project: '赛艇', team: 'A队', technicalLevel: level });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(readAthleteAdminPayload(parsed.data).technicalLevel).toBe(parsed.data.technicalLevel);
  });
  it('未知技术等级拒绝，不静默清空', () => {
    expect(adminAthleteProfileSchema.safeParse({ ...input, project: '赛艇', team: 'A队', technicalLevel: '未知等级' }).success).toBe(false);
  });
});
