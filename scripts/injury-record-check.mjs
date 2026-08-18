const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8792';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function login(username) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo123' })
  });
  if (result.status !== 200) throw new Error(`${username}登录失败`);
  return result.payload;
}

const athleteLogin = await login('athlete01');
const adminLogin = await login('admin01');
const athleteId = athleteLogin.user.athleteId;
const adminHeaders = { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' };
const athleteHeaders = { Authorization: `Bearer ${athleteLogin.token}`, 'Content-Type': 'application/json' };

const formal = await request(`/api/athletes/${athleteId}/injuries`, {
  method: 'POST', headers: adminHeaders,
  body: JSON.stringify({
    injuryName: '右肩训练性不适', bodyPart: '肩部', side: 'right', status: 'restricted',
    painScore: 4, onsetDate: '2026-07-28', restrictions: '暂停大重量卧拉',
    rehabPlan: '肩袖激活，每日2次', reviewDate: '2026-08-05', note: '测试记录'
  })
});
if (formal.status !== 201 || formal.payload.record.recordType !== 'formal') throw new Error(`正式记录创建失败：${JSON.stringify(formal)}`);

const feedback = await request(`/api/athletes/${athleteId}/injuries`, {
  method: 'POST', headers: athleteHeaders,
  body: JSON.stringify({
    injuryName: '划桨时右肩仍有酸痛', bodyPart: '肩部', side: 'right', status: 'healthy',
    painScore: 3, onsetDate: '2026-07-31', restrictions: '运动员无权设置',
    rehabPlan: '运动员无权设置', reviewDate: '', note: '热身后减轻'
  })
});
if (feedback.status !== 201 || feedback.payload.record.recordType !== 'feedback' || feedback.payload.record.status !== 'observation' || feedback.payload.record.restrictions) {
  throw new Error(`运动员反馈权限处理失败：${JSON.stringify(feedback)}`);
}

const list = await request(`/api/athletes/${athleteId}/injuries`, { headers: athleteHeaders });
const forbidden = await request(`/api/athletes/${athleteId + 999}/injuries`, { headers: athleteHeaders });
if (list.status !== 200 || list.payload.records.length !== 2 || forbidden.status !== 403) throw new Error('伤病记录查询或隔离验证失败');

console.log(JSON.stringify({
  formalRecord: formal.payload.record.id,
  feedbackRecord: feedback.payload.record.id,
  historyCount: list.payload.records.length,
  athleteCrossAccessStatus: forbidden.status,
  athleteForcedStatus: feedback.payload.record.status,
  athleteRestrictionsStored: feedback.payload.record.restrictions
}, null, 2));
