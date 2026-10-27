import { TrainingSessionEntry } from './TrainingSessionEntry';
export default { title: '公共训练/课次填写', component: TrainingSessionEntry };
export const Cycling = { args: { athleteId: 1, project: 'CYCLING_ROAD', mode: 'coach', onSaved: () => {} } };
export const Volleyball = {
  args: { athleteId: 1, project: 'VOLLEYBALL', mode: 'self', onSaved: () => {} },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const date = canvasElement.querySelector<HTMLInputElement>('input[type="date"]');
    if (!date) throw new Error('训练日期控件缺失');
    date.focus();
    if (document.activeElement !== date) throw new Error('训练日期无法获得键盘焦点');
    if (canvasElement.textContent?.includes('桨频/划频')) throw new Error('排球不应显示桨频');
  },
};
