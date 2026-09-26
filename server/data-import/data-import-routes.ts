import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express } from 'express';
import { db } from '../core/db.ts';
import {
  analyzeDataImport,
  commitDataImport,
  getDataImportBatch,
  listDataImportBatches,
  updateDataImportAthleteCandidates,
  updateDataImportItems,
} from './data-import.ts';
import { accessibleAthleteIds, accountPermissions, hasAthleteAccess } from '../core/permissions.ts';
import { strengthImportCandidates } from '../strength/strength-training-routes.ts';
import { cleanString } from '../core/utils.ts';
import { dataImportUpload } from '../core/uploads.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { PROJECTS, normalizeProject } from '../../shared/projects.ts';
import { INTENSITY_ZONE_SYSTEMS } from '../../shared/training-intensity.ts';
import type { AuthUser, Project } from '../core/shared-server.ts';

export function dataImportScope(user: AuthUser, project: string) {
  const permissions = accountPermissions(user.id);
  const projectAllowed =
    permissions.projects.includes('*') || permissions.projects.includes(project);
  const allTeams = (
    db
      .prepare('SELECT name FROM project_teams WHERE project = ? AND active = 1 ORDER BY name')
      .all(project) as Array<{ name: string }>
  ).map((row) => row.name);
  const allowedTeams = new Set(
    allTeams.filter((team) =>
      permissions.teams.some(
        (item) =>
          (item.project === '*' || item.project === project) &&
          (item.team === '*' || item.team === team)
      )
    )
  );
  const area = permissions.areas[0];
  return {
    allowed: projectAllowed && allowedTeams.size > 0,
    allowedTeams,
    defaultArea: {
      region: area?.areaLevel === 'national' ? '未设置' : area?.province || '未设置',
      city: area && ['city', 'county'].includes(area.areaLevel) ? area.city || '未设置' : '未设置',
      county: area?.areaLevel === 'county' ? area.county || '未设置' : '未设置',
    },
  };
}

export const unifiedTemplateName = '竞迹统一数据导入模板.xlsx';
export const unifiedTemplatePath = () =>
  [
    resolve(process.cwd(), 'public', 'templates', unifiedTemplateName),
    resolve(process.cwd(), 'dist', 'templates', unifiedTemplateName),
  ].find(existsSync);

