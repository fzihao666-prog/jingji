BEGIN TRANSACTION;

-- =========================================================
-- 1. 补齐雷达图需要、但 metric_definitions 中目前缺失的指标
-- =========================================================

INSERT OR IGNORE INTO metric_definitions
(code, label, domain, unit, direction, frequency, projects_json, active)
VALUES
('erg_5000_sec', '5000m测功仪', 'special_test', 's', 'lower_better', 'phase', '["ROWING"]', 1),

('erg_30min_20spm_split_sec', '30分钟20桨频分段', 'special_test', 's/500m', 'lower_better', 'phase', '["ROWING"]', 1),

('erg_peak_power_w', '测功仪峰值功率', 'special_test', 'W', 'higher_better', 'phase', '["ROWING"]', 1),

('bench_pull_2min_reps', '2分钟卧拉', 'physical_test', '次', 'higher_better', 'phase', '["ROWING"]', 1);


-- =========================================================
-- 2. 为所有 active ROWING 运动员创建专项测试 session
-- source 专门写 radar_fixture，方便以后统一删除
-- =========================================================

INSERT OR IGNORE INTO test_sessions (
  athlete_id,
  test_date,
  test_type,
  protocol,
  source,
  quality,
  is_demo
)
SELECT
  id,
  '2026-09-18',
  'rowing_radar_special_fixture',
  '雷达图专项测试开发联调',
  'radar_fixture',
  'valid',
  0
FROM athletes
WHERE project = 'ROWING'
  AND active = 1;


-- =========================================================
-- 3. 专项测试：2000m
-- 男女性别给不同基础区间，再根据 athlete id 做小幅变化
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id,
  metric_code,
  value_num,
  unit,
  side,
  quality,
  source,
  is_demo,
  source_ref
)
SELECT
  ts.id,
  'erg_2k_sec',
  CASE
    WHEN a.gender LIKE '%女%' THEN 430 + (a.id % 31)
    ELSE 360 + (a.id % 31)
  END,
  's',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_special_fixture';


-- =========================================================
-- 4. 专项测试：5000m
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id, metric_code, value_num, unit,
  side, quality, source, is_demo, source_ref
)
SELECT
  ts.id,
  'erg_5000_sec',
  CASE
    WHEN a.gender LIKE '%女%' THEN 1110 + (a.id % 61)
    ELSE 960 + (a.id % 61)
  END,
  's',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_special_fixture';


-- =========================================================
-- 5. 专项测试：30分钟20桨频平均500m分段
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id, metric_code, value_num, unit,
  side, quality, source, is_demo, source_ref
)
SELECT
  ts.id,
  'erg_30min_20spm_split_sec',
  CASE
    WHEN a.gender LIKE '%女%' THEN 112 + (a.id % 10)
    ELSE 98 + (a.id % 10)
  END,
  's/500m',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_special_fixture';


-- =========================================================
-- 6. 专项测试：峰值功率
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id, metric_code, value_num, unit,
  side, quality, source, is_demo, source_ref
)
SELECT
  ts.id,
  'erg_peak_power_w',
  CASE
    WHEN a.gender LIKE '%女%' THEN 520 + (a.id % 121)
    ELSE 700 + (a.id % 151)
  END,
  'W',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_special_fixture';


-- =========================================================
-- 7. 为全部赛艇运动员创建体能测试 session
-- =========================================================

INSERT OR IGNORE INTO test_sessions (
  athlete_id,
  test_date,
  test_type,
  protocol,
  source,
  quality,
  is_demo
)
SELECT
  id,
  '2026-09-18',
  'rowing_radar_physical_fixture',
  '雷达图体能测试开发联调',
  'radar_fixture',
  'valid',
  0
FROM athletes
WHERE project = 'ROWING'
  AND active = 1;


-- =========================================================
-- 8. 体能：纵跳
-- 不依赖体重
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id, metric_code, value_num, unit,
  side, quality, source, is_demo, source_ref
)
SELECT
  ts.id,
  'vertical_jump_cm',
  CASE
    WHEN a.gender LIKE '%女%' THEN 38 + (a.id % 11)
    ELSE 48 + (a.id % 13)
  END,
  'cm',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_physical_fixture';


-- =========================================================
-- 9. 体能：2分钟卧拉
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id, metric_code, value_num, unit,
  side, quality, source, is_demo, source_ref
)
SELECT
  ts.id,
  'bench_pull_2min_reps',
  CASE
    WHEN a.gender LIKE '%女%' THEN 38 + (a.id % 11)
    ELSE 46 + (a.id % 13)
  END,
  '次',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_physical_fixture';


-- =========================================================
-- 10. 体能：前支撑
-- =========================================================

INSERT OR IGNORE INTO test_measurements (
  test_session_id, metric_code, value_num, unit,
  side, quality, source, is_demo, source_ref
)
SELECT
  ts.id,
  'front_plank_sec',
  CASE
    WHEN a.gender LIKE '%女%' THEN 150 + (a.id % 71)
    ELSE 175 + (a.id % 81)
  END,
  's',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'
FROM test_sessions ts
JOIN athletes a ON a.id = ts.athlete_id
WHERE ts.test_type = 'rowing_radar_physical_fixture';

COMMIT;