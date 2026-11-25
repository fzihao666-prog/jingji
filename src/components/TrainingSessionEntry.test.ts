import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TrainingSessionEntry } from './TrainingSessionEntry';
it.each(['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])(
  '公共课次表单支持%s，默认不展示不适用专项字段',
  (project) => {
    const html = renderToStaticMarkup(
      createElement(TrainingSessionEntry, {
        athleteId: 1,
        project,
        mode: 'coach',
        onSaved: () => {},
      })
    );
    expect(html).toContain('填写训练记录');
    expect(html).toContain('训练活动');
    expect(html).not.toContain('桨频/划频');
    expect(html).not.toContain('艇型');
    expect(html).not.toContain('required="" min="0" max="10"');
  }
);

it.each(['ROWING', 'VOLLEYBALL', 'CYCLING_ROAD'])('%s提示与时长必填属性一致', (project) => {
  const html = renderToStaticMarkup(
    createElement(TrainingSessionEntry, { athleteId: 1, project, mode: 'coach', onSaved: () => {} })
  );
  const duration = html.match(/<input[^>]*name="duration"[^>]*>/)?.[0] || '';
  expect(duration.includes('required')).toBe(project !== 'CYCLING_ROAD');
  expect(html).toContain(
    project === 'CYCLING_ROAD' ? '时长或距离至少填一项' : '此活动必须填写时长'
  );
});

it.each(['VOLLEYBALL', 'CYCLING_ROAD'])('%s不提供水上强度体系', (project) => {
  const html = renderToStaticMarkup(
    createElement(TrainingSessionEntry, { athleteId: 1, project, mode: 'coach', onSaved: () => {} })
  );
  expect(html).not.toContain('U3/U2/U1/AT/TPT/AN/ATP');
  expect(html).not.toContain('UT3/UT2/UT1/TR/AT/AN/REC');
});

it('计划带入活动与任务但不把目标时长、距离和RPE当成已完成值', () => {
  const session = {
    id: 'ride',
    date: '2026-10-01',
    category: 'physical' as const,
    activityCode: 'cycling',
    intensitySystem: '',
    period: '',
    content: '骑行体能',
    durationMin: 90,
    distanceKm: 30,
    intensity: '',
    sets: null,
    reps: null,
    load: null,
    notes: '',
  };
  const html = renderToStaticMarkup(
    createElement(TrainingSessionEntry, {
      athleteId: 1,
      project: 'ROWING',
      mode: 'coach',
      plan: { id: 7, session },
      onSaved: () => {},
    })
  );
  expect(html).toContain('骑行体能');
  expect(html).toContain('踏频');
  expect(html).not.toContain('桨频/划频');
  expect(html).not.toContain('value="90"');
  expect(html).not.toContain('value="30"');
});
