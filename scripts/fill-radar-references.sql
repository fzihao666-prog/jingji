BEGIN TRANSACTION;

-- =========================================================
-- 0. 清理本脚本以前生成的开发参考数据
--    只删除指定开发来源，不碰其他正式参考数据
-- =========================================================

DELETE FROM radar_reference_values
WHERE source_id IN (
  SELECT id
  FROM radar_reference_sources
  WHERE name IN (
    'Concept2 2025 Elite Erg Reference',
    'British Rowing 30min R20 Development Reference',
    'Rowing Physical Development Reference'
  )
);

DELETE FROM radar_reference_sources
WHERE name IN (
  'Concept2 2025 Elite Erg Reference',
  'British Rowing 30min R20 Development Reference',
  'Rowing Physical Development Reference'
);


-- =========================================================
-- 1. 专项：Concept2 测功仪参考来源
--
-- 2000m / 5000m：
-- 参考 Concept2 2025 排名前列成绩，并做轻微取整。
--
-- 注意：
-- 这里用于开发阶段“冠军/国际优秀模型”展示，
-- 不是国家队官方选材标准。
-- =========================================================

INSERT INTO radar_reference_sources (
  project,
  name,
  url,
  source_year,
  protocol,
  verified_at,
  active
)
VALUES (
  'ROWING',
  'Concept2 2025 Elite Erg Reference',
  'https://log.concept2.com/rankings/2025/rower/2000',
  2025,
  '基于 Concept2 2025 RowErg 公开排名前列成绩构建的开发参考模型；用于系统联调和优秀水平对照，不代表官方国家队选材标准。',
  '2026-09-18',
  1
);


-- =========================================================
-- 男子 2000m
--
-- 参考值：351 秒 = 5:51
-- =========================================================

INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_2000_time',
  '男',
  '',
  'elite_open',
  351,
  's',
  1
FROM radar_reference_sources
WHERE name = 'Concept2 2025 Elite Erg Reference';


-- =========================================================
-- 女子 2000m
--
-- 参考值：408 秒 = 6:48
-- =========================================================

INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_2000_time',
  '女',
  '',
  'elite_open',
  408,
  's',
  1
FROM radar_reference_sources
WHERE name = 'Concept2 2025 Elite Erg Reference';


-- =========================================================
-- 男子 5000m
--
-- 参考值：960 秒 = 16:00
-- =========================================================

INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_5000_time',
  '男',
  '',
  'elite_open',
  960,
  's',
  1
FROM radar_reference_sources
WHERE name = 'Concept2 2025 Elite Erg Reference';


-- =========================================================
-- 女子 5000m
--
-- 参考值：1122 秒 = 18:42
-- =========================================================

INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_5000_time',
  '女',
  '',
  'elite_open',
  1122,
  's',
  1
FROM radar_reference_sources
WHERE name = 'Concept2 2025 Elite Erg Reference';


-- =========================================================
-- 2. 30分钟 Rate 20 + 峰值功率
--
-- British Rowing 有正式 30min R20 测试协议，
-- 但没有统一冠军阈值。
--
-- 所以下面的数值属于开发模型估值。
-- =========================================================

INSERT INTO radar_reference_sources (
  project,
  name,
  url,
  source_year,
  protocol,
  verified_at,
  active
)
VALUES (
  'ROWING',
  'British Rowing 30min R20 Development Reference',
  'https://www.britishrowing.org/wp-content/uploads/2022/11/PT-Testing-Protocols-November-2022.pdf',
  2022,
  'British Rowing 30分钟 Rate 20 测试协议作为测试方法依据；具体优秀参考值为系统开发阶段估算值，并非 British Rowing 官方冠军标准。',
  '2026-09-18',
  1
);


-- 男子 30min R20：1:41 / 500m
INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_30min_20spm_split',
  '男',
  '',
  'development_elite_estimate',
  101,
  's/500m',
  1
FROM radar_reference_sources
WHERE name = 'British Rowing 30min R20 Development Reference';


-- 女子 30min R20：1:54 / 500m
INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_30min_20spm_split',
  '女',
  '',
  'development_elite_estimate',
  114,
  's/500m',
  1
FROM radar_reference_sources
WHERE name = 'British Rowing 30min R20 Development Reference';


-- 男子测功仪峰值功率：开发估值
INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_peak_power',
  '男',
  '',
  'development_elite_estimate',
  850,
  'W',
  1
FROM radar_reference_sources
WHERE name = 'British Rowing 30min R20 Development Reference';


