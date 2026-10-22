import {
  UNIFIED_IMPORT_HEADERS,
  BODY_TEMPLATE_FIELDS,
  FITNESS_TEMPLATE_METRICS,
  FMS_TEMPLATE_METRICS,
} from './data-import-template.js';
import {
  STRENGTH_TRAINING_CATEGORIES,
  STRENGTH_BODY_POSITIONS,
  STRENGTH_TRAINING_ENVIRONMENTS,
  STRENGTH_INTENSITY_ZONES,
} from './strength-training.js';
import { TECHNICAL_LEVELS } from './athlete-technical-level.js';

/** 版本存于说明页的保留单元格，由工作簿名称引用，不占业务数据区。 */
export const IMPORT_TEMPLATE_VERSION = 'jingji-import-v2';
export const IMPORT_TEMPLATE_VERSION_NAME = '_JINGJI_IMPORT_TEMPLATE_VERSION';
export type TemplateRequirement = '必填' | '条件必填' | '选填' | '系统预填' | '系统计算';
export type ImportTemplateField = {
  key: string;
  requirement: TemplateRequirement;
  unit: string;
  example: string;
  hint: string;
  advanced: boolean;
  choices?: readonly string[];
};

/** 第一行始终为旧版稳定表头；其余行仅用于人类阅读。 */
export function templateHeaderKey(value: string): string {
  return value.split(/\r?\n/)[0].trim();
}

const commonColumns: Record<string, string[]> = {
  运动员基本资料: [
    '系统运动员编号',
    '姓名',
    '运动项目',
    '所属队伍',
    '性别',
    '出生日期',
    '技术等级',
    '备注',
  ],
  身体测量: ['系统运动员编号', '姓名', '测量日期', '体重kg', '身高cm', '臂展cm', '体脂率%'],
  体能测试: [
    '系统运动员编号',
    '姓名',
    '测试日期',
    'VO2Max',
    'CMJ峰值功率W',
    '无氧功率W/kg',
    'IMTP峰值力量N',
    '不对称指数%',
    '测试协议',
  ],
  FMS测试: ['系统运动员编号', '姓名', '测试日期', ...FMS_TEMPLATE_METRICS.map(([key]) => key)],
  训练课次: [
    '系统运动员编号',
    '姓名',
    '日期',
    '课次序号',
    '时长分钟',
    '距离千米',
    '开始时间',
    '训练类型',
    '训练内容',
    'RPE',
  ],
  力量训练组次: [
    '系统运动员编号',
    '姓名',
    '日期',
    '课次序号',
    '课次名称',
    '动作',
    '组序',
    '实际次数',
    '实际重量kg',
    'RPE',
    '完成状态',
    '备注',
  ],
  每日恢复: ['系统运动员编号', '姓名', '日期', '睡眠小时', '睡眠质量', '疲劳', '肌肉酸痛', '情绪'],
  伤病记录: [
    '系统运动员编号',
    '姓名',
    '发生日期',
    '伤病名称',
    '部位',
    '侧别',
    '状态',
    '疼痛评分',
    '训练限制',
    '备注',
  ],
  竞技评估: [
    '系统运动员编号',
    '姓名',
    '评估日期',
    '总分',
    '等级',
    '一般耐力评分',
    '核心力量评分',
    '评估协议',
  ],
  其他测试: [
    '系统运动员编号',
    '姓名',
    '测试日期',
    '指标代码',
    '指标名称',
    '数值',
    '单位',
    '测试类型',
    '协议',
    '侧别',
  ],
  训练结果数据: [
    '系统运动员编号',
    '运动员',
    '队伍',
    '训练日期',
    '训练场次',
    '动作',
    '组次',
    '实际次数',
    '实际重量kg',
    'RPE',
    '是否完成',
    '备注',
  ],
  专项训练成绩: [
    '训练日期',
    '项目',
    '训练距离(m)',
    '艇型',
    '性别组别',
    '运动员/组合',
    '运动员姓名',
    '第1轮',
    '第2轮',
    '第3轮',
    '上午/下午',
  ],
};

