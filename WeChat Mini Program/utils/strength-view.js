const { number, strengthMetricRows, STRENGTH_METRICS } = require('./format');
const { shortDate } = require('./date');

const list = (value) => Array.isArray(value) ? value : [];
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const display = (value, suffix = '') => numeric(value) ? `${number(value)}${suffix}` : '—';
const filled = (value) => value !== null && value !== undefined && value !== '';

// 训练结构固定五类（与 shared/strength-training.ts 的 STRENGTH_TRAINING_CATEGORIES 一致），由对照测试约束。
const STRUCTURE_CATEGORIES = ['基础力量', '功能性体能', '核心力量', '专项力量', '代谢训练'];

// 明细未填训练分类（或不在字典内）时按动作名推断，规则镜像 shared 的 inferStrengthCategory。
function inferStructureCategory(exerciseName) {
  const name = String(exerciseName || '').trim();
  if (/平板|支撑|核心|卷腹|抗旋|死虫|鸟狗/.test(name)) return '核心力量';
  if (/跑|冲刺|间歇|跳绳|自行车|游泳|测功|有氧|无氧|乳酸/.test(name)) return '代谢训练';
  if (/划|拉桨|专项|出发|船|艇|传球|挥拍/.test(name)) return '专项力量';
  if (/单腿|药球|壶铃|跳箱|平衡|敏捷|功能/.test(name)) return '功能性体能';
  return '基础力量';
}

// 训练分类以明细事实字段 trainingCategory 为准，缺失才按动作名推断。
function structureCategory(set) {
  const source = set || {};
  const declared = String(source.trainingCategory || '').trim();
  return STRUCTURE_CATEGORIES.includes(declared) ? declared : inferStructureCategory(source.exerciseName);
}

function structureView(sessions) {
  const counts = new Map(STRUCTURE_CATEGORIES.map((name) => [name, 0]));
  let total = 0;
  sessions.forEach((session) => list(session.sets).forEach((set) => {
    const category = structureCategory(set);
    counts.set(category, counts.get(category) + 1);
    total += 1;
  }));
  // 五类固定展示、0 值行保留，训练结构始终完整；无明细时保持空状态。
  return {
    structure: total
      ? STRUCTURE_CATEGORIES.map((name) => {
          const count = counts.get(name);
          return { name, count, rate: number(count / total * 100), width: count / total * 100 };
        })
      : [],
    structureNote: `按已记录训练项次数统计，共 ${total} 项；优先取训练明细的训练分类，缺失时按动作名归类。`
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

module.exports = { planView, recordView, metricView, overviewView, structureCategory };
