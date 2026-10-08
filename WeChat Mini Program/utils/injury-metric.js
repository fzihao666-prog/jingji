const { STATUS_OPTIONS } = require('./injury-form');

// 周期核心数据「损伤情况」卡片：团队口径统计在册未愈损伤人数，个人口径展示当前状态。
// 状态取值与 injury-form（即服务端 injuryStatuses）共用一份口径。
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label]));

function injuryMetricView(injuries, isIndividual) {
  const rows = Array.isArray(injuries) ? injuries : [];
  const active = rows.filter((item) => item && item.status && item.status !== 'healthy');
  if (isIndividual) {
    const latest = rows[0] || null;
    if (active.length) {
      const current = active[0];
      const painText = current.painScore == null ? '' : ` · 疼痛 ${current.painScore} 分`;
      return {
        label: '损伤情况',
        value: STATUS_LABELS[current.status] || '关注',
        unit: '',
        note: `${current.injuryName || '伤病记录'}${painText}`,
        tone: 'tone-red',
      };
    }
    return {
      label: '损伤情况',
      value: '健康',
      unit: '',
      note: latest ? '最近一次记录已归为健康' : '暂无伤病记录',
      tone: 'tone-blue',
    };
  }
  if (!active.length) {
    return {
      label: '损伤情况',
      value: '0',
      unit: '人',
      note: '当前无未愈损伤',
      tone: 'tone-blue',
    };
  }
  // 服务端按疼痛评分降序返回，第一条即最需关注的个案。
  const top = active[0];
  return {
    label: '损伤情况',
    value: String(active.length),
    unit: '人',
    note: `${top.athleteName || '运动员'} · ${top.injuryName || '伤病记录'}`,
    tone: 'tone-red',
  };
}

module.exports = { injuryMetricView };
