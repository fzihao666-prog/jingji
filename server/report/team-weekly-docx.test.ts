import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
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
  it('照片四张一页保持比例，空附件不出页；拒绝预算和非法照片并响应取消', async () => {
    const report = fixture();
    const data = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#cccccc' },
    })
      .jpeg()
      .toBuffer();
    const archive = await JSZip.loadAsync(
      await renderTeamWeeklyDocx(
        report,
        undefined,
        Array.from({ length: 5 }, () => ({ data, width: 80, height: 40 }))
      )
    );
    const document = await archive.file('word/document.xml')!.async('string');
    expect(document.match(/附录 C｜训练照片及说明/g)).toHaveLength(2);
    expect(document.match(/<pic:pic /g)).toHaveLength(5);
    expect(document).toContain('cx="2788920" cy="1394460"');
    await expect(
      renderTeamWeeklyDocx(report, undefined, [{ data: Buffer.from('bad'), width: 1, height: 1 }])
    ).rejects.toThrow('JPEG');
    await expect(
      renderTeamWeeklyDocx(
        report,
        undefined,
        Array.from({ length: 13 }, () => ({ data, width: 80, height: 40 }))
      )
    ).rejects.toThrow('预算');
    const controller = new AbortController();
    controller.abort();
    await expect(renderTeamWeeklyDocx(report, undefined, [], controller.signal)).rejects.toThrow(
      '取消'
    );
    const active = new AbortController();
    const pending = renderTeamWeeklyDocx(report, undefined, [], active.signal);
    active.abort();
    await expect(pending).rejects.toThrow('取消');
  });
});
