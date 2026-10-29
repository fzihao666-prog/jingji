import { describe, expect, it } from 'vitest';
import { previousWeekDate } from './ReportsPage';
describe('周报默认周期', () => {
  it('按北京时间跨日、跨年选择上一完整自然周', () => {
    expect(previousWeekDate(new Date('2026-10-25T15:59:00Z'))).toBe('2026-10-12');
    expect(previousWeekDate(new Date('2026-10-25T16:00:00Z'))).toBe('2026-10-19');
    expect(previousWeekDate(new Date('2026-01-01T00:00:00Z'))).toBe('2025-12-22');
  });
});
