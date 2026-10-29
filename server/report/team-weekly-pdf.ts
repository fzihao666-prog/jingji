import { type TeamWeeklyCommentary } from '../../shared/team-weekly-ai.ts';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { teamWeeklyReportSchema, type TeamWeeklyReport } from '../../shared/team-weekly-report.ts';
import { teamWeeklySections, weeklyNumber } from '../../shared/team-weekly-sections.ts';
import {
  teamWeeklyCharts,
  weeklyTimetable,
  type WeeklyChart,
} from '../../shared/team-weekly-charts.ts';
import { projectLabel } from '../../shared/projects.ts';
let font: string | undefined;
/** 只绘制本次授权读取的内存快照，不请求外网、不执行HTML、不落盘。 */
export function renderTeamWeeklyPdf(
  input: TeamWeeklyReport,
  commentary?: TeamWeeklyCommentary
): Buffer {
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
  const charts = teamWeeklyCharts(r);
  const drawChart = (chart: WeeklyChart) => {
    const chartSpace = chart.kind === 'line' ? 90 : Math.min(180, 35 + chart.points.length * 10);
    space(chartSpace);
    paragraph(`${chart.title}${chart.unit ? ` / ${chart.unit}` : ''}`, 11);
    paragraph(chart.note, 8);
    const values = chart.points.flatMap((p) => (p.value === null ? [] : [p.value]));
    if (!values.length) {
      paragraph('暂无有效数据', 9);
      return;
    }
    const min = Math.min(0, ...values),
      max = Math.max(1, ...values);
    const ratio = (v: number) => (v - min) / (max - min);
    if (chart.kind === 'bar') {
      for (const point of chart.points) {
        doc.setFontSize(8);
        const labels = doc.splitTextToSize(clean(point.label), 45) as string[];
        const height = Math.max(10, labels.length * 4 + 3);
        if (y + height > 276) {
          page();
          paragraph(`${chart.title}（续） / ${chart.unit}`, 10);
        }
        labels.forEach((label, i) => text(label, 17, y + 5 + i * 4, 8));
        doc.setFillColor('#176f7f');
        if (point.value !== null && point.value > 0)
          doc.rect(65, y + 1, ratio(point.value) * 100, 5, 'F');
        text(weeklyNumber(point.value), 169, y + 5, 8);
        y += height;
      }
    } else {
      // 每页最多7点，下一段重复边界点，保持长测试序列连续且不遗漏。
      for (let offset = 0; offset < chart.points.length; offset += 6) {
        const points = chart.points.slice(offset, offset + 7);
        if (offset && points.length === 1) break;
        space(61);
        const top = y + 5,
          base = top + 35;
        const x = (i: number) => 31 + (i * 155) / Math.max(1, points.length - 1);
        const py = (v: number) => base - ratio(v) * 30;
        doc.setDrawColor('#d8e3e6');
        doc.line(30, base, 190, base);
        text(weeklyNumber(min), 17, base, 7);
        text(weeklyNumber(max), 17, top + 5, 7);
        points.forEach((point, i) => {
          if (point.value !== null) {
            doc.setDrawColor('#176f7f');
            doc.setFillColor('#176f7f');
            if (i && points[i - 1].value !== null)
              doc.line(x(i - 1), py(points[i - 1].value!), x(i), py(point.value));
            doc.circle(x(i), py(point.value), 0.9, 'F');
            text(weeklyNumber(point.value), x(i) - 2, py(point.value) - 3, 7);
          }
          text(point.label.length > 5 ? point.label.slice(5) : point.label, x(i) - 4, base + 6, 7);
        });
        y = base + 14;
      }
      table(
        ['日期', `数值 / ${chart.unit}`],
        chart.points.map((p) => [p.label, weeklyNumber(p.value)])
      );
    }
    y += 4;
  };
  const commentarySections: Record<string, keyof TeamWeeklyCommentary> = {
    '一、本周训练摘要': 'summary',
    '二、训练开展与结构': 'training',
    力量训练个人与动作对比: 'strength',
    '五、恢复反馈': 'recovery',
    '七、下周已发布安排': 'nextWeek',
  };
  for (const section of teamWeeklySections(r)) {
    const firstChart = charts.find((chart) => chart.section === section.title);
    const firstChartSpace = firstChart
      ? firstChart.kind === 'line'
        ? 90
        : Math.min(180, 35 + firstChart.points.length * 10)
      : 0;
    // 标题与首张图保留在同页，避免页尾出现孤立章节标题。
    space(23 + firstChartSpace);
    doc.setFillColor('#176f7f');
    doc.rect(16, y - 4, 1, 6, 'F');
    text(section.title, 20, y, 13);
    y += 10;
    section.paragraphs.forEach((p) => paragraph(p));
    const key = commentarySections[section.title];
    if (commentary && key && commentary[key]) {
      paragraph('教练核对点评', 10);
      paragraph(commentary[key]);
    }
    charts.filter((chart) => chart.section === section.title).forEach(drawChart);
    if (
      r.plansAvailable &&
      (section.title === '三、计划与实施' || section.title === '七、下周已发布安排')
    ) {
      table(
        ['日期 / 星期', '时段与训练安排'],
        weeklyTimetable(r, section.title === '七、下周已发布安排').map((day) => [
          `${day.date} ${day.day}`,
          day.sessions.length
            ? day.sessions
                .map(
                  (p) =>
                    `${p.period || '时段未记录'}：${p.content}（${weeklyNumber(p.duration)}分钟 / ${weeklyNumber(p.distance)}km）`
                )
                .join('\n')
            : '暂无已发布安排',
        ])
      );
    }
    if (section.headers && section.rows?.length) table(section.headers, section.rows);
  }
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    text(`${r.range.from} — ${r.range.to} · ${i} / ${total}`, 16, 287, 8);
  }
  return Buffer.from(doc.output('arraybuffer'));
}
