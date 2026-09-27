const { todayBeijing } = require('./date');

// 与服务端 server/athlete/athlete-module.ts 的 injuryStatuses / injurySides 保持一致。
const STATUS_OPTIONS = [
  { value: 'healthy', label: '健康' },
  { value: 'observation', label: '观察' },
  { value: 'restricted', label: '受限' },
  { value: 'rehab', label: '康复' },
  { value: 'suspended', label: '停训' },
];

const SIDE_OPTIONS = [
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
  { value: 'bilateral', label: '双侧' },
  { value: 'center', label: '中间' },
  { value: 'unspecified', label: '部位不详' },
];

const BODY_PART_OPTIONS = [
  '肩部',
  '颈部',
  '背部',
  '腰部',
  '肘部',
  '腕部',
  '手部',
  '髋部',
  '大腿',
  '膝部',
  '小腿',
  '踝部',
  '足部',
  '头部',
  '其他',
];

const CUSTOM_BODY_PART = '其他';
const PAIN_OPTIONS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function requiredDate(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`请选择${label}。`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label}格式错误。`);
  }
  return text;
}

function optionalDate(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  return requiredDate(text, label);
}

function boundedText(value, label, max, requiredMessage) {
  const text = String(value || '').trim();
  if (!text) {
    if (requiredMessage) throw new Error(requiredMessage);
    return '';
  }
  if (text.length > max) throw new Error(`${label}内容过长。`);
  return text;
}

// 校验并组装 POST /api/athletes/:id/injuries 的请求体；校验规则与服务端逐条对应，
// 但只作为界面提示，最终仍由服务端拒绝非法数据。
function buildInjuryPayload(input) {
  const isSelfFeedback = Boolean(input.isSelfFeedback);
  const payload = {};

  const selectedBodyPart = String(input.bodyPart || '').trim();
  if (!BODY_PART_OPTIONS.includes(selectedBodyPart))
    throw new Error('请选择或填写有效的伤病部位。');
  const bodyPart =
    selectedBodyPart === CUSTOM_BODY_PART
      ? boundedText(input.bodyPartCustom, '伤病部位', 30, '请填写伤病部位。')
      : selectedBodyPart;
  if (!bodyPart || bodyPart.length > 30) throw new Error('请选择或填写有效的伤病部位。');
  payload.bodyPart = bodyPart;

  payload.injuryName = boundedText(
    input.injuryName,
    '问题名称',
    80,
    isSelfFeedback ? '请填写不适情况。' : '请填写问题名称或诊断。'
  );

  const side = String(input.side || '');
  if (!SIDE_OPTIONS.some((option) => option.value === side))
    throw new Error('请选择有效的身体侧别。');
  payload.side = side;

  const painScore = Number(input.painScore);
  if (!Number.isInteger(painScore) || painScore < 0 || painScore > 10) {
    throw new Error('疼痛评分应为0至10的整数。');
  }
  payload.painScore = painScore;

  payload.onsetDate = requiredDate(input.onsetDate, '首次出现日期');
  payload.reviewDate = optionalDate(input.reviewDate, '复查日期');
  payload.note = boundedText(input.note, '备注', 800);

  // 运动员提交的是疼痛反馈：状态由服务端强制为“观察”，限制与康复计划不属于本人字段。
  if (!isSelfFeedback) {
    const status = String(input.status || '');
    if (!STATUS_OPTIONS.some((option) => option.value === status))
      throw new Error('请选择有效的健康状态。');
    payload.status = status;
    payload.restrictions = boundedText(input.restrictions, '训练限制', 500);
    payload.rehabPlan = boundedText(input.rehabPlan, '康复计划', 500);
  }
  return payload;
}

function defaultInjuryForm() {
  return {
    bodyPartIndex: 0,
    bodyPartCustom: '',
    sideIndex: SIDE_OPTIONS.length - 1,
    statusIndex: 1,
    painIndex: 3,
    injuryName: '',
    onsetDate: todayBeijing(),
    reviewDate: '',
    reviewSet: false,
    restrictions: '',
    rehabPlan: '',
    note: '',
  };
}

module.exports = {
  STATUS_OPTIONS,
  SIDE_OPTIONS,
  BODY_PART_OPTIONS,
  CUSTOM_BODY_PART,
  PAIN_OPTIONS,
  buildInjuryPayload,
  defaultInjuryForm,
};
