// 专项训练演示记录生成器：向 training_sessions 写入近 8 周的专项训练课次，
// 覆盖全部强度分区与训练内容分类，让专项页的训练量、强度占比、课次占比有完整数据可展示。
//
// 用法：
//   node scripts/generate-special-training-demo.mjs          # 先清理本脚本写入的记录，再重新生成（幂等）
//   node scripts/generate-special-training-demo.mjs --clean  # 仅清理，不生成
//
// 约定：
// - 只写新训练事实表 training_sessions；source='generated' 便于识别与后续清理。
// - 不读取、不输出运动员姓名等身份信息，只打印聚合计数。
// - 演示数据供展示排版使用；后续接入真实数据后执行 --clean 即可移除。
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dbPath = resolve(process.cwd(), process.env.DATABASE_PATH || 'data/training-monitor.db');
const cleanOnly = process.argv.includes('--clean');

const db = new DatabaseSync(dbPath);
const existing = db.prepare("SELECT COUNT(*) AS count FROM training_sessions WHERE source = 'generated'").get().count;
db.prepare("DELETE FROM training_sessions WHERE source = 'generated'").run();
if (cleanOnly) {
  console.log(JSON.stringify({ cleaned: existing, database: dbPath }));
  db.close();
  process.exit(0);
}

// 模板的 content/structure 取值经过 shared/training-content-category.ts 的分类规则映射到九类训练内容；
// 「其它」类需要文本不含“专项训练”整词（否则命中水上分支），故用「专项课」类型。
// 强度分区只用填报端的标准七类（U3/U2/U1/AT/TPT/AN/ATP），与强度占比展示维度一致。
const TEMPLATES = [
  { category: '水上', trainingType: '专项训练', structureType: '水上专项', content: '水上划行', zones: ['U2', 'U1', 'AT'], duration: [90, 150], distance: [12, 22] },
  { category: '测功仪', trainingType: '专项训练', structureType: '专项训练', content: '测功仪间歇', zones: ['TPT', 'AN'], duration: [50, 80], distance: [8, 13] },
  { category: '功能', trainingType: '专项训练', structureType: '功能训练', content: '核心稳定协调', zones: ['U3'], duration: [40, 60], distance: [0, 0] },
  { category: '拉伸再生', trainingType: '专项训练', structureType: '恢复再生', content: '拉伸放松', zones: ['U3'], duration: [30, 45], distance: [0, 0] },
  { category: '力量耐力', trainingType: '专项训练', structureType: '力量耐力', content: '循环力量', zones: ['U2', 'AT'], duration: [50, 70], distance: [0, 0] },
  { category: '最大力量', trainingType: '专项训练', structureType: '最大力量', content: '深蹲硬拉', zones: ['U3'], duration: [60, 80], distance: [0, 0] },
  { category: '速度力量', trainingType: '专项训练', structureType: '速度力量', content: '高拉抓举', zones: ['ATP', 'AN'], duration: [40, 60], distance: [0, 0] },
  { category: '跑步', trainingType: '专项训练', structureType: '体能训练', content: '越野跑', zones: ['U2', 'U1'], duration: [40, 70], distance: [6, 12] },
  { category: '其它', trainingType: '专项课', structureType: '专项', content: '综合活动', zones: ['U2'], duration: [40, 60], distance: [0, 0] }
];

const athletes = db.prepare('SELECT id FROM athletes WHERE active = 1 ORDER BY id').all();
const creator = db
  .prepare("SELECT id FROM users WHERE role IN ('SCC', 'PRJ', 'REG', 'TD', 'DMD') ORDER BY id LIMIT 1")
  .get();
const insert = db.prepare(`
  INSERT INTO training_sessions (
    athlete_id, session_date, session_order, start_time, training_type, structure_type,
    intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported,
    rpe, srpe, smvl, source, quality, is_demo, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'generated', 'valid', 0, ?)
`);
const maxOrder = db.prepare(
  'SELECT COALESCE(MAX(session_order), 0) AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?'
);

// 固定种子伪随机：同一数据库重复生成得到一致的展示形态。
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const rangeInt = (rand, [min, max]) => min + Math.floor(rand() * (max - min + 1));
const today = new Date();
const DAYS = 56;

const stats = { rows: 0, byCategory: {}, byZone: {} };
db.exec('BEGIN');
try {
  for (const athlete of athletes) {
    const rand = lcg(athlete.id * 7919 + 42);
    for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setUTCDate(day.getUTCDate() - offset);
      const date = day.toISOString().slice(0, 10);
      const weekday = day.getUTCDay();
      if (weekday === 0 && rand() < 0.8) continue;
      const sessions = rand() < 0.45 ? 1 : rand() < 0.2 ? 2 : 0;
      for (let index = 0; index < sessions; index += 1) {
        const template = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
        const zone = template.zones[Math.floor(rand() * template.zones.length)];
        const duration = rangeInt(rand, template.duration);
        const distance = rangeInt(rand, template.distance);
        const rpe = rangeInt(rand, [3, 8]);
        const order = Number(maxOrder.get(athlete.id, date).value) + index + 1;
        insert.run(
          athlete.id,
          date,
          order,
          index === 0 ? '09:00' : '15:30',
          template.trainingType,
          template.structureType,
          zone,
          template.content,
          duration,
          distance,
          1,
          distance > 0 ? 1 : 0,
          rpe,
          duration * rpe,
          creator ? creator.id : null
        );
        stats.rows += 1;
        stats.byCategory[template.category] = (stats.byCategory[template.category] || 0) + 1;
        stats.byZone[zone] = (stats.byZone[zone] || 0) + 1;
      }
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(JSON.stringify({
  database: dbPath,
  athletes: athletes.length,
  cleanedPrevious: existing,
  generated: stats.rows,
  byCategory: stats.byCategory,
  byZone: stats.byZone
}));
db.close();
