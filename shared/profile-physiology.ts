import { z } from 'zod';

export const profilePhysiologyRecordSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  label: z.string(),
  date: z.iso.date(),
  value: z.number().finite(),
  unit: z.string(),
  source: z.string(),
  protocol: z.string().optional(),
});
export type ProfilePhysiologyRecord = z.infer<typeof profilePhysiologyRecordSchema>;

type Measurement = {
  measurementId: number;
  testQuality: string;
  testProtocol?: string;
  code: string;
  label: string;
  domain: string;
  testDate: string;
  value: number;
  unit: string;
  quality: string;
  source: string;
  testSource: string;
  isDemo: number;
  testDemo: number;
};

/** 只读取当前周期有效记录，不由热力图估算值补齐个人检测结果。 */
export function selectProfilePhysiologyRecords(
  rows: readonly Measurement[],
  from: string,
  to: string
): ProfilePhysiologyRecord[] {
  return rows
    .filter(
      (row) =>
        ['physiology', 'biochemistry'].includes(row.domain) &&
        row.testDate >= from &&
        row.testDate <= to &&
        row.quality === 'valid' &&
        row.testQuality === 'valid' &&
        !row.isDemo &&
        !row.testDemo &&
        Number.isFinite(row.value)
    )
    .map((row) => ({
      id: row.measurementId,
      code: row.code,
      label: row.label,
      date: row.testDate,
      value: row.value,
      unit: row.unit,
      source: row.source || row.testSource,
      protocol: row.testProtocol ?? '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
}
