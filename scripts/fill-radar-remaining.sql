BEGIN TRANSACTION;


-- =========================================================
-- 1. 补充缺失指标定义
-- =========================================================

INSERT OR IGNORE INTO metric_definitions (
  code,
  label,
  domain,
  unit,
  direction,
  frequency,
  projects_json,
  active
)
VALUES
(
  'rowing_on_water_time_sec',
  '主项水上2000m计时',
  'special_test',
  's',
  'lower_better',
  'phase',
  '["ROWING"]',
  1
),
(
  'high_pull_kg',
  '高翻/高拉',
  'physical_test',
  'kg',
  'higher_better',
  'phase',
  '["ROWING"]',
  1
);


-- =========================================================
-- 2. 给所有 active ROWING 运动员补一条可用于力量换算的体重
--
-- 注意：
-- 使用 2026-09-17，早于 09-18 测试日期。
-- 不覆盖已有相同日期记录。
--
-- 男：约 78~92kg
-- 女：约 65~77kg
--
-- 属于开发模拟数据。
-- =========================================================

INSERT OR IGNORE INTO athlete_body_measurements (
  athlete_id,
  measurement_date,
  weight_kg,
  source,
  quality,
  is_demo,
  note
)
SELECT
  a.id,
  '2026-09-17',

  CASE
    WHEN a.gender LIKE '%女%'
      THEN 65 + (a.id % 13)
    ELSE
      78 + (a.id % 15)
  END,

  'radar_fixture',
  'valid',
  0,
  '雷达图开发联调生成体重，不作为正式测试记录'

FROM athletes a
WHERE a.project = 'ROWING'
  AND a.active = 1;


-- =========================================================
-- 3. 保证所有运动员存在体能 fixture session
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
  a.id,
  '2026-09-18',
  'rowing_radar_physical_fixture',
  '体能雷达开发联调',
  'radar_fixture',
  'valid',
  0
FROM athletes a
WHERE a.project = 'ROWING'
  AND a.active = 1;


-- =========================================================
-- 4. 深蹲
--
-- 男约 1.65~2.05 × BW
-- 女约 1.35~1.70 × BW
-- =========================================================

