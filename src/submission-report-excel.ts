import { projectLabel } from '../shared/projects';
import type { BasicSubmissionReport, SubmissionReport } from '../shared/submission-report';

export async function downloadSubmissionExcel(report: SubmissionReport) {
  const xlsx = await import('@e965/xlsx');
  const workbook = xlsx.utils.book_new();
  const counts = report.teams.map(() => report.types.map(() => 0));
  for (const [team, type] of report.records) counts[team][type]++;
  const coachRows = report.coaches
    .map((coach) => {
      const teams = report.teams
        .map((team, index) => ({ ...team, index }))
        .filter((team) => team.coaches.includes(coach.id));
      const values = report.types.map((_, type) =>
        teams.reduce((sum, team) => sum + counts[team.index][type], 0)
      );
      return { coach, teams, values, total: values.reduce((sum, value) => sum + value, 0) };
    })
    .sort((a, b) => b.total - a.total || a.coach.name.localeCompare(b.coach.name, 'zh-CN'));
  const addSheet = (name: string, rows: (string | number)[][]) => {
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet['!cols'] = rows[0].map(() => ({ wch: 22 }));
    xlsx.utils.book_append_sheet(workbook, sheet, name);
  };
  addSheet('教练总览', [
    ['教练', '岗位', '所带队伍', ...report.types, '队伍数据总量'],
    ...coachRows.map(({ coach, teams, values, total }) => [
      coach.name,
      coach.roles.join('、'),
      teams.map((team) => `${projectLabel(team.project)} · ${team.name || '未分队'}`).join('、'),
      ...values,
      total,
    ]),
  ]);
  addSheet('队伍汇总', [
    ['项目', '队伍', ...report.types, '数据总量'],
    [
      '全部授权项目',
      '系统总数（去重）',
      ...report.types.map((_, type) => counts.reduce((sum, row) => sum + row[type], 0)),
      report.records.length,
    ],
    ...report.teams.map((team, index) => [
      projectLabel(team.project),
      team.name || '未分队',
      ...counts[index],
      counts[index].reduce((sum, value) => sum + value, 0),
    ]),
  ]);
  addSheet('数据明细', [
    ['记录编号', '项目', '队伍', '数据类型', '业务日期'],
    ...report.records.map(([team, type, date, id]) => [
      id,
      projectLabel(report.teams[team].project),
      report.teams[team].name || '未分队',
      report.types[type],
      date,
    ]),
  ]);
  xlsx.writeFile(workbook, '队伍数据检查.xlsx');
}

export async function downloadBasicSubmissionExcel(report: BasicSubmissionReport) {
  const xlsx = await import('@e965/xlsx');
  const workbook = xlsx.utils.book_new();
  for (const { name, rows } of report.sheets) {
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet['!cols'] = rows[0].map((heading, column) => ({
      wch: Math.min(52, Math.max(14, String(heading).length * 2 + 2, ...rows.slice(1, 101).map(row => String(row[column] ?? '').length + 3))),
    }));
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    xlsx.utils.book_append_sheet(workbook, sheet, name);
  }
  const team = report.team.replace(/[<>:"/\\|?*]/g, '_');
  xlsx.writeFile(workbook, `基本信息检查_${team}_${report.asOf}.xlsx`);
}
