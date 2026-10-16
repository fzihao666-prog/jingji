import type { TeamPlanOverride, TeamPlanSession } from '../../shared/team-plan';
import {
  addPlanDays,
  planWeekDays,
  summarizePlanWeek,
  explicitRestLabel,
} from '../pages/training-plan-week';
import './TrainingPlanWeekView.css';

type Props = {
  sessions: TeamPlanSession[];
  overrides: TeamPlanOverride[];
  weekStart: string;
  selectedDate: string;
  today: string;
  onSelectDate: (date: string) => void;
  onChangeWeek: (weekStart: string) => void;
  onToday: () => void;
};

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const categories = [
  { value: 'special', label: '专项' },
  { value: 'physical', label: '体能' },
  { value: 'recovery', label: '恢复' },
] as const;
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
const targetLabel = (value: number | null, unit: string) =>
  value === null ? '未填写' : `${Number(value.toFixed(2))}${unit}`;

export function TrainingPlanWeekView({
  sessions,
  overrides,
  weekStart,
  selectedDate,
  today,
  onSelectDate,
  onChangeWeek,
  onToday,
}: Props) {
  const days = planWeekDays(weekStart);
  const summary = summarizePlanWeek(sessions, weekStart);
  return (
    <section className="training-plan-week" aria-label="训练计划周视图">
      <div className="training-plan-week-toolbar">
        <h3>
          {dateLabel(weekStart)}—{dateLabel(days[6])}
        </h3>
        <div className="training-plan-week-actions">
          <button type="button" onClick={() => onChangeWeek(addPlanDays(weekStart, -7))}>
            上一周
          </button>
          <button type="button" onClick={onToday}>
            返回本周
          </button>
          <button type="button" onClick={() => onChangeWeek(addPlanDays(weekStart, 7))}>
            下一周
          </button>
          <label>
            选择日期{' '}
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                if (event.target.value) onSelectDate(event.target.value);
              }}
            />
          </label>
        </div>
      </div>
      <dl className="training-plan-week-summary">
        <div>
          <dt>本周训练课</dt>
          <dd>{summary.sessionCount}节</dd>
        </div>
        <div>
          <dt>专项计划时长</dt>
          <dd>{targetLabel(summary.specialDurationMin, '分钟')}</dd>
        </div>
        <div>
          <dt>体能计划时长</dt>
          <dd>{targetLabel(summary.physicalDurationMin, '分钟')}</dd>
        </div>
        <div>
          <dt>专项计划距离</dt>
          <dd>{targetLabel(summary.specialDistanceKm, '公里')}</dd>
        </div>
      </dl>
      <div
        className="training-plan-week-scroll"
        role="region"
        aria-label="一周七天安排"
        tabIndex={0}
      >
        <div className="training-plan-week-grid">
          {days.map((date, index) => {
            const daily = sessions.filter((session) => session.date === date);
            const sessionIds = new Set(daily.map((session) => session.id));
            const adjusted = new Set(
              overrides
                .filter((override) => sessionIds.has(override.sessionId))
                .map((override) => override.athleteId)
            ).size;
            return (
              <button
                key={date}
                type="button"
                className="training-plan-week-day"
                aria-pressed={date === selectedDate}
                aria-current={date === today ? 'date' : undefined}
                onClick={() => onSelectDate(date)}
              >
                <span className="training-plan-week-day-heading">
                  <strong>{weekdays[index]}</strong>
                  {date === today && <span className="training-plan-week-today">今天</span>}
                </span>
                <time dateTime={date}>{dateLabel(date)}</time>
                <span className="training-plan-week-day-counts">
                  {categories.map((category) => {
                    const count = daily.filter(
                      (session) => session.category === category.value
                    ).length;
                    return count > 0 ? (
                      <span
                        key={category.value}
                        className={`training-plan-week-category is-${category.value}`}
                      >
                        {category.label} {count}节
                      </span>
                    ) : null;
                  })}
                  {explicitRestLabel(daily) && (
                    <span className="training-plan-week-category is-recovery">
                      {explicitRestLabel(daily)}
                    </span>
                  )}
                  {daily.length === 0 && <span className="training-plan-week-empty">未安排</span>}
                </span>
                <span className="training-plan-week-adjusted">
                  {adjusted > 0 ? `个人调整 ${adjusted}人` : '无个人调整'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
