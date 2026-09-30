// 专项/体能测试现场录入表单：纯逻辑校验与请求体组装，服务端仍做最终校验。
const { strengthMetrics } = require('../data/format-data');

// 力量指标录入行：key 与服务端 STRENGTH_METRICS 对齐，label/unit 来自字典。
const STRENGTH_FIELDS = Object.keys(strengthMetrics).map((key) => ({
  key,
  label: strengthMetrics[key][0],
  unit: strengthMetrics[key][1]
}));

function defaultStrengthForm() {
  const form = { testDate: '', notes: '' };
  STRENGTH_FIELDS.forEach((field) => { form[field.key] = ''; });
  return form;
}

// 数字输入允许空串（不填）；越界或非数字抛出中文错误提示。
function strengthNumber(text, field) {
  const value = String(text === null || text === undefined ? '' : text).trim();
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${field.label}应为非负数字。`);
  }
  return Math.round(numeric * 10) / 10;
}

function strengthPayload(input) {
  const form = input || {};
  const testDate = String(form.testDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testDate)) throw new Error('请选择测试日期。');
  const metrics = {};
  let filled = 0;
  STRENGTH_FIELDS.forEach((field) => {
    const value = strengthNumber(form[field.key], field);
    if (value !== null) {
      metrics[field.key] = value;
      filled += 1;
    }
  });
  if (!filled) throw new Error('至少填写一项实测数据。');
  return {
    testDate,
    notes: String(form.notes || '').trim(),
    metrics
  };
}

const SPECIAL_ATTEMPT_COUNT = 3;

function defaultSpecialForm() {
  return {
    testDate: '',
    distanceM: '',
    boatClass: '',
    genderGroup: '',
    session: '',
    windConditions: '',
    location: '',
    note: '',
    crewName: '',
    memberIds: [],
    attempts: ['', '', ''],
    previousBestText: ''
  };
}

// 成绩支持 "0:55.15" 或 "55.15"；由服务端 parseRaceTime 统一解析毫秒。
function specialAttemptText(text) {
  const value = String(text === null || text === undefined ? '' : text).trim();
  if (!value) return '';
  if (!/^\d{1,2}(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value)) {
    throw new Error('成绩格式应为 0:55.15 或 55.15。');
  }
  return value;
}

function specialPayload(input) {
  const form = input || {};
  const testDate = String(form.testDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testDate)) throw new Error('请选择测试日期。');
  const distanceM = Number(String(form.distanceM || '').trim());
  if (!Number.isInteger(distanceM) || distanceM < 1 || distanceM > 100000) {
    throw new Error('测试距离应为1—100000米的整数。');
  }
  const crewName = String(form.crewName || '').trim();
  if (!crewName) throw new Error('请填写运动员或组合名称。');
  const memberIds = (form.memberIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!memberIds.length) throw new Error('请选择至少一名成员运动员。');
  const attemptsText = (form.attempts || [])
    .slice(0, SPECIAL_ATTEMPT_COUNT)
    .map(specialAttemptText)
    .filter(Boolean);
  if (!attemptsText.length) throw new Error('至少填写一轮成绩。');
  return {
    project: String(form.project || '').trim(),
    testDate,
    distanceM,
    boatClass: String(form.boatClass || '').trim() || '未分组',
    genderGroup: String(form.genderGroup || '').trim() || '未分组',
    session: String(form.session || '').trim(),
    windConditions: String(form.windConditions || '').trim(),
    location: String(form.location || '').trim(),
    note: String(form.note || '').trim(),
    crewName,
    memberAthleteIds: memberIds,
    previousBestText: specialAttemptText(form.previousBestText),
    attemptsText
  };
}

module.exports = {
  STRENGTH_FIELDS,
  SPECIAL_ATTEMPT_COUNT,
  defaultStrengthForm,
  strengthPayload,
  defaultSpecialForm,
  specialPayload
};
