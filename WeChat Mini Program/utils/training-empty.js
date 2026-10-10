const { number, STRENGTH_METRICS } = require('./format');
const { overviewView, planView, recordView, metricView } = require('./strength-view');
const { paginateList } = require('./pagination');

// 缺失值与合法的 0 分开处理，只转换展示，不改变统计口径。
function metricValue(value, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? number(value, digits) : '--';
}

function completeStrengthMetrics(rows) {
  const values = new Map(rows.map((row) => [row.key, row]));
  return Object.entries(STRENGTH_METRICS).map(([key, definition]) => values.get(key) || {
    key, label: definition[0], unit: definition[1], value: '--', target: '--', rate: '--', rateWidth: 0
  });
}

function emptyStrengthView() {
  const overview = overviewView([], [], { from: '', to: '' });
  return {
    ...overview, ...planView([]), ...recordView([]),
    ...metricView([], '', { from: '', to: '' }),
    summaryCards: overview.summaryCards.map((row) => ({ ...row, value: '--' })),
    metrics: completeStrengthMetrics([]), athleteName: '',
    planLabels: [], metricLabels: [], metricIndex: 0, metricRange: 0,
    metricRanges: ['当前周期', '全部历史'], recordDate: '', expandedRecord: '',
    trainingError: '', testError: '', planError: ''
  };
}

function athleteListView(athletes, query = '', page = 0) {
  const rows = (athletes || []).filter((row) => String(row.name || '').includes(query.trim()));
  const model = paginateList(rows, page);
  return { athleteRows: model.items, athletePager: model, athleteTotal: (athletes || []).length };
}

// 单个模块请求失败不遮住其他模块；错误原因仍明确展示，绝不冒充空数据。
async function sectionRequest(task, message) {
  try { return { value: await task(), error: '' }; }
  catch (error) {
    if (error && error.message === '未登录') throw error;
    return { value: null, error: error instanceof Error && error.message ? error.message : message };
  }
}

// 仅统一已有视图模型中的缺测标记，不改变原始数值及领域计算。
function displayMissing(value) {
  if (value === '—' || value === '未测') return '--';
  if (Array.isArray(value)) return value.map(displayMissing);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, displayMissing(entry)]));
  return value;
}

module.exports = { displayMissing, metricValue, completeStrengthMetrics, emptyStrengthView, athleteListView, sectionRequest };
