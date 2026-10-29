import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { teamWeeklyReportSchema, type TeamWeeklyReport } from '../../shared/team-weekly-report.ts';
import { teamWeeklySections, weeklyNumber } from '../../shared/team-weekly-sections.ts';
import { projectLabel } from '../../shared/projects.ts';
let font: string | undefined;
/** 只绘制本次授权读取的内存快照，不请求外网、不执行HTML、不落盘。 */
export function renderTeamWeeklyPdf(input: TeamWeeklyReport): Buffer {
  const r = teamWeeklyReportSchema.parse(input);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  font ??= readFileSync(new URL('./fonts/NotoSansSC.ttf', import.meta.url)).toString('base64');
  doc.addFileToVFS('NotoSansSC.ttf', font);
  doc.addFont('NotoSansSC.ttf', 'weekly', 'normal');
  doc.setFont('weekly');
  doc.setProperties({ title: `${r.teamName}训练周总结`, author: '竞迹' });
  let y = 22;
  const clean = (s: string) =>
    Array.from(s, (char) => {
      const code = char.codePointAt(0)!;
      return (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : char;
    }).join('');
  const text = (s: string, x: number, top: number, size = 10) => {
    doc.setFontSize(size);
    doc.setTextColor('#12303b');
    doc.text(clean(s), x, top);
  };
  const page = () => {
    doc.addPage();
    y = 24;
    text('竞迹 · 队伍训练周总结', 16, 14, 9);
  };
  const space = (h: number) => {
    if (y + h > 276) page();
  };
  const paragraph = (s: string, size = 10) => {
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(clean(s), 176) as string[];
    for (const line of lines) {
      space(6);
      text(line, 17, y, size);
      y += 5.5;
    }
    y += 3;
  };
  text('队伍训练周总结', 16, y, 23);
  y += 13;
  paragraph(`${projectLabel(r.project)} · ${r.teamName}`, 13);
  paragraph(`${r.range.from} 至 ${r.range.to}  /  当前权限范围内 ${r.athletes.length} 名队员`);
  paragraph(
    `生成时间：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.generatedAt))}（北京时间）`,
    9
  );
  // 同时提供逐日数据表，图表缺失值不绘制成零。
  space(58);
  text('每日个人累计训练时长 / 分钟', 16, y, 12);
  y += 8;
  const base = y + 28,
    max = Math.max(1, ...r.daily.map((d) => d.duration ?? 0));
  r.daily.forEach((d, i) => {
    const x = 20 + i * 25;
    const height = ((d.duration ?? 0) / max) * 24;
    doc.setFillColor('#176f7f');
    if (d.duration !== null && d.duration > 0) doc.rect(x, base - height, 12, height, 'F');
    text(weeklyNumber(d.duration), x + 6, base - height - 3, 8);
    text(d.date.slice(5), x, base + 6, 8);
  });
  y = base + 17;
  const table = (headers: string[], rows: string[][]) => {
    const width = 178 / headers.length;
    const draw = (cells: string[], header = false) => {
      doc.setFontSize(8);
      const lines = cells.map((c) => doc.splitTextToSize(clean(c), width - 4) as string[]);
      const count = Math.max(1, ...lines.map((l) => l.length));
      // 超长单元格分段跨页，避免一行溢出整页。
      for (let offset = 0; offset < count;) {
        if (y + 10 > 276) {
          page();
          if (!header) draw(headers, true);
        }
        const fit = Math.max(1, Math.floor((276 - y - 4) / 4.5));
        const take = Math.min(fit, count - offset);
        const height = Math.max(9, take * 4.5 + 4);
        doc.setFillColor(header ? '#edf3f4' : '#ffffff');
        doc.rect(16, y, 178, height, 'F');
        lines.forEach((ls, i) =>
          ls
            .slice(offset, offset + take)
            .forEach((line, j) => text(line, 18 + i * width, y + 5 + j * 4.5, 8))
        );
        doc.setDrawColor('#d8e3e6');
        doc.line(16, y + height, 194, y + height);
        y += height;
        offset += take;
      }
    };
    draw(headers, true);
    rows.forEach((row) => draw(row));
    y += 5;
  };
  for (const section of teamWeeklySections(r)) {
    space(23);
    doc.setFillColor('#176f7f');
    doc.rect(16, y - 4, 1, 6, 'F');
    text(section.title, 20, y, 13);
    y += 10;
    section.paragraphs.forEach((p) => paragraph(p));
    if (section.headers && section.rows?.length) table(section.headers, section.rows);
  }
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    text(`${r.range.from} — ${r.range.to} · ${i} / ${total}`, 16, 287, 8);
  }
  return Buffer.from(doc.output('arraybuffer'));
}
