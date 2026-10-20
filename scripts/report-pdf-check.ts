import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReportFixture } from '../server/report/report-fixture.ts';
import { readReport } from '../server/report/report-service.ts';
import { renderReportPdf } from '../server/report/report-pdf.ts';
import { reportPeriod } from '../shared/training-report.ts';

// 只使用合成内存库；不加载应用入口或生产数据库。
const db = createReportFixture();
try {
  const data = readReport(db, 1, 'ROWING', reportPeriod('week', '2026-10-05'));
  const dir = resolve(process.argv[2] || 'output/pdf');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'report-check.pdf'), renderReportPdf({
    id: '00000000-0000-4000-8000-000000000001', createdAt: '2026-10-20T00:00:00Z', data,
    commentary: { highlights: ['专项与体能训练记录已汇总。'], concerns: ['部分课次数据尚未填写。'], suggestions: ['核对缺失记录并补全训练日志。'] },
  }, 1));
  console.log('合成报告已生成');
} finally { db.close(); }