export const STRENGTH_IMPORT_HEADERS = [
  '系统运动员编号',
  '运动员',
  '队伍',
  '训练日期',
  '训练项目（小项）',
  '训练场次',
  '训练类型',
  '身体位置',
  '训练环境',
  '动作',
  '组次',
  '计划次数',
  '实际次数',
  '计划重量kg',
  '实际重量kg',
  '强度%',
  '强度区间',
  '训练时间min',
  '训练距离km',
  'RPE',
  '是否完成',
  '备注',
];
export const SPECIAL_IMPORT_HEADERS = [
  '训练日期',
  '项目',
  '训练距离(m)',
  '艇型',
  '性别组别',
  '运动员/组合',
  '运动员姓名',
  '上午/下午',
  '风向风速',
  '训练地点',
  '历史最好',
  '第1轮',
  '第2轮',
  '第3轮',
  '备注',
];

const units: Record<string, string> = {
  ...Object.fromEntries(BODY_TEMPLATE_FIELDS.map(([key, , , , unit]) => [key, unit || '无单位'])),
  ...Object.fromEntries(FITNESS_TEMPLATE_METRICS.map(([key, , , unit]) => [key, unit])),
  ...Object.fromEntries(FMS_TEMPLATE_METRICS.map(([key]) => [key, '分'])),
  时长分钟: 'min',
  距离千米: 'km',
  RPE: '无单位',
  SRPE: 'AU',
  SMVL: 'kg·次',
  平均心率: 'bpm',
  最大心率: 'bpm',
  平均功率W: 'W',
  桨频SPM: 'SPM',
  实际次数: '次',
  计划次数: '次',
  实际重量kg: 'kg',
  计划重量kg: 'kg',
  强度百分比: '%',
  '强度%': '%',
  组次时长分钟: 'min',
  组次距离千米: 'km',
  训练时间min: 'min',
  训练距离km: 'km',
  睡眠小时: 'h',
  晨脉: 'bpm',
  睡眠质量: '分',
  疲劳: '分',
  肌肉酸痛: '分',
  情绪: '分',
  疼痛评分: '分',
  总分: '分',
  一般耐力评分: '分',
  核心力量评分: '分',
  专项耐力: '分',
  力量爆发: '分',
  技术效率: '分',
  负荷适应: '分',
  恢复能力: '分',
  比赛能力: '分',
  测试时长分钟: 'min',
  '训练距离(m)': 'm',
  第1轮: 'm:ss.SS 或秒',
  第2轮: 'm:ss.SS 或秒',
  第3轮: 'm:ss.SS 或秒',
  历史最好: 'm:ss.SS 或秒',
  单位: '指标字典单位',
  数值: '指标字典单位',
  目标值: '与实测值同单位',
  开始时间: 'HH:mm',
};
const examples: Record<string, string> = {
  系统运动员编号: '系统生成',
  姓名: '张某',
  运动员: '张某',
  运动员姓名: '张某、李某',
  '运动员/组合': '张某 / 一艇组合',
  运动项目: '赛艇',
  项目: '赛艇',
  所属队伍: '一队',
  队伍: '一队',
  性别: '男',
  省份: '浙江省',
  城市: '杭州市',
  区县: '西湖区',
  民族: '汉族',
  手机号: '按实际号码填写',
  血型: 'A',
  紧急联系人: '李某',
  紧急电话: '按实际号码填写',
  学历: '本科',
  技术等级: '一级运动员',
  位置号位: '1号位',
  身体状态: '健康',
  最好成绩: '原始成绩及单位',
  籍贯: '浙江杭州',
  家庭住址: '实际联系地址',
  训练状态: '在训',
  训练场地: '训练中心',
  备战赛事: '实际赛事名称',
  备战阶段: '基础期',
  集训时间: '2026-10-01至2026-10-15',
  输送地: '杭州',
  输送单位: '实际单位名称',
  输送教练: '王某',
  优势项: '专项耐力',
  备注: '本次实测',
  课次序号: '1',
  组序: '1',
  组次: '1',
  开始时间: '08:30',
  训练类型: '基础力量',
  训练内容: '水上耐力训练',
  训练阶段: '基础期',
  强度区间: 'U2',
  时长分钟: '60',
  距离千米: '12.5',
  RPE: '6',
  SRPE: '360',
  SMVL: '360',
  平均心率: '140',
  最大心率: '175',
  桨频SPM: '22',
  课次名称: '上午力量',
  训练场次: '上午力量',
  动作: '深蹲',
  动作代码: 'squat',
  实际次数: '6',
  计划次数: '6',
  实际重量kg: '60',
  计划重量kg: '60',
  强度百分比: '80',
  '强度%': '80',
  类别: '基础力量',
  身体部位: '下肢',
  身体位置: '下肢',
  训练环境: '陆上',
  完成状态: '已完成',
  是否完成: '是',
  身高cm: '180',
  臂展cm: '185',
  体重kg: '75',
  '体脂率%': '15',
  细胞外水比: '0.38',
  '相位角°': '6',
  内脏脂肪等级: '5',
  基础代谢kcal: '1800',
  睡眠小时: '8',
  睡眠质量: '4',
  晨脉: '55',
  疲劳: '2',
  肌肉酸痛: '2',
  情绪: '4',
  伤病名称: '踝关节扭伤',
  部位: '踝关节',
  侧别: '左',
  状态: '正常',
  疼痛评分: '2',
  训练限制: '避免跑跳',
  康复计划: '按专业人员制定的方案填写',
  总分: '按既有评价协议原值填写',
  等级: '建设',
  一般耐力评分: '按既有协议填写',
  核心力量评分: '按既有协议填写',
  评估协议: '本队已采用的评分协议名称及版本',
  测试协议: '实际设备、方法与版本',
  协议: '实际测试方法及版本',
  测试类型: '专项测试',
  指标代码: 'vertical_jump_cm',
  指标名称: '纵跳',
  数值: '45',
  单位: 'cm',
  目标值: '50',
  艇型: '按当前项目实际艇型填写',
  性别组别: '男子',
  '训练距离(m)': '250',
  第1轮: '0:55.15',
  第2轮: '0:56.20',
  第3轮: '0:55.80',
  历史最好: '0:54.90',
  '上午/下午': '上午',
  风向风速: '顺风 1m/s',
  训练地点: '训练基地',
  '训练项目（小项）': '男子双人划艇',
  VO2Max: '55',
  '不对称指数%': '8',
  CMJ峰值功率W: '3000',
  '无氧功率W/kg': '12',
  IMTP峰值力量N: '2000',
};
const choices: Record<string, readonly string[]> = {
  性别: ['男', '女'],
  技术等级: TECHNICAL_LEVELS,
  血型: ['A', 'B', 'AB', 'O'],
  训练类型: STRENGTH_TRAINING_CATEGORIES,
  类别: STRENGTH_TRAINING_CATEGORIES,
  身体部位: STRENGTH_BODY_POSITIONS,
  身体位置: STRENGTH_BODY_POSITIONS,
  训练环境: STRENGTH_TRAINING_ENVIRONMENTS,
  强度区间: STRENGTH_INTENSITY_ZONES,
  完成状态: ['已完成', '未完成'],
  是否完成: ['是', '否'],
};

