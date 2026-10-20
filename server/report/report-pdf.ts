import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { savedReportSchema, type SavedReport } from '../../shared/training-report.ts';

let font: string | undefined;
const ink = '#103d49', teal = '#187e88', muted = '#647e87', pale = '#edf4f5';
const fmt = (value: number | null) => value === null ? '-' : String(Math.round(value * 100) / 100);

/** 只绘制已保存快照。纯文本/矢量输出，不执行 HTML，不请求外部资源，不落盘。 */
export function renderReportPdf(input: SavedReport, athleteId: number): Buffer {
  const report = savedReportSchema.parse(input);
  const d = report.data;
  if (d.daily.length > 90 || d.tests.length > 300 || d.wellness.some(m => m.points.length > 90))
    throw new Error('报告超出导出大小限制');
  if (d.tests.some(t => t.label.length > 100 || t.unit.length > 30 || t.side.length > 30) ||
      d.categories.length > 10 || d.wellness.length > 10)
    throw new Error('报告字段超出排版限制');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  font ??= readFileSync(new URL('./fonts/NotoSansSC.ttf', import.meta.url)).toString('base64');
  doc.addFileToVFS('NotoSansSC.ttf', font);
  doc.addFont('NotoSansSC.ttf', 'report', 'normal');
  doc.setFont('report');
  doc.setProperties({ title: '竞迹·报告', author: '竞迹', subject: '已保存训练报告' });
  let y = 20;
  const text = (s: string, x: number, top: number, size = 10, color = ink) => {
    doc.setFontSize(size); doc.setTextColor(color); doc.text(s, x, top);
  };
  const newPage = () => { doc.addPage(); y = 24; text('竞迹·报告', 16, 14, 10, muted); };
  const space = (height: number) => { if (y + height > 276) newPage(); };
  const heading = (label: string) => {
    space(24); doc.setFillColor(teal); doc.rect(16, y - 4, 1.2, 6, 'F');
    text(label, 20, y + 1, 13); y += 11;
  };
  const paragraph = (s: string) => {
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(s, 174) as string[];
    for (const line of lines) { space(7); text(line, 18, y); y += 6; }
    y += 3;
  };
  const table = (headers: string[], rows: string[][], widths: number[]) => {
    const row = (cells: string[], header = false) => {
      doc.setFontSize(9);
      const wrapped = cells.map((s, i) => doc.splitTextToSize(s, widths[i] - 6) as string[]);
      const height = Math.max(10, ...wrapped.map(lines => lines.length * 4.8 + 5));
      if (y + height > 276) { newPage(); if (!header) row(headers, true); }
      doc.setFillColor(header ? pale : '#ffffff'); doc.rect(16, y, 178, height, 'F');
      let x = 16;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, j) => text(line, x + 3, y + 6 + j * 4.8, 9, header ? muted : ink));
        x += widths[i];
      });
      doc.setDrawColor('#dce8ea'); doc.line(16, y + height, 194, y + height); y += height;
    };
    row(headers, true);
    rows.forEach(cells => row(cells));
    y += 9;
  };
  // 每图最多14天，避免90天阶段报告的日期和数值重叠。
  const chart = (title: string, points: { date: string; value: number | null }[], color = teal) => {
    if (!points.length) { heading(title); paragraph('暂无记录'); return; }
    for (let offset = 0; offset < points.length; offset += 14) {
      const chunk = points.slice(offset, offset + 14);
      space(62); heading(title + (points.length > 14 ? ` (${chunk[0].date.slice(5)} - ${chunk.at(-1)!.date.slice(5)})` : ''));
      const max = Math.max(1, ...points.map(p => p.value ?? 0));
      const baseline = y + 30, step = 174 / chunk.length;
      doc.setDrawColor('#dce8ea'); doc.line(18, baseline, 192, baseline);
      chunk.forEach((p, i) => {
        const x = 18 + i * step + step / 2, height = (p.value ?? 0) / max * 24;
        if (p.value !== null && p.value > 0) {
          doc.setFillColor(color); doc.rect(x - Math.min(3.5, step / 4), baseline - height, Math.min(7, step / 2), height, 'F');
        }
        doc.setFontSize(8); doc.setTextColor(ink);
        doc.text(fmt(p.value), x, baseline - height - 3, { align: 'center' });
        doc.setTextColor(muted); doc.text(p.date.slice(5), x, baseline + 6, { align: 'center' });
      });
      y = baseline + 12;
    }
  };

  text('竞迹·报告', 16, y, 23); y += 10;
  text(`${d.range.from} - ${d.range.to}`, 16, y, 12); y += 7;
  const project = ({ ROWING: '赛艇', CANOE: '皮划艇', SLALOM: '激流', CANOE_SPRINT: '皮划艇', CANOE_SLALOM: '激流' } as Record<string, string>)[d.project] || d.project;
  text(`运动员编号 ${athleteId}  /  ${project}  /  已保存快照`, 16, y, 9, muted); y += 12;
  const kpis = [['训练课次', `${fmt(d.totals.sessions)} 次`], ['训练时长', `${fmt(d.totals.duration)} 分钟`],
    ['训练距离', `${fmt(d.totals.distance)} km`], ['SRPE负荷', `${fmt(d.totals.srpe)} AU`]];
  kpis.forEach(([label, value], i) => {
    const x = 16 + i * 45;
    doc.setFillColor(pale); doc.roundedRect(x, y, 43, 26, 2, 2, 'F');
    text(label, x + 3, y + 8, 9, muted); text(value, x + 3, y + 19, 12);
  });
  y += 38;
  heading('训练结构');
  table(['类型', '课次', '分钟'], d.categories.map(c => [c.label, fmt(c.sessions), fmt(c.duration)]), [90, 44, 44]);
  chart('每日训练时长 / 分钟', d.daily.map(p => ({ date: p.date, value: p.duration })));
  chart('每日负荷 / SRPE (AU)', d.daily.map(p => ({ date: p.date, value: p.srpe })), '#c49335');
  heading('每日明细');
  table(['日期', '课次', '分钟', 'SRPE (AU)'], d.daily.map(p => [p.date, fmt(p.sessions), fmt(p.duration), fmt(p.srpe)]), [58, 34, 40, 46]);
  heading('测试变化');
  if (!d.tests.length) paragraph('暂无测试记录');
  for (const t of d.tests) {
    space(44);
    paragraph(`${t.label} / ${t.unit} / ${{ left: '左侧', right: '右侧', center: '中立' }[t.side] || t.side}`);
    table(['首次', '末次', '变化'], [[`${fmt(t.first.value)} (${t.first.date})`, `${fmt(t.last.value)} (${t.last.date})`, fmt(t.change)]], [70, 70, 38]);
  }
  for (const m of d.wellness) {
    const byDate = new Map(m.points.map(p => [p.date, p.value]));
    chart(`${m.label} / 均值 ${fmt(m.average)} ${m.unit}`, d.daily.map(p => ({ date: p.date, value: byDate.get(p.date) ?? null })));
  }
  space(80); heading('简短点评');
  for (const [key, label] of [['highlights', '主要表现'], ['concerns', '需要关注'], ['suggestions', '下一步建议']] as const) {
    space(23); text(label, 18, y, 11, teal); y += 7;
    paragraph(report.commentary[key].join('\n') || '未填写');
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setDrawColor('#dce8ea'); doc.line(16, 283, 194, 283);
    text(`${report.id.slice(0, 8)} | 保存于 ${report.createdAt.slice(0, 10)} | 缺失值为 -`, 16, 289, 8, muted);
    text(`${i} / ${pages}`, 180, 289, 8, muted);
  }
  return Buffer.from(doc.output('arraybuffer'));
}