-- 女子测功仪峰值功率：开发估值
INSERT INTO radar_reference_values (
  source_id,
  project,
  radar_kind,
  metric_key,
  gender,
  boat_class,
  applicability,
  value_num,
  unit,
  active
)
SELECT
  id,
  'ROWING',
  'special',
  'rowing_erg_peak_power',
  '女',
  '',
  'development_elite_estimate',
  650,
  'W',
  1
FROM radar_reference_sources
WHERE name = 'British Rowing 30min R20 Development Reference';


-- =========================================================
-- 3. 体能冠军模型开发参考来源
--
-- 文献支持：
-- - squat
-- - bench pull
-- - power clean / high pull
-- - jump / power
--
-- 与赛艇表现存在关系。
--
-- 但下面具体阈值不是论文公布的官方冠军标准，
-- 属于开发阶段模型估值。
-- =========================================================

INSERT INTO radar_reference_sources (
  project,
  name,
  url,
  source_year,
  protocol,
  verified_at,
  active
)
VALUES (
  'ROWING',
  'Rowing Physical Development Reference',
  'https://pubmed.ncbi.nlm.nih.gov/21510717/',
  2026,
  '结合赛艇力量测试研究和项目实践构建的开发参考模型；具体阈值属于工程估值，用于体能雷达联调，不作为正式医学或国家队选材标准。',
  '2026-09-18',
  1
);


-- =========================================================
-- 男子体能
-- =========================================================

-- 相对深蹲：1.80 × BW
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'relative_squat',
  '男', '', 'development_elite_estimate',
  1.80, '倍体重', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 相对卧拉：1.30 × BW
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'relative_bench_pull',
  '男', '', 'development_elite_estimate',
  1.30, '倍体重', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 相对高翻/高拉：1.10 × BW
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'relative_high_pull',
  '男', '', 'development_elite_estimate',
  1.10, '倍体重', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 纵跳：58 cm
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'vertical_jump',
  '男', '', 'development_elite_estimate',
  58, 'cm', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 2分钟卧拉：55次
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'bench_pull_2min',
  '男', '', 'development_elite_estimate',
  55, '次', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 前支撑：240秒
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'front_plank',
  '男', '', 'development_elite_estimate',
  240, 's', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- =========================================================
-- 女子体能
-- =========================================================

-- 相对深蹲：1.50 × BW
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'relative_squat',
  '女', '', 'development_elite_estimate',
  1.50, '倍体重', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 相对卧拉：1.10 × BW
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'relative_bench_pull',
  '女', '', 'development_elite_estimate',
  1.10, '倍体重', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 相对高翻/高拉：0.90 × BW
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'relative_high_pull',
  '女', '', 'development_elite_estimate',
  0.90, '倍体重', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 纵跳：48 cm
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'vertical_jump',
  '女', '', 'development_elite_estimate',
  48, 'cm', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 2分钟卧拉：45次
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'bench_pull_2min',
  '女', '', 'development_elite_estimate',
  45, '次', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


-- 前支撑：210秒
INSERT INTO radar_reference_values (
  source_id, project, radar_kind, metric_key,
  gender, boat_class, applicability,
  value_num, unit, active
)
SELECT
  id, 'ROWING', 'physical', 'front_plank',
  '女', '', 'development_elite_estimate',
  210, 's', 1
FROM radar_reference_sources
WHERE name = 'Rowing Physical Development Reference';


COMMIT;


-- =========================================================
-- 4. 验证参考数据
-- =========================================================

.headers on
.mode column

SELECT
  rv.radar_kind,
  rv.metric_key,
  rv.gender,
  rv.value_num,
  rv.unit,
  rs.name AS source
FROM radar_reference_values rv
JOIN radar_reference_sources rs
  ON rs.id = rv.source_id
WHERE rs.name IN (
  'Concept2 2025 Elite Erg Reference',
  'British Rowing 30min R20 Development Reference',
  'Rowing Physical Development Reference'
)
ORDER BY
  rv.radar_kind,
  rv.gender,
  rv.metric_key;


-- =========================================================
-- 5. 验证数量
--
-- 预期：
-- special = 男4 + 女4 = 8
-- physical = 男6 + 女6 = 12
-- 共 20 条
-- =========================================================

SELECT
  radar_kind,
  gender,
  COUNT(*) AS reference_count
FROM radar_reference_values
GROUP BY radar_kind, gender
ORDER BY radar_kind, gender;