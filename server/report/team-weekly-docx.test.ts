import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { renderTeamWeeklyDocx } from './team-weekly-docx.ts';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyCharts } from '../../shared/team-weekly-charts.ts';

function fixture() {
  const db = createTeamWeeklyFixture();
  try {
    return readTeamWeeklyReport(
      db,
      { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'physical' },
      [1, 3]
    );
  } finally {
    db.close();
  }
}
describe('原生Word周总结', () => {
  it('嵌入原生图表与逐值一致的工作簿，缺失不写0，全文与用户文本可编辑且不成为公式或外链', async () => {
    const report = fixture();
    report.teamName = '=HYPERLINK("https://evil.test")<&\u0001';
    report.summary = ['正文 <script> & "测试"\u0001'];
    report.strength = Array.from({ length: 35 }, (_, i) => ({
      athleteId: i + 1,
      athleteName: i === 0 ? '=HYPERLINK("https://evil.test")<&\u0001' : `队员${i + 1}`,
      exercise: '深蹲',
      sets: 1,
      reps: 1,
      volumeKg: i,
    }));
    report.daily[1].duration = null;
    report.daily[2].duration = 0;
    const archive = await JSZip.loadAsync(await renderTeamWeeklyDocx(report));
    const document = await archive.file('word/document.xml')!.async('string');
    expect(document).toContain('&lt;script&gt; &amp; &quot;测试&quot;');
    expect(document).not.toContain('\u0001');
    expect(document).toContain('队员35');
    expect(document).not.toContain('训练照片');
    expect(Object.keys(archive.files).filter((v) => v.endsWith('.jpg'))).toHaveLength(0);
    const charts = teamWeeklyCharts(report).filter((c) => c.points.some((p) => p.value !== null));
    expect(Object.keys(archive.files).filter((v) => /chart\d+\.xml$/.test(v))).toHaveLength(
      charts.length
    );
    for (let i = 0; i < charts.length; i++) {
      const chart = charts[i]!;
      const chartXml = await archive.file(`word/charts/chart${i + 1}.xml`)!.async('string');
      expect(chartXml).toContain('<c:externalData r:id="data">');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        await archive.file(`word/embeddings/data${i + 1}.xlsx`)!.async('arraybuffer')
      );
      const sheet = workbook.getWorksheet('Data')!;
      chart.points.forEach((point, j) => {
        expect(sheet.getCell(j + 2, 1).value).toBe(point.label.split('\u0001').join(''));
        expect(sheet.getCell(j + 2, 2).value).toBe(point.value);
        if (point.value !== null)
          expect(chartXml).toContain(`<c:pt idx="${j}"><c:v>${point.value}</c:v></c:pt>`);
      });
      const xlsx = await JSZip.loadAsync(
        await archive.file(`word/embeddings/data${i + 1}.xlsx`)!.async('nodebuffer')
      );
      expect(await xlsx.file('xl/worksheets/sheet1.xml')!.async('string')).not.toContain('<f>');
    }
    for (const file of Object.values(archive.files).filter((v) => v.name.endsWith('.rels')))
      expect(await file.async('string')).not.toMatch(/TargetMode="External"|https:\/\/evil/);
  });
  it('综合v3将40人无损合组为24+16人，两列同域双系列与内嵌表一致', async () => {
    const db = createTeamWeeklyFixture();
    const report = readTeamWeeklyReport(
      db,
      { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'combined' },
      [1, 3]
    );
    db.close();
    const athlete = report.athletes[0]!;
    report.athletes = Array.from({ length: 40 }, (_, i) => ({
      ...athlete,
      id: i + 1,
      name: `综合队员${i + 1}`,
    }));
    report.strength = report.athletes.slice(0, 39).map((a, i) => ({
      athleteId: a.id,
      athleteName: a.name,
      exercise: '深蹲',
      sets: 1,
      reps: 1,
      volumeKg: i * 10,
    }));
    report.strengthPrevious = report.strength.map((s) => ({ ...s, volumeKg: s.volumeKg + 5 }));
    report.strengthComparable = true;
    const archive = await JSZip.loadAsync(await renderTeamWeeklyDocx(report));
    const document = await archive.file('word/document.xml')!.async('string');
    expect(document).toContain('<w:tblLayout w:type="fixed"/>');
    expect(document).toContain('3.2 关键力量训练统计');
    expect(document).toContain('本周暂无有效记录');
    expect(await archive.file('word/styles.xml')!.async('string')).not.toContain('17365D');
    const labels: unknown[] = [];
    const groupSizes: number[] = [];
    for (const path of Object.keys(archive.files)
      .filter((p) => /embeddings\/data\d+\.xlsx$/.test(p))
      .sort((a, b) => Number(a.match(/data(\d+)/)![1]) - Number(b.match(/data(\d+)/)![1]))) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await archive.file(path)!.async('arraybuffer'));
      const sheet = workbook.getWorksheet('Data')!;
      if (sheet.getCell(1, 2).value !== '本周') continue;
      if (
        Array.from({ length: sheet.rowCount - 1 }, (_, i) => sheet.getCell(i + 2, 2).value).every(
          (v) => v === null
        )
      ) {
        expect(sheet.rowCount - 1).toBeOneOf([24, 16]);
        continue;
      }
      groupSizes.push(sheet.rowCount - 1);
      const chartXml = await archive
        .file(path.replace('embeddings/data', 'charts/chart').replace('.xlsx', '.xml'))!
        .async('string');
      expect(chartXml).toContain('<c:max val="385"/>');
      expect(chartXml).toContain('<c:barDir val="bar"/>');
      expect(chartXml).toContain('上周');
      for (let row = 2; row <= sheet.rowCount; row++) {
        const index = labels.length;
        labels.push(sheet.getCell(row, 1).value);
        expect(sheet.getCell(row, 2).value).toBe(index === 39 ? null : index * 10);
        expect(sheet.getCell(row, 3).value).toBe(index === 39 ? null : index * 10 + 5);
        if (index !== 39)
          for (const value of [index * 10, index * 10 + 5])
            expect(chartXml).toContain(`<c:pt idx="${row - 2}"><c:v>${value}</c:v></c:pt>`);
      }
    }
    expect(groupSizes).toEqual([24, 16]);
    expect(labels).toEqual(report.athletes.map((a) => a.name));
  });
  it('导出预算和取消仍有效', async () => {
    const report = fixture();
    await expect(
      renderTeamWeeklyDocx({ ...report, coachNotes: '长'.repeat(5 * 1024 * 1024) })
    ).rejects.toThrow('预算');
    const controller = new AbortController();
    controller.abort();
    await expect(renderTeamWeeklyDocx(report, undefined, controller.signal)).rejects.toThrow(
      '取消'
    );
    const active = new AbortController();
    const pending = renderTeamWeeklyDocx(report, undefined, active.signal);
    active.abort();
    await expect(pending).rejects.toThrow('取消');
  });
});

