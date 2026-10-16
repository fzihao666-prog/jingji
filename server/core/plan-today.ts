import { trainingLoadCategory } from '../../shared/training-content-category.ts';

// 今日计划提取：从 training_plans.plan_data 的 weeklyPlans 天安排中取指定日期的课表，
// 与 plan-execution 的计划日判定同源（日期或周次 + 内容非空），不创造第二套计划口径。

// 与 core/utils.ts 的 strengthImportNumber 同口径；本模块保持纯逻辑，不引入数据库依赖。
function strengthImportNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const match = String(value)
    .trim()
    .replace(',', '.')
    .match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

export type TodayPlanItem = { name: string; detail: string };

export type TodayPlanDay = {
  title: string;
  focus: string;
  // 专项/体能按既有 trainingLoadCategory 口径归类；力量计划中无法识别的默认视为体能。
  specialItems: string[];
  physicalItems: string[];
  // 计划量仅在条目带可解析数值时汇总；全程无数据保持 null，不伪造 0。
  plannedDurationMin: number | null;
  plannedDistanceKm: number | null;
  items: TodayPlanItem[];
};

type PlanDaySource = Record<string, unknown>;
type PlanItemSource = Record<string, unknown>;

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function record(value: unknown): PlanDaySource {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlanDaySource)
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function itemsOf(day: PlanDaySource): PlanItemSource[] {
  const list = Array.isArray(day.exercises)
    ? day.exercises
    : Array.isArray(day.items)
      ? day.items
      : [];
  return list.map(record).filter((item) => text(item.name));
}

// 与 countPlannedDays 同口径：日期字段可含任意文本，抽取其中的 ISO 日期。
function dayDate(day: PlanDaySource) {
  const match = `${text(day.date)} ${text(day.dayLabel)}`.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function dayWeekLabel(day: PlanDaySource) {
  return text(day.dayOfWeek) || text(day.label);
}

function weekdayLabel(isoDate: string) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return WEEKDAY_LABELS[day] || '';
}

function matchesWeekday(label: string, isoDate: string) {
  const target = weekdayLabel(isoDate);
  if (!target || !label) return false;
  return label.replace('星期', '周').replace('礼拜', '周') === target;
}

function itemDetail(item: PlanItemSource) {
  const sets = text(item.sets);
  const reps = text(item.reps);
  const percentage = strengthImportNumber(item.percentage);
  const parts = [
    sets && reps ? `${sets}×${reps}` : sets || reps,
    percentage === null ? '' : `${percentage}%`,
    text(item.load) && `负荷 ${text(item.load)}`,
    text(item.duration) && `时长 ${text(item.duration)}`,
    text(item.distance) && `距离 ${text(item.distance)}`,
    text(item.intensity) && `强度 ${text(item.intensity)}`,
    text(item.pace) && `配速 ${text(item.pace)}`,
    text(item.notes),
  ];
  return [...new Set(parts.filter(Boolean))].join(' · ');
}

function buildDay(title: string, focus: string, items: PlanItemSource[]): TodayPlanDay {
  const specialItems: string[] = [];
  const physicalItems: string[] = [];
  const detailItems: TodayPlanItem[] = [];
  let durationSum = 0;
  let distanceSum = 0;
  let hasDuration = false;
  let hasDistance = false;
  for (const item of items) {
    const name = text(item.name);
    const detail = itemDetail(item);
    detailItems.push({ name, detail });
    const loadCategory = trainingLoadCategory({ content: `${name} ${text(item.notes)}` });
    if (loadCategory === 'special') {
      if (!specialItems.includes(name)) specialItems.push(name);
    } else if (!physicalItems.includes(name)) {
      physicalItems.push(name);
    }
    const duration = strengthImportNumber(item.duration);
    if (duration !== null) {
      durationSum += duration;
      hasDuration = true;
    }
    const distance = strengthImportNumber(item.distance);
    if (distance !== null) {
      distanceSum += distance;
      hasDistance = true;
    }
  }
  return {
    title,
    focus,
    specialItems,
    physicalItems,
    plannedDurationMin: hasDuration ? Math.round(durationSum * 10) / 10 : null,
    plannedDistanceKm: hasDistance ? Math.round(distanceSum * 10) / 10 : null,
    items: detailItems,
  };
}

/**
 * 提取某运动员指定日期的计划课表；无计划或计划未覆盖该日时返回 null。
 * 周次匹配：优先取计划周期内“当周”的同星期日；单周计划直接按星期匹配。
 */
