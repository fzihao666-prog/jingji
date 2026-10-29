import { normalizeProject } from '../../shared/projects';
import { OVERVIEW_METRIC_MAP } from '../../shared/overview-metrics';
import { SLALOM_CHAMPION_METRICS } from '../../shared/slalom-model';
import { STRENGTH_METRICS } from '../../shared/strength-model';
import type { SpecialTestEvent, StrengthTest } from '../types';

export type TestPoint = { id: string; date: string; value: number; order: number };
export type TestSeries = {
  key: string;
  label: string;
  unit: string;
  direction: 'higher_better' | 'lower_better' | 'neutral';
  comparable: boolean;
  points: TestPoint[];
};

export function recentTestSeries(
  tests: StrengthTest[],
  events: SpecialTestEvent[],
  athleteId: number,
  project: string,
  from: string,
  to: string
): TestSeries[] {
  const groups = new Map<string, TestSeries>();
  const add = (series: Omit<TestSeries, 'points'>, point: TestPoint) => {
    if (point.date < from || point.date > to || !Number.isFinite(point.value)) return;
    const group = groups.get(series.key) ?? { ...series, points: [] };
    group.points.push(point);
    groups.set(series.key, group);
  };
  for (const test of tests.filter((item) => item.athleteId === athleteId)) {
    for (const metric of STRENGTH_METRICS) {
      if (
        metric.group === 'morphology' ||
        (metric.projects &&
          !metric.projects.some((item) => normalizeProject(item) === normalizeProject(project)))
      )
        continue;
      const value = test.metrics[metric.key];
      if (typeof value !== 'number') continue;
      const comparable = Boolean(
        test.protocol?.trim() && test.protocolVersion?.trim() && test.contextKey?.trim()
      );
      const context = [test.protocol, test.protocolVersion, test.contextKey]
        .filter(Boolean)
        .join(' · ');
      add(
        {
          key: JSON.stringify([
            'strength',
            metric.key,
            metric.unit,
            test.protocol,
            test.protocolVersion,
            test.contextKey,
            comparable ? '' : test.id,
          ]),
          label: `${metric.label}${context ? ` · ${context}` : ''}`,
          unit: metric.unit,
          direction: ['wingateLactateMmol', 'anaerobicThresholdHr'].includes(metric.key)
            ? 'neutral'
            : SLALOM_CHAMPION_METRICS.find((item) => item.sourceKey === metric.key)?.direction ===
                'lower'
              ? 'lower_better'
              : (OVERVIEW_METRIC_MAP[metric.key]?.direction ?? 'neutral'),
          comparable,
        },
        {
          id: `strength-${test.id}-${metric.key}`,
          date: test.testDate,
          value,
          order: test.attemptOrder ?? test.id,
        }
      );
    }
  }
  for (const event of events.filter(
    (item) => normalizeProject(item.project) === normalizeProject(project)
  )) {
    for (const result of event.results.filter((item) =>
      item.memberAthleteIds.includes(athleteId)
    )) {
      const comparable = Boolean(
        event.distanceM > 0 &&
        event.boatClass &&
        event.genderGroup &&
        event.location &&
        event.windConditions
      );
      const context = [
        event.distanceM ? `${event.distanceM}m` : '',
        event.boatClass,
        event.genderGroup,
        event.location,
        event.windConditions,
        result.memberAthleteIds
          .slice()
          .sort((a, b) => a - b)
          .join('/'),
      ];
      const values = result.attemptsMs.length ? result.attemptsMs : [result.bestMs];
      values.forEach((value, index) =>
        add(
          {
            key: JSON.stringify(['special', ...context, comparable ? '' : event.id]),
            label: `专项计时 · ${context.slice(0, 5).filter(Boolean).join(' · ')}`,
            unit: 's',
            direction: 'lower_better',
            comparable,
          },
          {
            id: `special-${event.id}-${result.id}-${index}`,
            date: event.testDate,
            value: value / 1000,
            order: event.id * 1000 + index,
          }
        )
      );
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      points: group.points.sort(
        (a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id)
      ),
    }))
    .sort(
      (a, b) =>
        b.points.at(-1)!.date.localeCompare(a.points.at(-1)!.date) ||
        a.label.localeCompare(b.label, 'zh-CN')
    );
}

export function testSeriesSummary(series: TestSeries) {
  const latest = series.points.at(-1)!;
  const previous = series.comparable ? series.points.at(-2) : undefined;
  const best =
    !series.comparable || series.direction === 'neutral'
      ? null
      : series.points.reduce(
          (best, point) =>
            series.direction === 'lower_better'
              ? Math.min(best, point.value)
              : Math.max(best, point.value),
          latest.value
        );
  return { latest, best, difference: previous ? latest.value - previous.value : null };
}
