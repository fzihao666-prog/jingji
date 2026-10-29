import type { TeamWeeklyReport } from '../../shared/team-weekly-report.ts';
/** 保守的正向词表：未知词、身份、联系方式、健康叙述整段留本地，不能把姓名替换视为全面去身份化。 */
const words = [
  '夏训',
  '冬训',
  '春训',
  '秋训',
  '本周',
  '下周',
  '上周',
  '目前',
  '处于',
  '为',
  '是',
  '以',
  '训练',
  '恢复训练',
  '基础训练',
  '专项训练',
  '体能训练',
  '力量训练',
  '核心训练',
  '耐力训练',
  '速度训练',
  '准备活动',
  '动作控制',
  '赛前',
  '赛后',
  '调整阶段',
  '调整',
  '阶段',
  '目标',
  '重点',
  '主要',
  '保持',
  '维持',
  '安排',
  '增加',
  '减少',
  '降低',
  '提高',
  '继续',
  '观察',
  '暂不',
  '急于',
  '训练量',
  '训练负荷',
  '负荷',
  '强度',
  '重量',
  '次数',
  '组数',
  '课次',
  '完成',
  '情况',
  '训练课',
  '第一堂',
  '第二堂',
  '第一节',
  '第二节',
  '课后',
  '课',
  '后',
  '前',
  '的',
  '与',
  '和',
  '及',
  '在',
  '了',
  '对',
  '有',
  '较',
  '比较',
  '明显',
  '逐渐',
  '适应',
  '改善',
  '反应',
  '动作质量',
  '动作',
  '质量',
  '进行',
  '控制',
  '热身',
  '拉伸',
  '放松',
  '有氧训练',
  '无氧训练',
  '收假后',
  '收假',
  '第一周',
  '第二周',
  '最后',
  '保持不变',
  '不变',
  '不增加',
  '减量',
  '巩固',
  '技术',
  '节奏',
  '协调',
  '稳定性',
  '爆发力',
  '最大力量',
  '力量耐力',
  '卧推',
  '卧拉',
  '深蹲',
  '硬拉',
  '水上',
  '陆上',
  '测功仪',
  '跑步',
  '骑行',
  '游泳',
  '分钟',
  '小时',
  '公里',
  '千米',
  '米',
  '次',
  '组',
  '节',
  '堂',
  '共',
  '计划',
  '目标量',
  '实际量',
  '建议',
  '根据',
  '已发布',
  '训练安排',
  '个',
  '两',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '一',
  '二',
  '零',
  '逐步',
  '能够',
  '需要',
  '希望',
  '主要目的',
  '内容',
  '为主',
].sort((a, b) => b.length - a.length);
export function weeklyObservation(report: TeamWeeklyReport) {
  const notes = report.coachNotes.trim();
  if (!notes) return { text: null, message: '' };
  const names = [report.teamName, ...report.athletes.map((a) => a.name)].filter(Boolean);
  if (
    names.some((name) => notes.includes(name)) ||
    /\d{7,}|@|https?:|身份证|电话|微信|伤|病|疼|痛|睡眠|晨脉|体重|疲劳|酸|医生|康复|CT|血/i.test(
      notes
    )
  )
    return {
      text: null,
      message: '教练补充含身份、健康或联系信息，已保留在本地报告，未发送给 AI。',
    };
  let rest = notes;
  while (rest) {
    const numberedWeek = rest.match(/^第[一二三四五六七八九十零\d]+周/u);
    if (numberedWeek) {
      rest = rest.slice(numberedWeek[0].length);
      continue;
    }
    const punctuation = rest.match(/^[\s，。；：、！？,.!?:;（）()—\-\d%]+/u);
    if (punctuation) {
      rest = rest.slice(punctuation[0].length);
      continue;
    }
    const word = words.find((w) => rest.startsWith(w));
    if (!word)
      return {
        text: null,
        message: '教练补充未能可靠分离为可发送的训练观察，已保留在本地报告，未发送给 AI。',
      };
    rest = rest.slice(word.length);
  }
  return { text: notes, message: '' };
}
export function weeklyObservationWarnings(report: TeamWeeklyReport): string[] {
  const match = report.coachNotes.match(
    /(?:训练课次|队伍课次)\s*(?:为|共|是|：|:)?\s*(\d+)\s*(?:次|节|堂)?/u
  );
  return match && Number(match[1]) !== report.totals.sessions
    ? [
        `教练补充提到${match[1]}个训练课次，系统记录为${report.totals.sessions}个，请核对口径；统计值未改写。`,
      ]
    : [];
}