export const unifiedExportHeaders: Array<[string, string[]]> = [
  [
    '运动员信息',
    [
      '姓名',
      '运动项目',
      '所属队伍',
      '性别',
      '出生日期',
      '身份证号',
      '省份',
      '城市',
      '区县',
      '民族',
      '手机号',
      '血型',
      '紧急联系人',
      '紧急电话',
      '学历',
      '技术等级',
      '位置号位',
      '身体状态',
      '最好成绩',
      '籍贯',
      '家庭住址',
      '训练状态',
      '开始运动日期',
      '训练场地',
      '备战赛事',
      '备战阶段',
      '集训时间',
      '输送地',
      '输送单位',
      '输送教练',
      '优势项',
      '备注',
    ],
  ],
  [
    '竞技水平评估',
    [
      '姓名',
      '评估日期',
      '技术等级',
      '最好成绩',
      '竞技总分',
      '竞技状态',
      '专项耐力',
      '力量爆发',
      '技术效率',
      '负荷适应',
      '恢复能力',
      '比赛能力',
      '备注',
    ],
  ],
  [
    '身体测量',
    [
      '姓名',
      '测量日期',
      '身高cm',
      '体重kg',
      '体脂率%',
      '骨骼肌kg',
      '肌肉量kg',
      '上肢肌肉kg',
      '下肢肌肉kg',
      '躯干肌肉kg',
      '皮下脂肪mm',
      '肱三头肌皮褶mm',
      '腹部皮褶mm',
      '大腿皮褶mm',
      '小腿皮褶mm',
      '内脏脂肪等级',
      '基础代谢kcal',
      '总水分kg',
      '细胞外水比',
      '相位角°',
      '内脏脂肪面积cm²',
      '左上肢瘦体重kg',
      '右上肢瘦体重kg',
      '躯干瘦体重kg',
      '左下肢瘦体重kg',
      '右下肢瘦体重kg',
      '备注',
    ],
  ],
  [
    '恢复状态',
    [
      '姓名',
      '日期',
      '睡眠小时',
      '睡眠质量',
      '晨脉',
      '体重kg',
      '疲劳',
      '肌肉酸痛',
      '情绪',
      '状态',
      '备注',
    ],
  ],
  [
    '训练课次',
    [
      '姓名',
      '日期',
      '课次序号',
      '开始时间',
      '训练类型',
      '训练内容',
      '训练阶段',
      '强度区间',
      '时长分钟',
      '距离千米',
      'RPE',
      'SRPE',
      'SMVL',
      '平均心率',
      '最大心率',
      '平均功率W',
      '桨频SPM',
    ],
  ],
  [
    '力量训练组次',
    [
      '姓名',
      '日期',
      '课次名称',
      '动作',
      '组序',
      '计划次数',
      '实际次数',
      '计划重量kg',
      '实际重量kg',
      '强度百分比',
      'RPE',
      '完成状态',
      '类别',
      '身体部位',
      '备注',
    ],
  ],
  [
    '测试指标',
    [
      '姓名',
      '测试日期',
      '测试类型',
      '指标代码',
      '指标名称',
      '数值',
      '单位',
      '侧别',
      '协议',
      '备注',
      '测试时长分钟',
    ],
  ],
  [
    'FMS测试',
    [
      '姓名',
      '测试日期',
      '深蹲',
      '跨栏步',
      '直线弓步蹲',
      '肩部灵活性',
      '主动直腿上抬',
      '躯干稳定俯卧撑',
      '旋转稳定性',
      '备注',
    ],
  ],
  [
    '冠军模型测试',
    [
      '姓名',
      '测试日期',
      '身高cm',
      '臂展cm',
      '体脂率%',
      '骨骼肌kg',
      '一般耐力评分',
      'VO2Max',
      '不对称指数%',
      'CMJ峰值功率W',
      '无氧功率W/kg',
      'IMTP峰值力量N',
      '核心力量评分',
      '测试协议',
      '备注',
    ],
  ],
  [
    '伤病记录',
    [
      '姓名',
      '发生日期',
      '伤病名称',
      '部位',
      '侧别',
      '状态',
      '疼痛评分',
      '训练限制',
      '康复计划',
      '复查日期',
      '备注',
    ],
  ],
  [
    '竞技状态',
    [
      '姓名',
      '评估日期',
      '总分',
      '等级',
      '专项耐力',
      '力量爆发',
      '技术效率',
      '负荷适应',
      '恢复能力',
      '比赛能力',
      '备注',
    ],
  ],
];

export function writeUnifiedExportRows(sheet: ExcelJS.Worksheet | undefined, rows: unknown[][]) {
  if (!sheet) return;
  rows.forEach((values, index) => {
    sheet.getRow(index + 4).values = values as ExcelJS.CellValue[];
  });
}

