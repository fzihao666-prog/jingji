const { todayBeijing, toDateString } = require('./date');

// 恢复日报允许回填最近7天（含今天）；与 server/athlete/self-daily-service.ts 的字段与量纲保持一致。
const WELLNESS_BACKFILL_DAYS = 7;

const METRICS = [
  { key: 'sleepHours', label: '睡眠时长', unit: 'h', suffix: '小时', min: 0, max: 24, placeholder: '例如 7.5' },
  { key: 'sleepQuality', label: '睡眠质量', unit: '分', suffix: '分', min: 0, max: 10, placeholder: '0 至 10' },
  { key: 'morningPulse', label: '晨脉', unit: 'bpm', suffix: 'bpm', min: 25, max: 250, placeholder: '例如 58' },
  { key: 'weightKg', label: '体重', unit: 'kg', suffix: 'kg', min: 20, max: 250, placeholder: '例如 61.5' },
  { key: 'fatigueIndex', label: '疲劳程度', unit: '分', suffix: '分', min: 0, max: 10, placeholder: '0 至 10' },
  { key: 'sorenessIndex', label: '酸痛程度', unit: '分', suffix: '分', min: 0, max: 10, placeholder: '0 至 10' },
  { key: 'moodIndex', label: '心情', unit: '分', suffix: '分', min: 0, max: 10, placeholder: '0 至 10' }
];

// status 只接受本人自评的两种口径；attention/alert/missing 属于导入与教练侧分类。
const STATUS_OPTIONS = [
  { value: 'normal', label: '正常训练' },
  { value: 'rest', label: '需要休息' }
];

// 疲劳/酸痛快捷选择：映射到 0-10 数值，加速手机端填写。
const QUICK_SELECT = {
  fatigueIndex: [
    { label: '轻松', value: 2 },
    { label: '一般', value: 5 },
    { label: '疲劳', value: 8 }
  ],
  sorenessIndex: [
    { label: '无酸痛', value: 1 },
    { label: '轻微', value: 4 },
    { label: '明显', value: 7 }
  ]
};

function wellnessDates() {
  const today = todayBeijing();
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - (WELLNESS_BACKFILL_DAYS - 1));
  return { min: toDateString(earliest), max: today, today };
}

function defaultWellnessForm() {
  const { today } = wellnessDates();
  const form = { date: today, statusIndex: 0 };
  METRICS.forEach((metric) => {
    form[metric.key] = '';
  });
  return form;
}

function metricText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// 空字符串按未填写处理；整表提交时省略字段即表示清空该项。
function metricValue(value, metric) {
  const text = metricText(value);
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < metric.min || numeric > metric.max) {
    throw new Error(`${metric.label}应为${metric.min}至${metric.max}${metric.suffix}。`);
  }
  return numeric;
}

// 校验并组装 POST /api/me/wellness 的请求体；校验规则与服务端逐条对应，
// 但只作为界面提示，最终仍由服务端拒绝非法数据。
function wellnessPayload(input) {
  const form = input || {};
  const { min, max } = wellnessDates();
  const date = String(form.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < min || date > max) {
    throw new Error(`恢复日报只能填写最近${WELLNESS_BACKFILL_DAYS}天（含今天）的数据。`);
  }
  const payload = { date };
  let filled = 0;
  METRICS.forEach((metric) => {
    const value = metricValue(form[metric.key], metric);
    if (value !== null) filled += 1;
    payload[metric.key] = value;
  });
  if (!filled) throw new Error('至少填写一项恢复数据。');
  const statusIndex = Number(form.statusIndex) || 0;
  const status = STATUS_OPTIONS[statusIndex] ? STATUS_OPTIONS[statusIndex].value : null;
  if (!status) throw new Error('请选择今日训练状态。');
  payload.status = status;
  return payload;
}

// 已有记录回填到表单：数字统一转成字符串，未填写项保持空串。
function wellnessFormFromRecord(record, date) {
  const form = defaultWellnessForm();
  const target = String(date || form.date);
  // 表单日期始终跟随当前查看的日期，不能被默认值（今天）覆盖。
  form.date = target;
  if (!record || record.date !== target) return form;
  METRICS.forEach((metric) => {
    const value = metricText(record[metric.key]);
    form[metric.key] = value;
  });
  const statusIndex = STATUS_OPTIONS.findIndex((option) => option.value === record.status);
  form.statusIndex = statusIndex >= 0 ? statusIndex : 0;
  return form;
}

// 首页与填写页的恢复日报摘要；不生成评分，只汇总已填写的原始数值。
function wellnessRecordView(record) {
  if (!record) {
    return {
      filled: false,
      filledLabel: '未填写',
      note: '今日恢复日报尚未填写。',
      summary: '',
      statusLabel: ''
    };
  }
  const parts = METRICS.filter((metric) => metricText(record[metric.key]) !== '').map(
    (metric) => `${metric.label} ${metricText(record[metric.key])}${metric.unit}`
  );
  const status = STATUS_OPTIONS.find((option) => option.value === record.status);
  return {
    filled: true,
    filledLabel: '已填写',
    note: `${record.date} 已提交恢复日报`,
    summary: parts.join(' · '),
    statusLabel: status ? status.label : ''
  };
}

module.exports = {
  WELLNESS_BACKFILL_DAYS,
  METRICS,
  STATUS_OPTIONS,
  QUICK_SELECT,
  wellnessDates,
  defaultWellnessForm,
  wellnessPayload,
  wellnessFormFromRecord,
  wellnessRecordView
};
