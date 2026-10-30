import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import type { TeamWeeklyReport } from '../../shared/team-weekly-report.js';
import type { TeamWeeklyCommentary } from '../../shared/team-weekly-ai.js';
import { teamWeeklySections, weeklyReportMetadata } from '../../shared/team-weekly-sections.js';
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
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${text
    .split('\n')
    .map(
      (v, i) =>
        `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${xml(v)}</w:t></w:r>`
    )
    .join('')}</w:p>`;
const page = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
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
  const row = (cells: string[], head = false) =>
    `<w:tr><w:trPr><w:cantSplit/>${head ? '<w:tblHeader/>' : ''}</w:trPr>${cells.map((v, i) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${head ? '<w:shd w:fill="E8EEF5"/>' : ''}</w:tcPr>${p(v, head ? 'TableHeading' : 'TableText')}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((v) => `<w:${v} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(headers, true)}${rows.map((v) => row(v)).join('')}</w:tbl>`;
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
function chartXml(chart: WeeklyChart) {
  const series = seriesFor(chart);
  const horizontal = chart.id.startsWith('strength:');
  const strCache = `<c:strCache><c:ptCount val="${chart.points.length}"/>${chart.points.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v.label)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const colors = ['2563EB', '93A4B8', '0F766E'];
  const body = series
    .map((s, si) => {
      const col = String.fromCharCode(66 + si);
      return `<c:ser><c:idx val="${si}"/><c:order val="${si}"/><c:tx><c:strRef><c:f>Data!$${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xml(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${colors[si % colors.length]}"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="${colors[si % colors.length]}"/></a:solidFill></a:ln></c:spPr><c:cat><c:strRef><c:f>Data!$A$2:$A$${chart.points.length + 1}</c:f>${strCache}</c:strRef></c:cat><c:val><c:numRef><c:f>Data!$${col}$2:$${col}$${chart.points.length + 1}</c:f><c:numCache><c:formatCode>0.##</c:formatCode><c:ptCount val="${chart.points.length}"/>${s.values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef></c:val></c:ser>`;
    })
    .join('');
  const kind = chart.kind === 'line' ? 'lineChart' : 'barChart';
  return `${decl}<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:lang val="zh-CN"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:${kind}>${kind === 'barChart' ? `<c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/>` : '<c:grouping val="standard"/>'}${body}${kind === 'barChart' ? '<c:gapWidth val="70"/>' : ''}<c:axId val="1"/><c:axId val="2"/></c:${kind}><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="850"/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="1"/><c:tickMarkSkip val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/>${chart.domain ? `<c:max val="${chart.domain.max}"/><c:min val="${chart.domain.min}"/>` : ''}</c:scaling><c:axPos val="${horizontal ? 'b' : 'l'}"/><c:majorGridlines/><c:numFmt formatCode="0.##" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/></c:valAx></c:plotArea>${series.length > 1 ? '<c:legend><c:legendPos val="b"/><c:layout/></c:legend>' : ''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="850"/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr><c:externalData r:id="data"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
function drawing(id: number, rid: string, width: number, height: number, image = false) {
  const cx = Math.round(width * 914400),
    cy = Math.round(height * 914400);
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${image ? '训练照片' : '可编辑图表'} ${id}"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${image ? 'http://schemas.openxmlformats.org/drawingml/2006/picture' : C}">${image ? `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="训练照片"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` : `<c:chart xmlns:c="${C}" r:id="${rid}"/>`}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
const styles = `${decl}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/><w:lang w:val="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="90" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[
  ['Normal', 20],
  ['Title', 40],
  ['Subtitle', 20],
  ['Heading1', 27],
  ['Heading2', 23],
  ['TableText', 18],
  ['TableHeading', 18],
  ['Caption', 17],
]
  .map(
    ([name, size]) =>
      `<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:pPr>${String(name).startsWith('Heading') ? '<w:keepNext/><w:spacing w:before="180" w:after="100"/>' : String(name).startsWith('Table') || name === 'Caption' ? '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' : ''}</w:pPr><w:rPr><w:sz w:val="${size}"/>${['Title', 'Heading1', 'Heading2', 'TableHeading'].includes(String(name)) ? '<w:b/><w:color w:val="153451"/>' : ''}</w:rPr></w:style>`
  )
  .join('')}</w:styles>`;

/** 原生 OOXML：正文、表格、图表与各自内嵌工作簿均可在桌面办公软件编辑。 */
export async function renderTeamWeeklyDocx(
  report: TeamWeeklyReport,
  commentary?: TeamWeeklyCommentary,
  photos: { data: Buffer; width: number; height: number }[] = [],
  signal?: AbortSignal
): Promise<Buffer> {
  const check = () => {
    if (signal?.aborted) throw new Error('报告导出已取消');
  };
  check();
  // 拒绝超预算输入，不通过截断队员或明细控制资源。
  if (
    Buffer.byteLength(JSON.stringify(report)) > 12 * 1024 * 1024 ||
    photos.length > 8 ||
    photos.reduce((n, v) => n + v.data.length, 0) > 24 * 1024 * 1024
  )
    throw new Error('报告或照片超过导出资源预算');
  for (const photo of photos)
    if (
      !Number.isFinite(photo.width) ||
      !Number.isFinite(photo.height) ||
      photo.width <= 0 ||
      photo.height <= 0 ||
      photo.data[0] !== 0xff ||
      photo.data[1] !== 0xd8
    )
      throw new Error('报告照片必须为已处理的JPEG');
  const zip = new JSZip();
  let relationshipsXml = rel('styles', 'styles', 'styles.xml');
  let overrides =
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>';
  let body =
    p('竞迹｜专业运动队训练周总结报告', 'Title') +
    weeklyReportMetadata(report)
      .map(([label, value]) => p(`${label}：${value}`, 'Subtitle'))
      .join('');
  const charts = documentCharts(
    teamWeeklyCharts(report),
    report.templateVersion === 'weekly-v3'
  ).filter((c) => c.points.length > 0);
  const rendered = new Set<string>();
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
        chart.id.startsWith('strength:') ? 3.05 : 6.45,
        chart.id.startsWith('strength:')
          ? Math.max(
              2.6,
              0.8 +
                chart.points.length *
                  (chart.points.some((p) => [...p.label].length > 10) ? 0.2 : 0.142)
            )
          : 2.65
      ) +
      (chart.id.startsWith('strength:') ? '' : p(chart.note, 'Caption')) +
      (!series.some((s) => s.values.some((v) => v !== null))
        ? p('暂无有效数据。已保留图表及完整内嵌数据表，请在图表中选择“编辑数据”补填。', 'Caption')
        : '');
    rendered.add(chart.id);
  }
  const editGuidance =
    p('文档编辑提示', 'Heading2') +
    p(
      '下载后的文档可自行编辑，无需回传，不自动同步系统。所有预设图表均保留；缺失数值在内嵌数据表中留空，可在图表的“编辑数据”中补填。修改图表数据不会自动改写正文、附录或其他图表，请核对相关数字与结论。'
    );
  let guidanceAdded = false;
  async function appendCharts(items: WeeklyChart[]) {
    const grid: string[] = [];
    const notes = new Set<string>();
    const flush = () => {
      if (!grid.length) return;
      body += `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>${Array.from({ length: Math.ceil(grid.length / 2) }, (_, i) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${[0, 1].map((j) => `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${grid[i * 2 + j] || p('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${p('')}`;
      grid.length = 0;
    };
    for (const chart of items) {
      if (!chart.id.startsWith('strength:')) {
        flush();
        await appendChart(chart);
        continue;
      }
      notes.add(chart.note);
      const before = body;
      await appendChart(chart);
      grid.push(body.slice(before.length));
      body = before;
    }
    flush();
    body += [...notes].map((note) => p(note, 'Caption')).join('');
  }
  const usedCommentary = new Set<string>();
  for (const section of teamWeeklySections(report)) {
    check();
    if (section.title.startsWith('附录') && !guidanceAdded) {
      body += editGuidance;
      guidanceAdded = true;
    }
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
    await appendCharts(charts.filter((c) => c.section === section.title));
  }
  await appendCharts(charts.filter((c) => !rendered.has(c.id)));
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
  if (!guidanceAdded) body += editGuidance;
  for (let i = 0; i < photos.length; i += 4) {
    body += page + p('附录 C｜训练照片及说明', 'Heading1');
    const cells: string[] = [];
    for (let j = i; j < Math.min(i + 4, photos.length); j++) {
      const photo = photos[j]!;
      const scale = Math.min(3.05 / photo.width, 3.2 / photo.height);
      zip.file(`word/media/photo${j}.jpg`, photo.data);
      relationshipsXml += rel(`photo${j}`, 'image', `media/photo${j}.jpg`);
      cells.push(
        `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>${drawing(1000 + j, `photo${j}`, photo.width * scale, photo.height * scale, true)}${p(`照片 ${j + 1}`, 'Caption')}</w:tc>`
      );
    }
    if (cells.length % 2) cells.push(`<w:tc>${p('')}</w:tc>`);
    body += `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>${Array.from({ length: cells.length / 2 }, (_, k) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.slice(k * 2, k * 2 + 2).join('')}</w:tr>`).join('')}</w:tbl>`;
  }
  zip.file(
    '[Content_Types].xml',
    `${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Default Extension="jpg" ContentType="image/jpeg"/>${overrides}</Types>`
  );
  zip.file('_rels/.rels', relationships(rel('document', 'officeDocument', 'word/document.xml')));
  zip.file('word/_rels/document.xml.rels', relationships(relationshipsXml));
  zip.file('word/styles.xml', styles);
  zip.file(
    'word/document.xml',
    `${decl}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`
  );
  check();
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }, () => check());
}