export async function buildUnifiedDataExport(project: string, athleteIds: number[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  const instructions = workbook.addWorksheet('填写说明');
  instructions.getCell('A1').value = '竞迹训练监控系统｜统一数据导出';
  instructions.getCell('A3').value =
    '本文件与“下载统一数据模板”使用相同的工作表和字段；保留第1—3行即可再次导入。具体合理区间见“数据字典”。';
  instructions.getColumn(1).width = 110;
  for (const [name, headers] of unifiedExportHeaders) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.getCell('A1').value = name;
    sheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF246BFD' } };
    sheet.getCell('A2').value = '由竞迹训练监控系统导出；保留表头后可作为统一数据导入文件使用。';
    const header = sheet.getRow(3);
    header.values = headers;
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172033' } };
    header.alignment = { horizontal: 'center', vertical: 'middle' };
    headers.forEach((label, index) => {
      sheet.getColumn(index + 1).width = /备注|内容|地址|计划/.test(label)
        ? 24
        : /姓名|日期|项目|队伍|类型|状态/.test(label)
          ? 16
          : 13;
    });
  }
  const dictionary = workbook.addWorksheet('数据字典');
  dictionary.addRow(['指标代码', '指标名称', '单位', '业务域', '最小值', '最大值', '说明']);
  [
    ['height_cm', '身高', 'cm', '身体形态', 100, 230],
    ['weight_kg', '体重', 'kg', '身体形态', 30, 200],
    ['squat_kg', '深蹲', 'kg', '力量', 0, 450],
    ['deadlift_kg', '硬拉', 'kg', '力量', 0, 500],
    ['bench_press_kg', '卧推', 'kg', '力量', 0, 350],
    ['vertical_jump_cm', '纵跳', 'cm', '爆发力', 0, 120],
    ['fms_deep_squat', 'FMS深蹲', '分', 'FMS', 0, 3],
    ['vo2max_ml_kg_min', '最大摄氧量', 'ml/kg/min', '冠军模型', 20, 90],
  ].forEach((row) => dictionary.addRow([...row, '合理区间，超出后需人工确认']));
  if (!athleteIds.length) return workbook;
  const placeholders = athleteIds.map(() => '?').join(',');
  const profileRows = db
    .prepare(
      `
    SELECT a.id, a.name, a.project, COALESCE(pt.name, '') AS team, a.gender, a.birth_date, COALESCE(ao.province, '未设置') AS region, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
      ap.identity_number, ap.ethnicity, ap.phone, ap.blood_type, ap.emergency_contact, ap.emergency_phone,
      ap.education, ap.technical_level, ap.position, ap.health_status, ap.best_result, ap.native_place,
      ap.home_address, ap.athlete_status, ap.start_sport_date, ap.training_venue, ap.current_event,
      ap.training_phase, ap.camp_period, ap.origin_place, ap.origin_unit, ap.origin_coach, ap.specialties, ap.notes
    FROM athletes a LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    LEFT JOIN project_teams pt ON pt.id = a.team_id LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
    WHERE a.id IN (${placeholders}) AND a.project = ? AND a.active = 1 ORDER BY pt.name, a.name
  `
    )
    .all(...athleteIds, project) as Array<Record<string, unknown>>;
  const profileIds = profileRows.map((row) => Number(row.id));
  if (!profileIds.length) return workbook;
  const ids = profileIds.map(() => '?').join(',');
  const nameById = new Map(profileRows.map((row) => [Number(row.id), String(row.name)]));
  writeUnifiedExportRows(
    workbook.getWorksheet('运动员信息'),
    profileRows.map((row) => [
      row.name,
      row.project,
      row.team,
      row.gender,
      row.birth_date,
      row.identity_number,
      row.region,
      row.city,
      row.county,
      row.ethnicity,
      row.phone,
      row.blood_type,
      row.emergency_contact,
      row.emergency_phone,
      row.education,
      row.technical_level,
      row.position,
      row.health_status,
      row.best_result,
      row.native_place,
      row.home_address,
      row.athlete_status,
      row.start_sport_date,
      row.training_venue,
      row.current_event,
      row.training_phase,
      row.camp_period,
      row.origin_place,
      row.origin_unit,
      row.origin_coach,
      row.specialties,
      row.notes,
    ])
  );
  const bodyRows = db
    .prepare(
      `SELECT * FROM athlete_body_measurements WHERE athlete_id IN (${ids}) ORDER BY measurement_date, athlete_id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('身体测量'),
    bodyRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.measurement_date,
      row.height_cm,
      row.weight_kg,
      row.body_fat_pct,
      row.skeletal_muscle_kg,
      row.muscle_mass_kg,
      row.upper_limb_muscle_kg,
      row.lower_limb_muscle_kg,
      row.trunk_muscle_kg,
      row.subcutaneous_fat_mm,
      row.triceps_skinfold_mm,
      row.abdominal_skinfold_mm,
      row.thigh_skinfold_mm,
      row.calf_skinfold_mm,
      row.visceral_fat_level,
      row.basal_metabolism_kcal,
      row.total_body_water_kg,
      row.ecw_tbw_ratio,
      row.phase_angle_deg,
      row.visceral_fat_area_cm2,
      row.left_arm_lean_kg,
      row.right_arm_lean_kg,
      row.trunk_lean_kg,
      row.left_leg_lean_kg,
      row.right_leg_lean_kg,
      row.note,
    ])
  );
  const wellnessRows = db
    .prepare(
      `SELECT * FROM daily_wellness WHERE athlete_id IN (${ids}) ORDER BY wellness_date, athlete_id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('恢复状态'),
    wellnessRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.wellness_date,
      row.sleep_hours,
      row.sleep_quality,
      row.morning_pulse,
      row.weight_kg,
      row.fatigue_index,
      row.soreness_index,
      row.mood_index,
      row.status,
      '',
    ])
  );
  const sessionRows = db
    .prepare(
      `SELECT * FROM training_sessions WHERE athlete_id IN (${ids}) ORDER BY session_date, athlete_id, session_order`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('训练课次'),
    sessionRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.session_date,
      row.session_order,
      row.start_time,
      row.training_type,
      row.content,
      row.structure_type,
      row.intensity_zone,
      row.duration_min,
      row.distance_km,
      row.rpe,
      row.srpe,
      row.smvl,
      row.average_heart_rate,
      row.max_heart_rate,
      row.average_power_w,
      row.stroke_rate_spm,
    ])
  );
  const setRows = db
    .prepare(
      `SELECT srs.*, ts.athlete_id, ts.session_date, ts.content FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id WHERE ts.athlete_id IN (${ids}) ORDER BY ts.session_date, ts.athlete_id, srs.id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('力量训练组次'),
    setRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.session_date,
      row.content,
      row.exercise_name,
      row.set_index,
      row.target_reps,
      row.actual_reps,
      null,
      row.actual_weight_kg,
      row.intensity_percent,
      row.rpe,
      Number(row.completed) ? '完成' : '未完成',
      row.training_category,
      row.body_position,
      row.note,
    ])
  );
  const testRows = db
    .prepare(
      `SELECT ts.athlete_id, ts.test_date, ts.test_type, ts.duration_min, ts.protocol, tm.metric_code, tm.value_num, tm.unit, tm.side, md.label FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id LEFT JOIN metric_definitions md ON md.code = tm.metric_code WHERE ts.athlete_id IN (${ids}) ORDER BY ts.test_date, ts.athlete_id, tm.id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('测试指标'),
    testRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.test_date,
      row.test_type,
      row.metric_code,
      row.label || row.metric_code,
      row.value_num,
      row.unit,
      row.side,
      row.protocol,
      '',
      row.duration_min,
    ])
  );
  const sideLabel: Record<string, string> = {
    left: '左',
    right: '右',
    bilateral: '双侧',
    center: '中央',
    unspecified: '未指定',
  };
  const statusLabel: Record<string, string> = {
    healthy: '健康',
    observation: '观察',
    restricted: '限训',
    rehab: '康复',
    suspended: '停训',
  };
  const injuryRows = db
    .prepare(
      `SELECT * FROM injury_records WHERE athlete_id IN (${ids}) ORDER BY onset_date, athlete_id, id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('伤病记录'),
    injuryRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.onset_date,
      row.injury_name,
      row.body_part,
      sideLabel[String(row.side)] || row.side,
      statusLabel[String(row.status)] || row.status,
      row.pain_score,
      row.restrictions,
      row.rehab_plan,
      row.review_date,
      row.note,
    ])
  );
  const stateLabel: Record<string, string> = {
    peak: '巅峰',
    good: '良好',
    build: '建设',
    adjust: '调整',
  };
  const stateRows = db
    .prepare(
      `SELECT * FROM competitive_state_assessments WHERE athlete_id IN (${ids}) ORDER BY assessment_date, athlete_id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('竞技状态'),
    stateRows.map((row) => [
      nameById.get(Number(row.athlete_id)),
      row.assessment_date,
      row.overall_score,
      stateLabel[String(row.state_level)] || row.state_level,
      row.endurance_score,
      row.power_score,
      row.technique_score,
      row.load_adaptation_score,
      row.recovery_score,
      row.competition_score,
      row.note,
    ])
  );
  const profileById = new Map(profileRows.map((row) => [Number(row.id), row]));
  writeUnifiedExportRows(
    workbook.getWorksheet('竞技水平评估'),
    stateRows.map((row) => {
      const profile = profileById.get(Number(row.athlete_id));
      return [
        nameById.get(Number(row.athlete_id)),
        row.assessment_date,
        profile?.technical_level,
        profile?.best_result,
        row.overall_score,
        stateLabel[String(row.state_level)] || row.state_level,
        row.endurance_score,
        row.power_score,
        row.technique_score,
        row.load_adaptation_score,
        row.recovery_score,
        row.competition_score,
        row.note,
      ];
    })
  );
  return workbook;
}

