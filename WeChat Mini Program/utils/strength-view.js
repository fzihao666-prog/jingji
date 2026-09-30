const { number, strengthMetricRows, STRENGTH_METRICS } = require('./format');
const { shortDate } = require('./date');

const list = (value) => Array.isArray(value) ? value : [];
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const display = (value, suffix = '') => numeric(value) ? `${number(value)}${suffix}` : '—';
const filled = (value) => value !== null && value !== undefined && value !== '';

// 与 shared/strength-training.ts 的网页端分类规则保持一致，由对照测试约束。
const CONTENT_RULES = [
  ['动作准备', /动作准备|准备活动|热身|激活|动态拉伸|关节活动/],
  ['交叉训练', /交叉训练|交叉体能|crossfit|cross-training/i],
  ['拉伸再生', /拉伸|再生|恢复|放松|泡沫轴|理疗/],
  ['循环训练', /循环训练|循环力量|力量耐力|肌耐力|重复力量/],
  ['最大力量', /最大力量|大重量|深蹲|硬拉|卧推|卧拉/],
  ['爆发力', /爆发力|速度力量|高拉|抓举|挺举|跳箱|快速力量/],
  ['核心力量', /核心力量|核心稳定|平板|支撑|卷腹|抗旋|死虫|鸟狗/],
  ['功能训练', /功能训练|功能性|协调|灵敏|平衡|药球|壶铃/]
];
const CONTENT_ORDER = ['交叉训练', '功能训练', '拉伸再生', '循环训练', '最大力量', '爆发力', '核心力量', '动作准备'];

function contentCategory(session, set) {
  const text = [session.sessionLabel, session.trainingType, session.structureType, set.exerciseName, set.trainingCategory].filter(Boolean).join(' ');
  const match = CONTENT_RULES.find((rule) => rule[1].test(text));
  return match ? match[0] : null;
}

function structureView(sessions) {
  const counts = new Map(CONTENT_ORDER.map((name) => [name, 0]));
  let total = 0;
  let excluded = 0;
  sessions.forEach((session) => list(session.sets).forEach((set) => {
    const category = contentCategory(session, set);
    if (!category) { excluded += 1; return; }
    counts.set(category, counts.get(category) + 1);
    total += 1;
  }));
  return {
    structure: CONTENT_ORDER.filter((name) => counts.get(name)).map((name) => ({ name, count: counts.get(name), rate: number(counts.get(name) / total * 100), width: counts.get(name) / total * 100 })),
    structureNote: `按已记录训练项次数统计，共 ${total} 项；${excluded} 项未归类或不在八类范围内，不参与占比。`
  };
}

function planView(plans, planIndex = 0, weekIndex = 0, category = '全部') {
  const plan = plans[planIndex];
  const data = plan && plan.data;
  const exercises = list(data && data.exercises);
  const weekKeys = [...new Set([...list(data && data.weekKeys), ...exercises.flatMap((exercise) => list(exercise.lines).flatMap((line) => Object.keys(line.weeks || {})))])];
  const selectedWeek = weekKeys[weekIndex];
  const categories = ['全部', ...new Set(exercises.map((exercise) => exercise.category || '未分类'))];
  return {
    planIndex, weekIndex, categoryIndex: Math.max(0, categories.indexOf(category)), categories,
    planTitle: data ? data.title || '体能训练计划' : '',
    planPeriod: data ? `${data.startDate || '—'} 至 ${data.endDate || '—'}` : '',
    planSummary: data ? data.summary || data.scheduleLabel || '' : '',
    weekLabels: weekKeys.map((key) => data.weekLabels && data.weekLabels[key] || `第${key}周`),
    planExercises: exercises.filter((exercise) => category === '全部' || (exercise.category || '未分类') === category).map((exercise, index) => ({
      id: exercise.id || String(index), name: exercise.name || '未命名动作',
      category: exercise.category || '未分类', max: display(exercise.maxWeight, ' kg'), note: exercise.unitNote || '',
      rows: list(exercise.lines).flatMap((line, rowIndex) => {
        const entry = line.weeks && line.weeks[selectedWeek];
        if (!entry) return [];
        return [{ id: line.id || String(rowIndex), arrangement: entry.arrangement || '安排未填写',
          prescription: `${filled(entry.sets) ? entry.sets : '—'} 组 × ${filled(entry.reps) ? entry.reps : '—'} 次`,
          percentage: display(entry.percentage, '%'),
          weight: numeric(exercise.maxWeight) && numeric(entry.percentage) ? display(exercise.maxWeight * entry.percentage / 100, ' kg') : '—',
          completed: filled(entry.actualCompleted) ? entry.actualCompleted : '—'
        }];
      })
    })),
    expandedExercise: ''
  };
}

