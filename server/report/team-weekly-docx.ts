import {
  weeklyReportTheme as theme,
  weeklyMetricColor,
  weeklyPreviousColor,
  weeklyCategoryColor,
} from './team-weekly-theme.js';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import type { TeamWeeklyReport } from '../../shared/team-weekly-report.js';
import type { TeamWeeklyCommentary } from '../../shared/team-weekly-ai.js';
import {
  teamWeeklySections,
  weeklyReportMetadata,
  weeklyNumber,
} from '../../shared/team-weekly-sections.js';
import { teamWeeklyCharts, type WeeklyChart } from '../../shared/team-weekly-charts.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const clean = (s: unknown) =>
  Array.from(String(s ?? ''))
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        (code >= 32 || code === 9 || code === 10 || code === 13) &&
        code !== 0xfffe &&
        code !== 0xffff &&
        !(code >= 0xd800 && code <= 0xdfff)
      );
    })
    .join('');
const xml = (s: unknown) =>
  clean(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
const relationships = (s: string) => `${decl}<Relationships xmlns="${PKG}">${s}</Relationships>`;
const p = (text: string, style = 'Normal') =>
  text
    .split(/\r?\n/)
    .map(
      (line) =>
        `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`
    )
    .join('');
function metadataTable(entries: [string, string][]) {
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>${Array.from(
    { length: Math.ceil(entries.length / 2) },
    (_, i) =>
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>${[0, 1]
        .map((j) => {
          const entry = entries[i * 2 + j];
          return `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/><w:shd w:val="clear" w:fill="${theme.pale}"/></w:tcPr>${p(entry ? `${entry[0]}：${entry[1]}` : '', 'Metadata')}</w:tc>`;
        })
        .join('')}</w:tr>`
  ).join('')}</w:tbl>${p('')}`;
}
/** 首页标题区与指标均为可编辑文字表格，不把整页转成图片。 */
function coverHeader(report: TeamWeeklyReport) {
  const week = weeklyReportMetadata(report).find(([label]) => label === '训练周次')?.[1] || '';
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="180" w:type="dxa"/><w:bottom w:w="180" w:type="dxa"/><w:left w:w="220" w:type="dxa"/><w:right w:w="220" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/><w:tcBorders><w:left w:val="single" w:sz="20" w:color="${theme.amber}"/></w:tcBorders><w:shd w:val="clear" w:fill="${theme.navy}"/></w:tcPr>${p('竞迹 JINGJI / WEEKLY TRAINING REPORT', 'CoverBrand')}${p('训练周总结', 'CoverTitle')}${p(report.teamName, 'CoverTeam')}${p(`${report.range.from} — ${report.range.to}  ·  ${week}`, 'CoverPeriod')}</w:tc></w:tr></w:tbl>${p('')}`;
}
function coverMetrics(report: TeamWeeklyReport, rows: string[][]) {
  const cells: [string, string, string][] = [
    ['队伍训练课次', weeklyNumber(report.totals.sessions), '节'],
    [
      '有效参与人数',
      weeklyNumber(report.athletes.filter((a) => a.data.totals.sessions > 0).length),
      '人',
    ],
    ['个人累计时长', weeklyNumber(report.totals.duration), '分钟'],
    ['个人累计负荷', weeklyNumber(report.totals.srpe), 'SRPE / AU'],
  ];
  const sourceLabels = ['训练课次', '有效参与人数', '', '训练负荷 / SRPE'];
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cells.map(() => '<w:gridCol w:w="2340"/>').join('')}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${cells
    .map(([label, value, unit], i) => {
      const row = rows.find((row) => row[0] === sourceLabels[i]);
      const previous =
        i === 2 ? `${weeklyNumber(report.previous.duration)} 分钟` : row?.[2] || '未记录';
      const change =
        i === 2 ? report.comparison.metrics.find((m) => m.key === 'duration') : undefined;
      const delta =
        change && change.previous !== 0
          ? `${weeklyNumber(((change.current - change.previous) / Math.abs(change.previous)) * 100)}%`
          : row?.[3];
      return `<w:tc><w:tcPr><w:tcW w:w="2340" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="10" w:color="${theme.blue}"/></w:tcBorders></w:tcPr>${p(label, 'MetricLabel')}${p(value, 'MetricValue')}${p(unit, 'MetricLabel')}${p(`上周 ${previous}${delta && delta !== '—' ? ` · ${delta}` : ''}`, 'MetricNote')}</w:tc>`;
    })
    .join('')}</w:tr></w:tbl>${p('')}`;
}
function table(headers: string[], rows: string[][]) {
  const weights = headers.map((h) =>
    /备注|原文|已有处方|训练内容|内容项/.test(h)
      ? 2
      : /日期/.test(h)
        ? 1.4
        : /队员|动作/.test(h)
          ? 1.3
          : /完成$|分钟$|^km$/.test(h)
            ? 0.65
            : 1
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((9360 * w) / sum));
  widths[widths.length - 1]! += 9360 - widths.reduce((n, v) => n + v, 0);
  const row = (cells: string[], head = false, index = 0) =>
    `<w:tr><w:trPr><w:cantSplit/>${head ? '<w:tblHeader/>' : ''}</w:trPr>${cells.map((v, i) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/><w:shd w:val="clear" w:fill="${index % 2 || head ? theme.pale : theme.white}"/></w:tcPr>${p(v, head ? 'TableHeading' : /本周|上周|变化/.test(headers[i] || '') && /^[+-]?\d/.test(v) ? 'TableMetric' : 'TableText')}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top', 'bottom', 'insideH'].map((v) => `<w:${v} w:val="single" w:sz="4" w:color="${theme.pale}"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(headers, true)}${rows.map((v, i) => row(v, false, i)).join('')}</w:tbl>`;
}
type Series = { name: string; values: (number | null)[] };
function seriesFor(chart: WeeklyChart): Series[] {
  const extended = chart as WeeklyChart & { series?: Series[] };
  return extended.series?.length
    ? extended.series
    : [{ name: chart.unit || chart.title, values: chart.points.map((v) => v.value) }];
}
/** 文档按最多24人无损合组，网页仍使用原分组。 */
function documentCharts(charts: WeeklyChart[], combined: boolean): WeeklyChart[] {
  if (!combined) return charts;
  const output: WeeklyChart[] = [];
  for (const source of charts) {
    const key = source.id.replace(/:part\d+$/, '');
    const previous = output.at(-1);
    const sameDomain =
      previous?.domain?.min === source.domain?.min && previous?.domain?.max === source.domain?.max;
    const a = previous ? seriesFor(previous) : [],
      b = seriesFor(source);
    if (
      source.id.startsWith('strength:') &&
      previous?.id.replace(/:part\d+$/, '') === key &&
      previous.points.length + source.points.length <= 24 &&
      sameDomain &&
      a.length === b.length &&
      a.every((v, i) => v.name === b[i]?.name)
    ) {
      previous.points.push(...source.points);
      previous.series = a.map((v, i) => ({ name: v.name, values: [...v.values, ...b[i]!.values] }));
    } else
      output.push({
        ...source,
        points: [...source.points],
        series: source.series?.map((v) => ({ name: v.name, values: [...v.values] })),
      });
  }
  for (const chart of output.filter((c) => c.id.startsWith('strength:'))) {
    const group = output.filter(
      (c) => c.id.replace(/:part\d+$/, '') === chart.id.replace(/:part\d+$/, '')
    );
    chart.title =
      chart.title.replace(/（\d+\/\d+）$/, '') +
      (group.length > 1 ? `（${group.indexOf(chart) + 1}/${group.length}）` : '');
  }
  return output;
}
function chartText(size: number) {
  return `<c:txPr><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${theme.muted}"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>`;
}
function chartXml(chart: WeeklyChart) {
  const series = seriesFor(chart);
  const horizontal = chart.id.startsWith('strength:');
  const line = chart.kind === 'line';
  const color = weeklyMetricColor(chart.id);
  const fill = (color: string) => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const font = chartText(horizontal ? 850 : 900);
  const strCache = `<c:strCache><c:ptCount val="${chart.points.length}"/>${chart.points.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v.label)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const body = series
    .map((s, si) => {
      const col = String.fromCharCode(66 + si);
      const seriesColor = si === 0 ? color : weeklyPreviousColor(chart.id);
      const shape = line
        ? `<a:noFill/><a:ln w="25400">${fill(seriesColor)}${si ? '<a:prstDash val="dash"/>' : ''}</a:ln>`
        : `${fill(seriesColor)}<a:ln>${si ? fill(color) : '<a:noFill/>'}</a:ln>`;
      const marker = line
        ? `<c:marker><c:symbol val="${si ? 'square' : 'circle'}"/><c:size val="5"/><c:spPr>${fill(theme.white)}<a:ln w="19050">${fill(seriesColor)}</a:ln></c:spPr></c:marker>`
        : '';
      const categories =
        !line && ['composition', 'categories'].includes(chart.id)
          ? chart.points
              .map(
                (point, i) =>
                  `<c:dPt><c:idx val="${i}"/><c:spPr>${fill(weeklyCategoryColor(point.label))}<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`
              )
              .join('')
          : '';
      return `<c:ser><c:idx val="${si}"/><c:order val="${si}"/><c:tx><c:strRef><c:f>Data!$${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xml(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr>${shape}</c:spPr>${marker}${categories}<c:cat><c:strRef><c:f>Data!$A$2:$A$${chart.points.length + 1}</c:f>${strCache}</c:strRef></c:cat><c:val><c:numRef><c:f>Data!$${col}$2:$${col}$${chart.points.length + 1}</c:f><c:numCache><c:formatCode>0.##</c:formatCode><c:ptCount val="${chart.points.length}"/>${s.values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef></c:val>${line ? '<c:smooth val="0"/>' : ''}</c:ser>`;
    })
    .join('');
  const kind = line ? 'lineChart' : 'barChart';
  // 全员横条图避免数值标签挤压姓名，短日序列和汇总图直接标数值。
  const labels =
    !horizontal && chart.points.length <= 7
      ? `<c:dLbls><c:numFmt formatCode="0.##" sourceLinked="0"/>${chartText(850)}<c:dLblPos val="${line ? 't' : 'outEnd'}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls>`
      : '';
  const ticks =
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>';
  const axisStyle = `<c:spPr><a:ln w="6350">${fill(theme.axis)}</a:ln></c:spPr>`;
  const grid = `<c:majorGridlines><c:spPr><a:ln w="6350">${fill(theme.pale)}</a:ln></c:spPr></c:majorGridlines>`;
  const axes = `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:axPos val="${horizontal ? 'l' : 'b'}"/>${ticks}${axisStyle}${font}<c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="1"/><c:tickMarkSkip val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/>${chart.domain ? `<c:max val="${chart.domain.max}"/><c:min val="${chart.domain.min}"/>` : ''}</c:scaling><c:axPos val="${horizontal ? 'b' : 'l'}"/>${grid}<c:numFmt formatCode="0.##" sourceLinked="0"/>${ticks}${axisStyle}${font}<c:crossAx val="1"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/></c:valAx>`;
  const legend =
    series.length > 1
      ? `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/>${chartText(900)}</c:legend>`
      : '';
  return `${decl}<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:lang val="zh-CN"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:${kind}>${line ? '<c:grouping val="standard"/>' : `<c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/>`}${body}${labels}${line ? '' : '<c:gapWidth val="100"/><c:overlap val="0"/>'}<c:axId val="1"/><c:axId val="2"/></c:${kind}>${axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr>${fill(theme.white)}<a:ln><a:noFill/></a:ln></c:spPr>${font}<c:externalData r:id="data"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
function drawing(id: number, rid: string, width: number, height: number) {
  const cx = Math.round(width * 914400),
    cy = Math.round(height * 914400);
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="可编辑图表 ${id}"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
const styles = `${decl}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="${theme.text}"/><w:sz w:val="20"/><w:lang w:val="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="80" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[
  ['Normal', 20],
  ['Title', 40],
  ['Brand', 20],
  ['Metadata', 18],
  ['Heading1', 27],
  ['Heading2', 22],
  ['TableText', 18],
  ['TableHeading', 18],
  ['TableMetric', 18],
  ['Caption', 17],
  ['Footer', 16],
  ['CoverBrand', 17],
  ['CoverTitle', 42],
  ['CoverTeam', 23],
  ['CoverPeriod', 18],
  ['MetricLabel', 17],
  ['MetricValue', 40],
  ['MetricNote', 15],
  ['InsightTitle', 21],
]
  .map(([name, size]) => {
    const heading = name === 'Heading1' || name === 'Heading2';
    const color = String(name).startsWith('Cover')
      ? name === 'CoverBrand'
        ? theme.electric
        : theme.white
      : name === 'MetricValue'
        ? theme.blue
        : name === 'MetricLabel' || name === 'MetricNote'
          ? theme.muted
          : name === 'InsightTitle'
            ? theme.navy
            : ['Title', 'Heading1', 'Heading2', 'TableHeading'].includes(String(name))
              ? theme.navy
              : name === 'Brand'
                ? theme.teal
                : name === 'TableMetric'
                  ? theme.blue
                  : name === 'Caption' || name === 'Footer'
                    ? theme.muted
                    : theme.text;
    const layout = String(name).startsWith('Cover')
      ? '<w:keepNext/><w:spacing w:before="0" w:after="60"/>'
      : String(name).startsWith('Metric')
        ? '<w:spacing w:before="0" w:after="30" w:line="240" w:lineRule="auto"/>'
        : name === 'InsightTitle'
          ? `<w:keepNext/><w:pBdr><w:left w:val="single" w:sz="16" w:space="8" w:color="${theme.amber}"/></w:pBdr><w:spacing w:before="140" w:after="80"/>`
          : name === 'Heading1'
            ? `<w:keepNext/><w:shd w:val="clear" w:fill="${theme.pale}"/><w:spacing w:before="220" w:after="120"/><w:ind w:left="140" w:right="100"/>`
            : name === 'Heading2'
              ? `<w:keepNext/><w:pBdr><w:left w:val="single" w:sz="14" w:space="7" w:color="${theme.teal}"/></w:pBdr><w:spacing w:before="150" w:after="80"/>`
              : name === 'Title'
                ? '<w:keepNext/><w:spacing w:before="60" w:after="160"/>'
                : name === 'Brand'
                  ? '<w:keepNext/><w:spacing w:after="40"/>'
                  : name === 'Footer'
                    ? '<w:jc w:val="right"/>'
                    : ['TableText', 'TableHeading', 'TableMetric', 'Metadata', 'Caption'].includes(
                          String(name)
                        )
                      ? '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
                      : '';
    return `<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:pPr>${layout}${heading ? `<w:outlineLvl w:val="${name === 'Heading1' ? 0 : 1}"/>` : ''}</w:pPr><w:rPr><w:sz w:val="${size}"/><w:color w:val="${color}"/>${['Title', 'Brand', 'Heading1', 'Heading2', 'TableHeading', 'TableMetric', 'CoverTitle', 'CoverTeam', 'MetricValue', 'InsightTitle'].includes(String(name)) ? '<w:b/>' : ''}</w:rPr></w:style>`;
  })
  .join('')}</w:styles>`;

/** 原生 OOXML：正文、表格、图表与各自内嵌工作簿均可在桌面办公软件编辑。 */
export async function renderTeamWeeklyDocx(
  report: TeamWeeklyReport,
  commentary?: TeamWeeklyCommentary,
  signal?: AbortSignal
): Promise<Buffer> {
  const check = () => {
    if (signal?.aborted) throw new Error('报告导出已取消');
  };
  check();
  // 拒绝超预算输入，不通过截断队员或明细控制资源。
  if (Buffer.byteLength(JSON.stringify(report)) > 12 * 1024 * 1024)
    throw new Error('报告超过导出资源预算');
  const zip = new JSZip();
  let relationshipsXml =
    rel('styles', 'styles', 'styles.xml') + rel('footer', 'footer', 'footer.xml');
  let overrides =
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>';
  const hasCover = report.templateVersion === 'weekly-v3';
  let body = hasCover
    ? coverHeader(report) +
      metadataTable(
        weeklyReportMetadata(report).filter(
          ([label]) => !['队伍', '报告周期', '训练周次'].includes(label)
        )
      )
    : p('竞迹  JINGJI · TRAINING REPORT', 'Brand') +
      p('专业运动队训练周总结报告', 'Title') +
      metadataTable(weeklyReportMetadata(report));
  const charts = documentCharts(
    teamWeeklyCharts(report),
    report.templateVersion === 'weekly-v3'
  ).filter((c) => c.points.length > 0);
  const compactChart = (chart: WeeklyChart) =>
    chart.id.startsWith('strength:') ||
    ['duration', 'srpe', 'rpe', 'sleep', 'pulse', 'fatigue'].includes(chart.id);
  let chartNumber = 0;
  async function appendChart(chart: WeeklyChart) {
    check();
    const n = ++chartNumber;
    if (n > 600) throw new Error('报告图表超过导出资源预算');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    const series = seriesFor(chart);
    if (
      series.length > 20 ||
      series.some(
        (s) =>
          s.values.length !== chart.points.length ||
          s.values.some((v) => v !== null && !Number.isFinite(v))
      )
    )
      throw new Error('报告图表数据无效');
    sheet.addRow(['队员 / 日期', ...series.map((s) => clean(s.name))]);
    chart.points.forEach((point, i) =>
      sheet.addRow([clean(point.label), ...series.map((s) => s.values[i])])
    );
    sheet.columns.forEach((column) => {
      column.width = 20;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    check();
    zip.file(`word/embeddings/data${n}.xlsx`, Buffer.from(buffer));
    zip.file(`word/charts/chart${n}.xml`, chartXml(chart));
    zip.file(
      `word/charts/_rels/chart${n}.xml.rels`,
      relationships(rel('data', 'package', `../embeddings/data${n}.xlsx`))
    );
    overrides += `<Override PartName="/word/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    relationshipsXml += rel(`chart${n}`, 'chart', `charts/chart${n}.xml`);
    body +=
      p(`${chart.title}${chart.unit ? `（${chart.unit}）` : ''}`, 'Heading2') +
      drawing(
        n,
        `chart${n}`,
        compactChart(chart) ? 3.05 : 6.45,
        chart.id.startsWith('strength:')
          ? Math.max(
              2.6,
              0.8 +
                chart.points.length *
                  (chart.points.some((p) => [...p.label].length > 10) ? 0.2 : 0.142)
            )
          : compactChart(chart)
            ? 2.2
            : 2.55
      ) +
      (chart.id.startsWith('strength:') ? '' : p(chart.note, 'Caption')) +
      (!series.some((s) => s.values.some((v) => v !== null)) ? p('数据待补充。', 'Caption') : '');
  }
  const editGuidance = p(
    '编辑提示：在图表“编辑数据”中补填空白数值；修改后请核对正文及其他表格。本地修改无需回传，不改变系统训练数据。',
    'Caption'
  );
  async function appendCharts(items: WeeklyChart[]) {
    const grid: string[] = [];
    const notes = new Set<string>();
    const flush = () => {
      if (!grid.length) return;
      body += `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>${Array.from({ length: Math.ceil(grid.length / 2) }, (_, i) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${[0, 1].map((j) => `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${grid[i * 2 + j] || p('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${p('')}`;
      grid.length = 0;
    };
    for (const chart of items) {
      if (!compactChart(chart)) {
        flush();
        await appendChart(chart);
        continue;
      }
      if (chart.id.startsWith('strength:')) notes.add(chart.note);
      const before = body;
      await appendChart(chart);
      grid.push(body.slice(before.length));
      body = before;
    }
    flush();
    body += [...notes].map((note) => p(note, 'Caption')).join('');
  }
  const usedCommentary = new Set<string>();
  const sections = teamWeeklySections(report);
  const overview = sections.find((s) => s.title === '1.1 本周核心指标');
  if (hasCover) {
    body +=
      p('01｜本周训练概览', 'Heading1') +
      coverMetrics(report, overview?.rows || []) +
      p('本周概括', 'InsightTitle');
    const summary = sections.find((s) => s.commentaryKey === 'summary');
    if (commentary?.summary.trim()) {
      body += p(commentary.summary);
      usedCommentary.add('summary');
    }
    body += (summary?.paragraphs || [])
      .filter((text) => !commentary?.summary.trim() || !report.summary.includes(text))
      .map((text) => p(text))
      .join('');
    body += p('训练投入与节奏', 'Heading2');
    await appendCharts(charts.filter((c) => ['duration', 'srpe'].includes(c.id)));
  }
  for (const section of sections) {
    if (
      hasCover &&
      ['01｜本周训练概览', '1.1 本周核心指标', '1.2 本周训练目标及完成评价'].includes(section.title)
    )
      continue;
    if (hasCover && section.title === '02｜训练计划与执行分析')
      body += '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:after="0"/></w:pPr></w:p>';
    check();
    body += p(section.title, /^\d\.\d/.test(section.title) ? 'Heading2' : 'Heading1');
    const key =
      section.commentaryKey ||
      (/本周训练摘要|本周概述/.test(section.title)
        ? 'summary'
        : /^三、专项/.test(section.title)
          ? 'training'
          : /^四、体能/.test(section.title)
            ? 'strength'
            : /^五、恢复/.test(section.title)
              ? 'recovery'
              : /下周/.test(section.title) && !/^附/.test(section.title)
                ? 'nextWeek'
                : undefined);
    if (key && commentary?.[key] && !usedCommentary.has(key)) {
      body += p(commentary[key]);
      usedCommentary.add(key);
    }
    body += section.paragraphs
      .filter(
        (text) =>
          !(
            section.commentaryKey === 'summary' &&
            commentary?.summary.trim() &&
            report.summary.includes(text)
          )
      )
      .map((v) => p(v, /口径/.test(section.title) ? 'Caption' : 'Normal'))
      .join('');
    if (section.headers && section.rows?.length) {
      const timetable = section.title === '统一七天课表' && section.headers.length === 7;
      body += timetable
        ? table(
            section.headers.filter((_, i) => i !== 4 && i !== 5),
            section.rows.map((row) => [
              row[0]!,
              row[1]!,
              row[2]!,
              row[2] === '体能'
                ? `${row[3]}（详见体能处方）`
                : [row[3], row[4], row[5]].filter((v) => v && v !== '—').join('；'),
              row[6]!,
            ])
          )
        : table(section.headers, section.rows);
    }
    if (hasCover && section.title === '2.2 周训练量和负荷' && overview?.headers && overview.rows) {
      body += overview.paragraphs.map((text) => p(text, 'Caption')).join('');
      body += table(
        overview.headers,
        overview.rows.filter(
          (row) => !['训练课次', '有效参与人数', '训练负荷 / SRPE'].includes(row[0]!)
        )
      );
    }
    await appendCharts(
      charts.filter(
        (c) => c.section === section.title && (!hasCover || !['duration', 'srpe'].includes(c.id))
      )
    );
  }
  for (const key of ['training', 'strength', 'recovery', 'nextWeek'] as const)
    if (commentary?.[key] && !usedCommentary.has(key))
      body +=
        p(
          {
            training: '专项分析',
            strength: '体能分析',
            recovery: '恢复反馈',
            nextWeek: '下周重点',
          }[key],
          'Heading2'
        ) + p(commentary[key]);
  body += editGuidance;
  overrides +=
    '<Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>';
  zip.file(
    'word/footer.xml',
    `${decl}<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>竞迹 · 训练周总结 | 第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t> 页</w:t></w:r></w:p></w:ftr>`
  );
  zip.file(
    '[Content_Types].xml',
    `${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>${overrides}</Types>`
  );
  zip.file('_rels/.rels', relationships(rel('document', 'officeDocument', 'word/document.xml')));
  zip.file('word/_rels/document.xml.rels', relationships(relationshipsXml));
  zip.file('word/styles.xml', styles);
  zip.file(
    'word/document.xml',
    `${decl}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`
  );
  check();
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }, () => check());
}