export function registerDataImportRoutes(app: Express) {
  app.get(
    '/api/data-import/template',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (_req, res) => {
      // 本地开发从 public 读取；生产环境可能只保留 dist，因此提供构建产物兜底。
      const templatePath = unifiedTemplatePath();
      if (!templatePath) return res.status(404).json({ message: '统一数据导入模板尚未部署。' });
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.download(templatePath, unifiedTemplateName);
    }
  );

  app.get(
    '/api/data-import/export',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    async (req, res) => {
      try {
        const project = normalizeProject(cleanString(req.query.project));
        if (!project) return res.status(400).json({ message: '请选择有效的运动项目。' });
        const scope = dataImportScope(req.authUser!, project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号无权导出该项目数据。' });
        const athleteIds = strengthImportCandidates(req.authUser!)
          .filter((athlete) => athlete.project === project)
          .map((athlete) => athlete.id);
        const workbook = await buildUnifiedDataExport(project, athleteIds);
        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `竞迹${project}统一数据导出_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        res.send(Buffer.from(buffer));
      } catch (error) {
        res
          .status(500)
          .json({ message: error instanceof Error ? error.message : '统一数据导出失败。' });
      }
    }
  );

  app.post(
    '/api/data-import/analyze',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    dataImportUpload.single('file'),
    (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: '请选择要导入的 Excel 文件。' });
        const project = cleanString(req.body?.project);
        if (!PROJECTS.includes(project))
          return res.status(400).json({ message: '请选择有效的运动项目。' });
        const scope = dataImportScope(req.authUser!, project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号在该项目下没有可导入的队伍权限。' });
        const athletes = strengthImportCandidates(req.authUser!).filter(
          (athlete) => athlete.project === project
        );
        const batch = analyzeDataImport({
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
          project,
          defaultDate: cleanString(req.body?.defaultDate),
          defaultArea: scope.defaultArea,
          userId: req.authUser!.id,
          athletes,
        });
        res.json({ batch });
      } catch (error) {
        res
          .status(400)
          .json({ message: error instanceof Error ? error.message : '数据文件解析失败。' });
      }
    }
  );

  app.get(
    '/api/data-import/batches',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const project = cleanString(req.query.project);
      if (!PROJECTS.includes(project))
        return res.status(400).json({ message: '请选择有效的运动项目。' });
      if (!dataImportScope(req.authUser!, project).allowed)
        return res.status(403).json({ message: '当前账号无权查看该项目的导入记录。' });
      res.json({ batches: listDataImportBatches(project, req.authUser!.id) });
    }
  );

  app.get(
    '/api/data-import/batches/:id',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        res.json({ batch: getDataImportBatch(cleanString(req.params.id), req.authUser!.id) });
      } catch (error) {
        res
          .status(404)
          .json({ message: error instanceof Error ? error.message : '导入批次不存在。' });
      }
    }
  );

  app.put(
    '/api/data-import/batches/:id/items',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        const corrections = Array.isArray(req.body?.corrections)
          ? req.body.corrections.slice(0, 5000)
          : [];
        const batch = updateDataImportItems({
          batchId: cleanString(req.params.id),
          userId: req.authUser!.id,
          athletes: strengthImportCandidates(req.authUser!),
          corrections,
        });
        res.json({ batch });
      } catch (error) {
        res
          .status(400)
          .json({ message: error instanceof Error ? error.message : '导入数据校验失败。' });
      }
    }
  );

  app.put(
    '/api/data-import/batches/:id/athletes',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        const batch = getDataImportBatch(cleanString(req.params.id), req.authUser!.id);
        const scope = dataImportScope(req.authUser!, batch.project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号无权在该项目创建运动员。' });
        const corrections = Array.isArray(req.body?.corrections)
          ? req.body.corrections.slice(0, 500)
          : [];
        const updated = updateDataImportAthleteCandidates({
          batchId: batch.id,
          userId: req.authUser!.id,
          allowedTeams: scope.allowedTeams,
          corrections,
        });
        res.json({ batch: updated });
      } catch (error) {
        res
          .status(400)
          .json({ message: error instanceof Error ? error.message : '新运动员资料保存失败。' });
      }
    }
  );

  app.post(
    '/api/data-import/batches/:id/commit',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        const conflictPolicy =
          cleanString(req.body?.conflictPolicy) === 'update' ? 'update' : 'skip';
        const result = commitDataImport({
          batchId: cleanString(req.params.id),
          userId: req.authUser!.id,
          creatorRole: req.authUser!.role,
          athletes: strengthImportCandidates(req.authUser!),
          allowedTeams: dataImportScope(
            req.authUser!,
            getDataImportBatch(cleanString(req.params.id), req.authUser!.id).project
          ).allowedTeams,
          conflictPolicy,
        });
        res.json({
          message: `已创建${result.createdAthletes || 0}名无账号运动员，写入${result.imported}条数据，跳过${result.skipped}条。`,
          ...result,
        });
      } catch (error) {
        res
          .status(400)
          .json({ message: error instanceof Error ? error.message : '导入提交失败。' });
      }
    }
  );

  app.get(
    '/api/data-management/metrics',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (_req, res) => {
      const metrics = db
        .prepare(
          `SELECT code, label, domain, unit, direction, frequency, active FROM metric_definitions ORDER BY active DESC, domain, label`
        )
        .all();
      const aliases = db
        .prepare(
          `SELECT alias, normalized_alias AS normalizedAlias, metric_code AS metricCode, canonical_label AS canonicalLabel, unit, side FROM metric_aliases ORDER BY metric_code, alias`
        )
        .all();
      res.json({ metrics, aliases });
    }
  );

  app.put(
    '/api/data-management/metrics/:code',
    requireAuth,
    requireRole('TD', 'DMD'),
    (req, res) => {
      const code = cleanString(req.params.code);
      const label = cleanString(req.body?.label);
      const unit = cleanString(req.body?.unit);
      const active = req.body?.active === false ? 0 : 1;
      if (!/^[a-z][a-z0-9_]{1,80}$/.test(code) || !label || label.length > 80 || unit.length > 24)
        return res.status(400).json({ message: '指标编码、名称或单位不合法。' });
      const result = db
        .prepare(
          `UPDATE metric_definitions SET label = ?, unit = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?`
        )
        .run(label, unit, active, code);
      if (!result.changes)
        return res.status(404).json({ message: '指标不存在；请先通过正式导入或迁移建立指标。' });
      res.json({ message: '指标字典已更新。' });
    }
  );

  app.put(
    '/api/data-management/metric-aliases',
    requireAuth,
    requireRole('TD', 'DMD'),
    (req, res) => {
      const alias = cleanString(req.body?.alias);
      const metricCode = cleanString(req.body?.metricCode);
      const side = ['left', 'right', 'bilateral', 'center'].includes(cleanString(req.body?.side))
        ? cleanString(req.body?.side)
        : 'center';
      const metric = db
        .prepare(`SELECT label, unit FROM metric_definitions WHERE code = ? AND active = 1`)
        .get(metricCode) as { label: string; unit: string } | undefined;
      if (!alias || alias.length > 80 || !metric)
        return res.status(400).json({ message: '别名或指标编码无效。' });
      db.prepare(
        `INSERT INTO metric_aliases (alias, normalized_alias, metric_code, canonical_label, unit, side) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(alias) DO UPDATE SET normalized_alias = excluded.normalized_alias, metric_code = excluded.metric_code, canonical_label = excluded.canonical_label, unit = excluded.unit, side = excluded.side, updated_at = CURRENT_TIMESTAMP`
      ).run(
        alias,
        alias.normalize('NFKC').replace(/\s+/g, '').toLowerCase(),
        metricCode,
        metric.label,
        metric.unit,
        side
      );
      res.json({ message: '指标别名已保存。' });
    }
  );

  app.get(
    '/api/data-management/standards',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (_req, res) => {
      res.json({
        athlete: ['athletes', 'athlete_profiles', 'athlete_origins', 'athlete_aliases'],
        training: {
          types: ['专项训练', '体能训练', '恢复训练', '休息'],
          structures: ['水上训练', '陆上训练', '体能训练', '再生恢复'],
          zoneSystems: INTENSITY_ZONE_SYSTEMS.map((system) => system.label),
        },
        testing: ['test_sessions', 'test_measurements', 'metric_definitions', 'metric_aliases'],
        sources: ['manual', 'file_import', 'ai_import', 'legacy_migration'],
        qualities: ['valid', 'partial', 'insufficient', 'outlier', 'estimated'],
        retiredTables: [
          'training_records',
          'athlete_strength_tests',
          'strength_training_sets',
          'strength_import_batches',
        ],
      });
    }
  );
}