INSERT OR REPLACE INTO test_measurements (
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
  'squat_kg',

  ROUND(
    bm.weight_kg *
    CASE
      WHEN a.gender LIKE '%女%'
        THEN 1.35 + ((a.id % 8) * 0.05)
      ELSE
        1.65 + ((a.id % 9) * 0.05)
    END,
    1
  ),

  'kg',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'

FROM test_sessions ts
JOIN athletes a
  ON a.id = ts.athlete_id

JOIN athlete_body_measurements bm
  ON bm.athlete_id = a.id
  AND bm.measurement_date = '2026-09-17'

WHERE ts.test_type = 'rowing_radar_physical_fixture';


-- =========================================================
-- 5. 卧拉
--
-- 男约 1.10~1.45 × BW
-- 女约 0.90~1.20 × BW
-- =========================================================

INSERT OR REPLACE INTO test_measurements (
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
  'bench_pull_kg',

  ROUND(
    bm.weight_kg *
    CASE
      WHEN a.gender LIKE '%女%'
        THEN 0.90 + ((a.id % 7) * 0.05)
      ELSE
        1.10 + ((a.id % 8) * 0.05)
    END,
    1
  ),

  'kg',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'

FROM test_sessions ts
JOIN athletes a
  ON a.id = ts.athlete_id

JOIN athlete_body_measurements bm
  ON bm.athlete_id = a.id
  AND bm.measurement_date = '2026-09-17'

WHERE ts.test_type = 'rowing_radar_physical_fixture';


-- =========================================================
-- 6. 高翻 / 高拉
--
-- 男约 0.85~1.15 × BW
-- 女约 0.70~0.95 × BW
-- =========================================================

INSERT OR REPLACE INTO test_measurements (
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
  'high_pull_kg',

  ROUND(
    bm.weight_kg *
    CASE
      WHEN a.gender LIKE '%女%'
        THEN 0.70 + ((a.id % 6) * 0.05)
      ELSE
        0.85 + ((a.id % 7) * 0.05)
    END,
    1
  ),

  'kg',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'

FROM test_sessions ts
JOIN athletes a
  ON a.id = ts.athlete_id

JOIN athlete_body_measurements bm
  ON bm.athlete_id = a.id
  AND bm.measurement_date = '2026-09-17'

WHERE ts.test_type = 'rowing_radar_physical_fixture';


-- =========================================================
-- 7. 保证专项 fixture session 存在
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
  a.id,
  '2026-09-18',
  'rowing_radar_special_fixture',
  '专项雷达开发联调',
  'radar_fixture',
  'valid',
  0
FROM athletes a
WHERE a.project = 'ROWING'
  AND a.active = 1;


-- =========================================================
-- 8. 主项水上计时
--
-- 注意：
-- 当前数据库没有正确艇型，
-- 因此这里只生成通用开发值。
--
-- 男约 405~429 秒
-- 女约 445~469 秒
-- =========================================================

INSERT OR REPLACE INTO test_measurements (
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
  'rowing_on_water_time_sec',

  CASE
    WHEN a.gender LIKE '%女%'
      THEN 445 + (a.id % 25)
    ELSE
      405 + (a.id % 25)
  END,

  's',
  'center',
  'valid',
  'radar_fixture',
  0,
  'generated-radar-fixture'

FROM test_sessions ts
JOIN athletes a
  ON a.id = ts.athlete_id

WHERE ts.test_type = 'rowing_radar_special_fixture';


-- =========================================================
-- 9. 水上测试开发参考来源
--
-- 注意：
-- 因当前 current_event 错误存为 “2026年亚运会”，
-- 暂时只能用 applicability 匹配该值。
-- 正式版本必须改成真实艇型/项目。
-- =========================================================

INSERT OR IGNORE INTO radar_reference_sources (
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
  'Rowing On-water Development Reference',
  'https://worldrowing.com/',
  2026,
  '开发阶段通用水上2000m计时参考；当前运动员小项字段尚未结构化，本数据不得作为正式艇型冠军标准。',
  '2026-09-18',
  1
);


-- =========================================================
-- 10. 男子主项水上参考
-- =========================================================

INSERT OR IGNORE INTO radar_reference_values (
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
  'rowing_on_water_time',
  '男',
  '',
  '2026年亚运会',
  400,
  's',
  1
FROM radar_reference_sources
WHERE name = 'Rowing On-water Development Reference';


-- =========================================================
-- 11. 女子主项水上参考
-- =========================================================

INSERT OR IGNORE INTO radar_reference_values (
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
  'rowing_on_water_time',
  '女',
  '',
  '2026年亚运会',
  440,
  's',
  1
FROM radar_reference_sources
WHERE name = 'Rowing On-water Development Reference';


COMMIT;


-- =========================================================
-- 12. 验证：每项 fixture 有多少运动员
-- =========================================================

.headers on
.mode column

SELECT
  tm.metric_code,
  COUNT(DISTINCT ts.athlete_id) AS athlete_count
FROM test_measurements tm
JOIN test_sessions ts
  ON ts.id = tm.test_session_id
WHERE tm.source = 'radar_fixture'
GROUP BY tm.metric_code
ORDER BY tm.metric_code;


-- =========================================================
-- 13. 验证：体重数据
-- =========================================================

SELECT
  COUNT(*) AS valid_fixture_weights
FROM athlete_body_measurements
WHERE source = 'radar_fixture'
  AND quality = 'valid'
  AND is_demo = 0
  AND weight_kg > 0;


-- =========================================================
-- 14. 验证：水上参考值
-- =========================================================

SELECT
  rv.metric_key,
  rv.gender,
  rv.applicability,
  rv.value_num,
  rv.unit
FROM radar_reference_values rv
JOIN radar_reference_sources rs
  ON rs.id = rv.source_id
WHERE rs.name = 'Rowing On-water Development Reference';


-- =========================================================
-- 15. 检查是否有性别无法识别的运动员
-- =========================================================

SELECT
  id,
  name,
  gender
FROM athletes
WHERE project = 'ROWING'
  AND active = 1
  AND (
    gender IS NULL
    OR (
      gender NOT LIKE '%男%'
      AND gender NOT LIKE '%女%'
    )
  );