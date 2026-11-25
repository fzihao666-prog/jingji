import type { PageKey } from './components/AppShell';

/** 只有直接消费全局训练记录的页面发起查询；专项页共用同一项目范围。 */
export function trainingRecordScope(page: PageKey, athleteId: number | null) {
  if (page === 'personal') return athleteId === null ? undefined : { athleteId };
  if (page.startsWith('special-') && page !== 'special-overview' && page !== 'special-schedule') {
    return { athleteId: null };
  }
  return undefined;
}
