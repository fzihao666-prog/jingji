import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TrainingSessionEntry } from './TrainingSessionEntry';
it.each(['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])('公共课次表单支持%s，默认不展示不适用专项字段', project => {
  const html = renderToStaticMarkup(createElement(TrainingSessionEntry, { athleteId: 1, project, mode: 'coach', onSaved: () => {} }));
  expect(html).toContain('填写训练记录');
  expect(html).toContain('训练活动');
  expect(html).not.toContain('桨频/划频');
  expect(html).not.toContain('艇型');
  expect(html).not.toContain('required="" min="0" max="10"');
});

it.each(['ROWING','VOLLEYBALL','CYCLING_ROAD'])('%s提示与时长必填属性一致',project=>{
 const html=renderToStaticMarkup(createElement(TrainingSessionEntry,{athleteId:1,project,mode:'coach',onSaved:()=>{}}));
 const duration=html.match(/<input[^>]*name="duration"[^>]*>/)?.[0] || '';
 expect(duration.includes('required')).toBe(project!=='CYCLING_ROAD');
 expect(html).toContain(project==='CYCLING_ROAD'?'时长或距离至少填一项':'此活动必须填写时长');
});