export function importTemplateFields(sheet: string): ImportTemplateField[] {
  const original =
    UNIFIED_IMPORT_HEADERS.find(([name]) => name === sheet)?.[1] ??
    (sheet === '训练结果数据'
      ? STRENGTH_IMPORT_HEADERS
      : sheet === '专项训练成绩'
        ? SPECIAL_IMPORT_HEADERS
        : []);
  const common = commonColumns[sheet] || original;
  const ordered = [...common, ...original.filter((key) => !common.includes(key))];
  return ordered.map((key) => {
    let requirement: TemplateRequirement = '选填';
    let hint = '仅填写实际已采集数据，未提供留空。';
    const unit = /日期$/.test(key) ? 'YYYY-MM-DD' : units[key] || '无单位';
    let example =
      examples[key] ||
      (/日期$/.test(key)
        ? '2026-10-01'
        : unit === '分'
          ? '按现有评分协议填写'
          : unit === '无单位'
            ? '按原始记录填写'
            : '12.5');
    let fieldChoices = key === '训练类型' && sheet === '训练课次' ? undefined : choices[key];
    if (key === '系统运动员编号') {
      requirement = '系统预填';
      hint = '已有人员编号优先定位，不可自行编造；无编号时按姓名、项目和队伍确认。';
    }
    if (['姓名', '运动员'].includes(key)) {
      requirement = '条件必填';
      hint = '无有效系统编号或新建人员时必填；已有人员预填供核对。';
    }
    if (['所属队伍', '队伍', '运动项目', '项目'].includes(key)) {
      requirement = '条件必填';
      hint = '使用已明确的授权项目、队伍；可由上下文预填，不得跨项目或通过导入调队。';
    }
    if (key === '出生日期') hint = '档案选填；不套用注册必填规则，不根据年龄反推生日。';
    else if (['日期', '测量日期', '测试日期', '发生日期', '评估日期', '训练日期'].includes(key)) {
      requirement = '条件必填';
      hint = '本行日期或上传页明确选择的统一日期必须提供一个；不自动使用今天。';
    }
    if (['课次序号', '组序', '组次', '训练场次'].includes(key)) {
      requirement = '条件必填';
      hint = /组/.test(key)
        ? '同动作多组必须区分组序；仅一组可默认1。'
        : '同人同日多课必须明确所属课次；仅一课可使用默认值。';
    }
    if (key === '时长分钟' || key === '距离千米') {
      requirement = '条件必填';
      hint = '时长或距离至少一项；仅承载有效力量组次的课次可同时留空。';
    }
    if (['动作', '实际次数', '实际重量kg', '伤病名称', '部位'].includes(key)) {
      requirement = '必填';
      hint =
        key === '实际重量kg'
          ? '真实外加重量；徒手可填0，未采集留空并纠错，不能编造0。'
          : '填写实际记录。';
    }
    if (key === 'RPE') hint = '0—10；未采集留空。时长与RPE齐全时系统计算SRPE；缺RPE仍可导入。';
    if (key === 'SRPE' || key === 'SMVL')
      hint = '专业外部来源选填；日常无需手算。系统计算规则见填写说明，外部原值按既有冲突规则处理。';
    if (sheet === '身体测量' && BODY_TEMPLATE_FIELDS.some(([header]) => header === key))
      hint = '本表至少填写一项实测指标，未测留空；不要与每日体重重复作为同一事实填报。';
    if (sheet === '体能测试') {
      if (key === '测试协议') {
        requirement = '条件必填';
        hint = '不对称指数必须注明设备、方法或协议；其他成绩建议注明方法以便比较。';
      } else if (FITNESS_TEMPLATE_METRICS.some(([header]) => header === key))
        hint = '本表至少一项实测成绩；不得以0代表未测。';
    }
    if (sheet === 'FMS测试' && FMS_TEMPLATE_METRICS.some(([header]) => header === key)) {
      example = '2';
      hint = '整数0—3，未测留空；至少一项；七项齐全才生成完整21分制总分。';
      fieldChoices = ['0', '1', '2', '3'];
    }
    if (sheet === '每日恢复') {
      if (key === '睡眠质量' || key === '情绪') hint = '0—10分，越高越好；仅填本人实际报告。';
      if (key === '疲劳' || key === '肌肉酸痛') hint = '0—10分，越高越严重；仅填本人实际报告。';
      if (key === '状态') {
        fieldChoices = ['normal', 'rest', 'attention', 'alert', 'missing'];
        example = 'normal';
        hint =
          'normal正常、rest休息、attention关注、alert警报、missing缺失；至少一项恢复数值或状态，不能仅备注。';
      }
    }
    if (key === '疼痛评分') hint = '0—10分；0表示无痛，未采集必须留空。';
    if (sheet === '伤病记录') {
      if (key === '状态') {
        example = '观察';
        fieldChoices = ['健康', '观察', '限训', '康复', '停训'];
        hint = '空白新增时沿用观察状态，不自动推断诊断。';
      }
      if (key === '侧别') fieldChoices = ['左', '右', '双侧', '未指定'];
    }
    if (sheet === '其他测试') {
      if (key === '指标代码' || key === '数值') {
        requirement = '必填';
        hint = '按项目指标字典填写；一项指标一行。';
      }
      if (key === '单位') {
        requirement = '条件必填';
        hint = '可由已知指标字典确定；不能确定时必须补充，冲突不得静默换算。';
      }
      if (key === '侧别') {
        requirement = '条件必填';
        fieldChoices = ['左', '右', '双侧', '中央'];
        hint = '侧别指标按实际方法填写；普通中央指标可留空，按既有规则处理。';
      }
    }
    if (sheet === '竞技评估' && key === '总分') {
      requirement = '条件必填';
      hint =
        '新增竞技状态记录需有依据的原始总分；单项一般耐力/核心力量评分可单独填写并注明评估协议，不能编造总分。';
    }
    if (sheet === '竞技评估' && key === '评估协议') {
      requirement = '条件必填';
      hint = '一般耐力和核心力量评分必须填写协议；禁止虚构总分或维度得分。';
    }
    if (sheet === '专项训练成绩') {
      if (key === '项目') {
        requirement = '必填';
        fieldChoices = ['赛艇', '皮划艇', '激流'];
        hint = '必须与当前项目空间、所有成员归属一致。';
      }
      if (key === '训练距离(m)' || key === '运动员/组合') {
        requirement = '必填';
        hint =
          key === '训练距离(m)'
            ? '本表用米，不是课次表的千米。'
            : '单人填姓名即可；多人可填写组合名称并在成员列列齐成员。';
      }
      if (key === '运动员姓名') {
        requirement = '条件必填';
        hint = '组合名称未列出完整成员时必填，成员用“、”分隔；单人无需重复填姓名。';
      }
      if (['艇型', '性别组别'].includes(key)) {
        requirement = '条件必填';
        hint = '需要分组排名时必填；留空显示未分组，不与明确分组混排。';
      }
      if (/^第[123]轮$/.test(key)) {
        requirement = '条件必填';
        hint = '至少一轮有效成绩；第2、3轮未测留空，系统计算有效轮次平均和最好成绩。';
      }
      if (key === '历史最好') hint = '外部已知历史原值选填；不要求手算，比较必须满足既有可比条件。';
    }
    if (key === '训练日期' && ['训练结果数据', '专项训练成绩'].includes(sheet)) {
      requirement = '必填';
      hint = '必须填写本次记录的真实日期；不自动补今天。';
    }
    return {
      key,
      requirement,
      unit,
      example,
      hint,
      advanced: !common.includes(key),
      choices: fieldChoices,
    };
  });
}