it('综合报告无数据也保留13个原生图表、全部日期/名单与空白内嵌数据表', async () => {
  const db = createTeamWeeklyFixture();
  const report = readTeamWeeklyReport(
    db,
    { project: 'ROWING', teamId: 1, date: '2026-11-02', reportType: 'combined' },
    [1, 3]
  );
  db.close();
  const charts = teamWeeklyCharts(report);
  expect(charts).toHaveLength(13);
  expect(charts.every((c) => c.points.length > 0 && c.points.every((p) => p.value === null))).toBe(
    true
  );
  expect(
    charts.filter((c) => c.id.startsWith('strength:')).map((c) => c.points.map((p) => p.label))
  ).toEqual(Array.from({ length: 4 }, () => report.athletes.map((a) => a.name)));
  const zip = await JSZip.loadAsync(await renderTeamWeeklyDocx(report));
  const parts = Object.keys(zip.files).filter((p) => /charts\/chart\d+\.xml$/.test(p));
  expect(parts).toHaveLength(13);
  for (const part of parts) {
    const xml = await zip.file(part)!.async('string');
    expect(xml).toContain('<c:catAx>');
    expect(xml).toContain('<c:valAx>');
    expect(xml).toContain('<c:dispBlanksAs val="gap"/>');
    expect(xml).not.toContain('<c:v>0</c:v>');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await zip
        .file(part.replace('charts/chart', 'embeddings/data').replace('.xml', '.xlsx'))!
        .async('arraybuffer')
    );
    const sheet = workbook.getWorksheet('Data')!;
    expect(sheet.getCell(1, 1).value).toBe('队员 / 日期');
    expect(sheet.rowCount).toBeGreaterThan(1);
    for (let row = 2; row <= sheet.rowCount; row++) {
      expect(sheet.getCell(row, 1).value).toBeTruthy();
      for (let column = 2; column <= sheet.columnCount; column++)
        expect(sheet.getCell(row, column).value).toBeNull();
    }
  }
  const document = await zip.file('word/document.xml')!.async('string');
  expect(document).toContain('编辑数据');
  expect(document).not.toContain('不生成空图');
});

it('综合成品仅保留五章正文及13个预设图表，无附录、明细或照片', async () => {
  const db = createTeamWeeklyFixture();
  const report = readTeamWeeklyReport(
    db,
    { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'combined' },
    [1, 3]
  );
  db.close();
  const archive = await JSZip.loadAsync(await renderTeamWeeklyDocx(report));
  const document = await archive.file('word/document.xml')!.async('string');
  expect(document).not.toContain('附录');
  expect(document).not.toContain('全员正式训练明细');
  expect(document).not.toContain('全员力量组明细');
  expect(document).not.toContain('训练照片');
  for (const title of [
    '01｜本周训练概览',
    '02｜训练计划与执行分析',
    '03｜重点训练内容与运动员表现',
    '04｜训练反应、恢复与风险管理',
    '05｜下周训练目标与调整计划',
  ])
    expect(document).toContain(title);
  expect(Object.keys(archive.files).filter((p) => /charts\/chart\d+\.xml$/.test(p))).toHaveLength(
    13
  );
  expect(Object.keys(archive.files).some((p) => p.startsWith('word/media/'))).toBe(false);
});

it('图表采用统一轻网格与中文字体，趋势有点标记，短序列有值标签且保留可编辑数据', async () => {
  const db = createTeamWeeklyFixture();
  const report = readTeamWeeklyReport(
    db,
    { project: 'ROWING', teamId: 1, date: '2026-11-02', reportType: 'combined' },
    [1, 3]
  );
  db.close();
  const archive = await JSZip.loadAsync(await renderTeamWeeklyDocx(report));
  const charts = await Promise.all(
    Object.keys(archive.files)
      .filter((p) => /charts\/chart\d+\.xml$/.test(p))
      .map((p) => archive.file(p)!.async('string'))
  );
  expect(charts).toHaveLength(13);
  for (const chart of charts) {
    expect(chart).toContain('Microsoft YaHei');
    expect(chart).toContain('E8EDF3');
    expect(chart).toContain('<c:majorTickMark val="none"/>');
    expect(chart).toContain('<c:externalData r:id="data">');
    if (chart.includes('<c:lineChart>')) {
      expect(chart).toContain('<c:symbol val="circle"/>');
      expect(chart).toContain('<c:smooth val="0"/>');
    }
    if (!chart.includes('<c:barDir val="bar"/>')) expect(chart).toContain('<c:showVal val="1"/>');
    else expect(chart).not.toContain('<c:showVal val="1"/>');
  }
});
