import { readFile } from 'node:fs/promises';

const page = await readFile('src/pages/PersonalPage.tsx', 'utf8');
const model = await readFile('src/components/AthleteProfileCharts.tsx', 'utf8');
const styles = await readFile('src/styles.css', 'utf8');
const assert = (value, message) => {
  if (!value) throw new Error(message);
};

assert(!page.includes('制胜要素分析'), '个人档案不应保留制胜要素分析区块');
assert(!page.includes('个人 vs 团队对比'), '个人档案不应保留团队对比区块');
assert(model.includes('身体成分模拟图'), '新版应以身体成分模拟图为主视觉');
assert(model.includes("from 'd3-scale'"), '模拟图必须显式使用 d3-scale');
assert(model.includes('scaleLinear'), '结构图必须用 D3 线性比例尺计算质量标尺');
assert(model.includes('scaleBand'), '节段图必须用 D3 带状比例尺计算行布局');
assert(model.includes('BodyCompositionSimulation'), '新版必须包含全新的身体成分模拟图');
assert(model.includes('body-sim-silhouette'), '模拟图必须包含完整人体轮廓，而非抽象色块');
assert(model.includes('body-sim-zone'), '人体模拟图必须拆分为可监测的身体分区');
assert(model.includes('body-segment-callout'), '每个身体监测分区必须有直接数值标注');
assert(model.includes('body-sim-metric-card'), '模拟图必须以左右数据卡呈现核心身体成分指标');
assert(model.includes("label: 'BMI'"), '模拟图必须在身高齐全时展示计算 BMI');
assert(model.includes("label: '肌肉量'"), '模拟图必须复用已有肌肉量实测字段');
assert(model.includes("label: '基础代谢'"), '模拟图必须复用已有基础代谢实测字段');
assert(model.includes("label: '内脏脂肪等级'"), '模拟图必须复用已有内脏脂肪实测字段');
assert(model.includes('SegmentalLeanBalance'), '新版必须包含节段去脂量平衡图');
assert(!model.includes('03 / RE-TEST'), '身体成分模块不应保留复测轨迹卡片');
assert(model.includes('body-chart-mobile-list'), '窄屏必须有可读的同数据文本布局');
assert(!model.includes('HumanModel'), '不得保留旧人体模拟图');
assert(!model.includes('seeded('), '不得生成伪造的身体成分数据');
assert(!model.includes('本期模拟'), '缺失数据不得显示模拟值');
assert(styles.includes('body-composition-atlas'), '新版必须使用独立的体成分结构图样式');
console.log(JSON.stringify({ status: 'ok' }));