export function templateFieldHeader(field: ImportTemplateField): string {
  return `${field.key}\n${field.requirement}｜${field.unit}\n例：${field.example}`;
}

export const TEMPLATE_CALCULATION_NOTES = [
  '常用列在前；专业选填列在右侧默认收起，点左上角分组级别“2”展开。不支持分组时使用取消隐藏列；不使用宏。',
  '第1—3行是说明和表头，第4行起填写；示例仅在表头，不需要删除示例数据。隐藏列有值仍会校验和导入。',
  '业务日期须在行内填写，或在上传页明确选择统一日期；新模板不静默使用今天，生日永不补填。',
  '系统预填：授权范围内的人员编号、姓名、项目和队伍；不要自行编造编号，不预填测量成绩。',
  'SRPE：有效时长(min)×RPE，单位AU；缺时长或RPE保持未提供，不能根据距离推算时长。',
  'SMVL/力量训练量：按现有规则汇总实际次数×实际重量kg；计划数不是实际数，外部显式总量沿用既有优先策略。',
  'FMS：七项齐全才生成完整21分制总分，未测不补0。专项：按有效轮次计算平均、最好及同条件排名；无可比历史显示缺失。',
  '年龄由真实生日计算；冠军模型、雷达图和参考值由系统分析，不要求填报。Excel公式不作为计算事实源。',
  '必填条件见列批注。空白是未提供，真实0保留；非法文本报错。仅预填身份和日期的业务行自动忽略。',
  '已有记录只按非空值更新，空白保留已有值；跨项目、越权、同名歧义及同日多课归属必须在提交前解决。',
];