function recordView(sessions, date = '', limit = 12, expandedRecord = '') {
  const filtered = date ? sessions.filter((session) => session.trainingDate === date) : sessions;
  return {
    recordDate: date, recordLimit: limit, expandedRecord,
    recordCount: filtered.length, hasMoreRecords: filtered.length > limit,
    records: filtered.slice(0, limit).map((session) => ({
      id: String(session.id), title: session.sessionLabel || session.trainingType || '体能训练', date: session.trainingDate,
      meta: `${display(session.durationMin, ' min')} · RPE ${display(session.rpe)} · ${list(session.sets).length} 组记录`,
      load: display(session.srpe, ' AU'),
      source: ({ ai_import: 'AI识别', file_import: '文件导入', athlete_self_report: '本人填报', coach_report: '教练填报' })[session.source] || '手动录入',
      sets: String(session.id) === expandedRecord ? list(session.sets).map((set, index) => ({
        id: String(set.id || index), name: set.exerciseName || '未命名动作',
        planned: `${display(set.targetReps)} 次 · ${display(set.plannedWeightKg)} kg`,
        actual: `${display(set.actualReps)} 次 · ${display(set.actualWeightKg)} kg`,
        intensity: display(set.intensityPercent, '%'), duration: display(set.durationMin, ' min'), rpe: display(set.rpe),
        completed: set.completed === true || set.completed === 1 ? '已完成' : set.completed === false || set.completed === 0 ? '未完成' : '未记录'
      })) : []
    }))
  };
}

function metricView(tests, key, period) {
  const definition = STRENGTH_METRICS[key];
  const all = tests.filter((test) => test.metrics && numeric(test.metrics[key])).sort((a, b) => a.testDate.localeCompare(b.testDate));
  const rows = all.filter((test) => test.testDate >= period.from && test.testDate <= period.to);
  // 与网页当前指标趋势一致，展示最高历史实测值；不把形态、心率等指标判为“越高越好”。
  const best = all.length ? Math.max(...all.map((test) => test.metrics[key])) : null;
  const max = Math.max(1, ...rows.map((test) => Math.abs(test.metrics[key])));
  return {
    metricUnit: definition ? definition[1] : '', metricBest: display(best),
    metricHistory: rows.map((test, index) => ({ id: `${test.id || index}`, date: test.testDate, value: display(test.metrics[key]), width: Math.abs(test.metrics[key]) / max * 100 })),
    metricChange: rows.length > 1 ? display(rows[rows.length - 1].metrics[key] - rows[0].metrics[key]) : '—'
  };
}

function totalValue(sessions, key) {
  const values = sessions.map((session) => session[key]).filter(numeric);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function overviewView(tests, sessions, scope) {
  const periodTests = tests.filter((test) => test.testDate >= scope.from && test.testDate <= scope.to);
  const latestTest = [...(periodTests.length ? periodTests : tests)].sort((a, b) => b.testDate.localeCompare(a.testDate))[0];
  const metrics = strengthMetricRows(latestTest).filter((metric) => Number.isFinite(Number(metric.value)));
  const duration = totalValue(sessions, 'durationMin');
  const load = totalValue(sessions, 'srpe');
  const dates = [...new Set(sessions.map((session) => session.trainingDate))].sort();
  const daily = dates.map((date) => {
    const rows = sessions.filter((session) => session.trainingDate === date);
    return { date, duration: totalValue(rows, 'durationMin'), load: totalValue(rows, 'srpe') };
  });
  const maxDuration = Math.max(1, ...daily.map((row) => row.duration || 0));
  const maxLoad = Math.max(1, ...daily.map((row) => row.load || 0));
  return {
    metrics, latestTestDate: latestTest ? latestTest.testDate : '',
    latestTestOutsidePeriod: Boolean(latestTest && !periodTests.length),
    championMetrics: metrics.slice(0, 4),
    summaryCards: [
      { label: '训练次数', value: sessions.length, unit: '场' },
      { label: '训练时长', value: display(duration === null ? null : duration / 60), unit: 'h' },
      { label: 'SRPE负荷', value: display(load), unit: 'AU' },
      { label: '完成训练组', value: sessions.reduce((sum, session) => sum + list(session.sets).filter((set) => set.completed === true || set.completed === 1).length, 0), unit: '组' }
    ],
    trend: daily.filter((row) => row.duration !== null || row.load !== null).map((row) => ({
      ...row, label: shortDate(row.date),
      durationText: display(row.duration), loadText: display(row.load),
      durationHeight: row.duration === null ? 0 : row.duration / maxDuration * 100,
      loadHeight: row.load === null ? 0 : row.load / maxLoad * 100,
      ariaLabel: `${row.date}，时长 ${display(row.duration)} 分钟，SRPE负荷 ${display(row.load)} AU`
    })),
    ...structureView(sessions)
  };
}

module.exports = { planView, recordView, metricView, overviewView, contentCategory };