export function extractTodayPlanDay(
  planDataJson: string,
  today: string,
  options: { startDate?: string; endDate?: string; title?: string } = {}
): TodayPlanDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const { startDate = '', endDate = '', title = '' } = options;
  if (startDate && today < startDate) return null;
  if (endDate && today > endDate) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(planDataJson || '{}');
  } catch {
    return null;
  }
  const teamSessions = record(raw).sessions;
  if (Array.isArray(teamSessions)) {
    const lessons = teamSessions.map(record).filter((item) => item.date === today);
    if (!lessons.length) return null;
    // 队伍计划：训练课带内容项时逐项展示（热身/主训练/整理放松），否则按整节训练课展示。
    const items: PlanItemSource[] = [];
    for (const lesson of lessons) {
      const metrics = {
        duration: lesson.durationMin == null ? '' : String(lesson.durationMin),
        distance: lesson.distanceKm == null ? '' : String(lesson.distanceKm),
        sets: lesson.sets == null ? '' : String(lesson.sets),
        reps: lesson.reps == null ? '' : String(lesson.reps),
        intensity: text(lesson.intensity),
        load: lesson.load == null ? '' : String(lesson.load),
      };
      const contentItems = Array.isArray(lesson.items)
        ? (lesson.items as unknown[]).map(record).filter((item) => text(item.title))
        : [];
      if (contentItems.length) {
        for (const item of contentItems) {
          items.push({
            name: text(item.title),
            notes: [text(item.description), text(lesson.content)].filter(Boolean).join(' · '),
            ...metrics,
          });
        }
      } else {
        items.push({ ...lesson, name: text(lesson.content), ...metrics });
      }
    }
    return buildDay(title, text(record(raw).focus), items);
  }
  const weeks = Array.isArray(record(raw).weeklyPlans)
    ? (record(raw).weeklyPlans as unknown[])
    : [];
  const todayLabel = weekdayLabel(today);
  let weekdayMatch: { day: PlanDaySource; weekFocus: string } | null = null;
  for (const weekValue of weeks) {
    const week = record(weekValue);
    const weekFocus = text(week.focus);
    const days = Array.isArray(week.days) ? (week.days as unknown[]) : [];
    for (const dayValue of days) {
      const day = record(dayValue);
      // 有内容才算计划日，与 countPlannedDays 一致。
      if (!itemsOf(day).length && !text(day.focus)) continue;
      if (dayDate(day) === today)
        return buildDay(title, text(day.focus) || weekFocus, itemsOf(day));
      if (!weekdayMatch && matchesWeekday(dayWeekLabel(day), today)) {
        weekdayMatch = { day, weekFocus };
      }
    }
  }
  // 无精确日期时：单周计划（或仅一处星期匹配）按星期取课表；多周歧义时不猜测。
  if (!weekdayMatch) return null;
  if (weeks.length > 1) {
    const currentWeek = currentWeekDays(weeks, today, startDate);
    const matchInWeek = currentWeek.find(
      (day) => itemsOf(day).length && matchesWeekday(dayWeekLabel(day), today)
    );
    if (matchInWeek)
      return buildDay(
        title,
        text(matchInWeek.focus) || weekdayMatch.weekFocus,
        itemsOf(matchInWeek)
      );
    return null;
  }
  return buildDay(
    title,
    text(weekdayMatch.day.focus) || weekdayMatch.weekFocus,
    itemsOf(weekdayMatch.day)
  );
}

// 当周天列表：按周序号（weekNumber）优先，退化为数组下标。
function currentWeekDays(weeks: unknown[], today: string, startDate: string): PlanDaySource[] {
  if (!startDate || today < startDate) return [];
  const weekIndex = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      (7 * 24 * 60 * 60 * 1000)
  );
  const byNumber = weeks.map(record).find((week) => Number(week.weekNumber) === weekIndex + 1);
  const week = byNumber || (weeks[weekIndex] ? record(weeks[weekIndex]) : null);
  return week && Array.isArray(week.days) ? (week.days as unknown[]).map(record) : [];
}

// 队伍今日计划汇总：重点与条目去重；计划量仅在有人填了对应数值时给出合计。
export function summarizeTodayPlans(days: (TodayPlanDay | null)[]) {
  const focus: string[] = [];
  const specialItems: string[] = [];
  const physicalItems: string[] = [];
  const itemKeys = new Set<string>();
  const items: TodayPlanItem[] = [];
  let plannedDurationMin = 0;
  let plannedDistanceKm = 0;
  let hasDuration = false;
  let hasDistance = false;
  for (const day of days) {
    if (!day) continue;
    if (day.focus && !focus.includes(day.focus)) focus.push(day.focus);
    for (const name of day.specialItems) if (!specialItems.includes(name)) specialItems.push(name);
    for (const name of day.physicalItems)
      if (!physicalItems.includes(name)) physicalItems.push(name);
    for (const item of day.items) {
      const key = `${item.name}|${item.detail}`;
      if (itemKeys.has(key)) continue;
      itemKeys.add(key);
      items.push(item);
    }
    if (day.plannedDurationMin !== null) {
      plannedDurationMin += day.plannedDurationMin;
      hasDuration = true;
    }
    if (day.plannedDistanceKm !== null) {
      plannedDistanceKm += day.plannedDistanceKm;
      hasDistance = true;
    }
  }
  return {
    hasPlan: days.some(Boolean),
    focus,
    specialItems,
    physicalItems,
    items,
    plannedDurationMin: hasDuration ? Math.round(plannedDurationMin * 10) / 10 : null,
    plannedDistanceKm: hasDistance ? Math.round(plannedDistanceKm * 10) / 10 : null,
  };
}
