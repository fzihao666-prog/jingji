# 竞迹｜数据库收敛重构 SPEC V1.0

## 1. 重构背景

当前项目数据库：

```text
SQLite
training-monitor.db
```

当前共存在：

```text
44 张业务表
```

数据库已经具备较完整的：

* 运动员；
* 训练；
* 力量训练；
* 测试；
* 身体成分；
* 每日状态；
* 伤病；
* 竞技状态；
* 训练计划；
* 指标体系；
* 数据导入；
* 权限；

等业务模型。

因此本次数据库改造：

**不采用推倒重建方案。**

采用：

> **数据库收敛重构。**

核心目标：

```text
保留正确的新模型

+

迁移旧模型

+

合并重复模型

+

统一字段与枚举

+

明确每张表职责
```

---

# 2. 当前数据库核心问题

当前数据库最大的风险不是表数量，而是：

```text
同一种业务
存在两套甚至三套数据模型
```

典型情况：

### 训练

同时存在：

```text
training_records

training_sessions
```

---

### 力量测试

同时存在：

```text
athlete_strength_tests

test_sessions
test_measurements
```

---

### 力量训练组

同时存在：

```text
strength_result_sets

strength_training_sets
```

---

### 数据导入

同时存在：

```text
data_import_batches

strength_import_batches
```

---

### 运动员所属队伍

同时存在：

```text
athletes.team

project_teams
```

---

### 地区

同时存在：

```text
athletes.region
athletes.city
athletes.county

athlete_origins.province
athlete_origins.city
athlete_origins.county

training_records.province
training_records.city
training_records.county
```

这些重复模型如果继续发展，会导致：

```text
新增功能不知道写哪张表

统计结果取不同表结果不同

Excel导入需要同时兼容多种结构

修改一套数据另外一套不更新

AI继续开发时不断制造第三套模型
```

因此本次重构的首要任务是：

> **为每类业务确定唯一权威数据源。**

---

# 3. 本次重构基本原则

## 3.1 不直接删除有数据旧表

执行：

```text
旧表
 ↓
标记 Deprecated
 ↓
迁移
 ↓
双向校验
 ↓
代码切换
 ↓
停止写入
 ↓
观察
 ↓
最终删除
```

---

## 3.2 一个业务只能有一套主模型

例如训练：

```text
training_sessions
```

确定后：

```text
training_records
```

不得继续作为新功能数据源。

---

## 3.3 动态测试指标采用指标模型

例如：

```text
深蹲
卧拉
卧推
10桨最大功率
乳酸
VO2max
```

统一：

```text
metric_definitions
+
test_measurements
```

禁止继续新增：

```text
squat
bench
power10
...
```

固定数据库列。

---

## 3.4 固定业务对象允许宽表

例如：

```text
athlete_body_measurements
```

身体成分字段具有稳定业务含义。

可以保留：

```text
weight_kg
body_fat_pct
skeletal_muscle_kg
phase_angle_deg
...
```

无需全部转为 EAV 指标结构。

---

# 4. 重构后的核心数据架构

最终核心关系确定为：

```text
                    athletes
                       │
       ┌───────────────┼─────────────────┐
       │               │                 │
       ↓               ↓                 ↓

training_sessions   test_sessions    daily_wellness
       │               │
       │               ↓
       │        test_measurements
       │               │
       ↓               ↓
strength_result_sets metric_definitions
       │
       ↓
training_session_segments


athletes
   ↓
athlete_body_measurements

athletes
   ↓
injury_records

athletes
   ↓
competitive_state_assessments
```

数据导入：

```text
Excel

 ↓

data_import_batches

 ↓

data_import_items

 ↓

数据匹配/校验

 ↓

正式核心业务表
```

---

# 5. 44 张表收敛分类

所有现有表划分为：

```text
A. 核心保留

B. 保留但调整

C. 合并迁移

D. Deprecated

E. 功能独立保留
```

---

# 6. A类：核心保留表

以下表直接确定为长期核心表：

```text
athletes

athlete_profiles

athlete_origins

athlete_aliases

athlete_body_measurements

training_sessions

training_session_segments

strength_result_sets

daily_wellness

test_sessions

test_measurements

metric_definitions

metric_aliases

injury_records

competitive_state_assessments

champion_model_standards

metric_scoring_rules

data_import_batches

data_import_items

data_import_athlete_candidates
```

这些表原则上不重新创建第二套。

---

# 7. B类：保留但调整

包括：

```text
project_teams

specialty_catalog

special_training_plans

special_training_plan_sessions

training_plans

special_test_events

special_test_results
```

结构方向基本合理，但部分外键和字符串字段后续需要统一。

---

# 8. C类：需要迁移/合并

包括：

```text
training_records

athlete_strength_tests

strength_training_sets

strength_import_batches
```

这些表的职责已经被新的标准模型覆盖。

---

# 9. D类：最终 Deprecated

第一阶段正式标记：

```text
training_records

athlete_strength_tests

strength_training_sets

strength_import_batches
```

不得继续开发新业务依赖它们。

---

# 10. E类：系统与权限独立保留

以下不属于体育训练数据核心重构范围：

```text
users

account_profiles

coach_profiles

coach_athletes

user_area_permissions

user_project_permissions

user_team_permissions

regional_manager_regions

user_dashboard_preferences

registration_requests

audit_logs

app_metadata
```

继续保留。

本次不做大规模调整。

---

# 11. 训练主模型确定

当前：

```text
training_records
408 条
```

以及：

```text
training_sessions
3245 条
```

最终确定：

```text
training_sessions
```

为：

> **唯一训练主表。**

---

# 12. 为什么废弃 training_records

`training_records` 当前唯一约束等价于：

```text
athlete_id
+
date
```

也就是说：

> 一个运动员一天原则上只能有一条记录。

这不符合实际训练场景。

运动员一天可能：

```text
上午 水上

下午 力量

晚上 恢复
```

而 `training_sessions` 已经支持：

```text
athlete_id

session_date

session_order
```

因此能够表示：

```text
张恒
2026-09-06
第1课

张恒
2026-09-06
第2课
```

这是正确的数据模型。

---

# 13. training_records → training_sessions 字段迁移

映射：

| training_records | training_sessions |
| ---------------- | ----------------- |
| athlete_id       | athlete_id        |
| date             | session_date      |
| training_type    | training_type     |
| structure_type   | structure_type    |
| intensity_zone   | intensity_zone    |
| content          | content           |
| duration_min     | duration_min      |
| distance_km      | distance_km       |
| rpe              | rpe               |
| srpe             | srpe              |
| smvl             | smvl              |
| created_by       | created_by        |
| updated_at       | updated_at        |

---

# 14. training_records 中不应继续保留的数据

旧表：

```text
morning_pulse

weight_kg

sleep_hours

fatigue_index
```

不属于训练课本身。

迁移至：

```text
daily_wellness
```

对应：

| 旧字段           | 新字段           |
| ------------- | ------------- |
| date          | wellness_date |
| morning_pulse | morning_pulse |
| weight_kg     | weight_kg     |
| sleep_hours   | sleep_hours   |
| fatigue_index | fatigue_index |

关联：

```text
athlete_id
+
wellness_date
```

---

# 15. training_records 地区字段处理

旧字段：

```text
province
city
county
```

不再迁移到训练主表。

因为训练记录不应该重复存储运动员籍贯。

运动员归属地统一：

```text
athlete_origins
```

如果未来需要保存：

> 训练实际发生地点

应独立增加：

```text
training_location
```

或者：

```text
venue
```

而不是继续使用：

```text
province/city/county
```

表达身份归属。

---

# 16. training_records project/team

旧字段：

```text
project
team
```

不再作为训练记录事实重复保存。

通过：

```text
training_sessions.athlete_id
        ↓
athletes
```

获得运动员所属项目和队伍。

除非需要保存：

> 当时训练所代表的队伍快照。

V1 暂不保存。

---

# 17. training_records 迁移去重

当前检测发现：

training_records 与 training_sessions 至少存在一部分完全或高度重合的数据。

因此迁移不能简单：

```sql
INSERT ALL
```

必须使用业务键判断。

推荐候选匹配：

```text
athlete_id
+
session_date
+
training_type
+
duration_min
+
distance_km
```

完全一致：

```text
视为已迁移
```

不重复插入。

---

# 18. session_order 生成规则

旧表没有：

```text
session_order
```

迁移时按照：

```text
athlete_id
+
date
```

分组。

如果当天已有：

```text
session_order = 1
```

新迁移记录：

```text
session_order = MAX + 1
```

例如：

```text
已有上午课 = 1

迁移力量课 = 2
```

---

# 19. 训练类型目前存在的问题

当前 `training_sessions.training_type` 实际值包括：

```text
专项训练

力量训练

恢复训练

休息

技术训练
```

目前仍使用中文字符串。

V1 可以暂时继续使用，避免一次重构过大。

但新增统一枚举规范：

```text
SPECIAL

STRENGTH

RECOVERY

REST

TECHNIQUE
```

推荐第二阶段逐步切换编码。

前端：

```text
SPECIAL → 专项训练
```

数据库：

```text
SPECIAL
```

---

# 20. intensity_zone 当前实际问题

目前数据库同时存在：

```text
UT2
UT1
TR
AT
AN
REC

U1
U2
U3

ATP
TPT

-
```

说明至少存在两套强度体系。

这一点不能粗暴统一。

必须建立：

```text
intensity_zone_dictionary
```

或统一字典配置。

字段至少：

```text
zone_code

zone_name

zone_system

sort_order

description

active
```

---

# 21. 强度体系要支持多套标准

例如：

体系A：

```text
U3
U2
U1
AT
TPT
AN
ATP
```

体系B：

```text
UT2
UT1
TR
AT
AN
REC
```

不能直接把：

```text
UT2 = U3
```

硬编码。

应通过：

```text
zone_system
```

区分。

---

# 22. training_session_segments

当前：

```text
training_session_segments
0 条
```

虽然没有数据，但结构是合理的。

确定保留。

作用：

> 保存一次训练内部的多个训练段。

例如：

```text
training_session
2026-09-06 上午专项课
```

可以拆：

```text
Segment 1
水上
U2
10km

Segment 2
水上
AT
4km

Segment 3
恢复
15min
```

---

# 23. training_session_segments 后续定位

明确：

```text
training_sessions
```

表示：

> 一堂训练课。

```text
training_session_segments
```

表示：

> 这堂训练课内部不同训练内容的分段。

不要把 Segment 当成新的训练 Session。

---

# 24. 力量训练模型

当前：

```text
strength_result_sets
435 条
```

以及：

```text
strength_training_sets
0 条
```

两张表高度重复。

最终：

```text
strength_result_sets
```

作为唯一力量训练组明细表。

---

# 25. 为什么保留 strength_result_sets

它已经具备：

```text
training_session_id

exercise_name

set_index

target_reps

actual_reps

actual_weight_kg

planned_weight_kg

rpe

completed

training_category

body_position

training_environment

duration_min

distance_km

intensity_percent

intensity_zone
```

相比：

```text
strength_training_sets
```

业务能力明显更完整。

---

# 26. strength_training_sets

当前：

```text
0 条数据
```

因此：

```text
不做迁移
```

直接标记：

```text
Deprecated
```

确认代码无引用后：

```text
删除
```

---

# 27. strength_result_sets 字段进一步规范

未来建议增加：

```text
exercise_code
```

当前：

```text
exercise_name
```

直接存中文动作。

例如：

```text
深蹲
```

建议未来：

```text
exercise_code = SQUAT
exercise_name = 深蹲
```

或者建立：

```text
exercise_dictionary
```

---

# 28. 力量测试模型

当前存在：

```text
athlete_strength_tests
4637 条
```

里面：

```text
metrics_json

targets_json
```

同时存在：

```text
test_sessions
2581 条

test_measurements
6448 条
```

最终确定：

```text
test_sessions
+
test_measurements
```

作为唯一测试模型。

---

# 29. athlete_strength_tests 废弃原因

当前：

```text
metrics_json
```

会导致：

```text
查询困难

排序困难

指标趋势困难

统计困难

字段校验困难

单位标准化困难

Excel字段映射困难
```

例如：

```text
{
  "squat":160,
  "benchPull":110
}
```

无法方便执行：

```text
查询所有运动员最近6个月深蹲趋势
```

---

# 30. test_sessions 定义

代表：

> 一次测试事件。

例如：

```text
张恒

2025-12-10

力量素质测试
```

建立一条：

```text
test_sessions
```

---

# 31. test_measurements 定义

代表：

> 一次测试中的一个具体测试指标。

例如：

```text
test_session_id = 100

SQUAT_1RM
160kg
```

另一个：

```text
test_session_id = 100

BENCH_PULL
110kg
```

---

# 32. athlete_strength_tests → test模型

迁移：

```text
athlete_strength_tests
```

每一行：

```text
1条 test_sessions
```

然后解析：

```text
metrics_json
```

每个指标：

```text
1条 test_measurements
```

---

# 33. targets_json 迁移

旧：

```text
targets_json
```

里面的目标值：

```text
深蹲目标180kg
```

转换：

```text
test_measurements.target_value
```

---

# 34. 指标映射必须走 metric_definitions

当前：

```text
metric_definitions
84 条
```

确定为：

> 系统唯一指标字典。

迁移 JSON 时：

```text
旧字段 squat
```

不能直接：

```text
metric_code = squat
```

必须先映射到标准：

```text
SQUAT_1RM
```

---

# 35. metric_aliases

当前：

```text
metric_aliases
0 条
```

但这张表后续非常重要。

用于解决：

```text
深蹲

深蹲1RM

深蹲最大力量

SQ

squat
```

统一映射：

```text
SQUAT_1RM
```

---

# 36. metric_aliases 将成为Excel导入核心表

例如：

```text
alias            metric_code

深蹲             SQUAT_1RM
深蹲1RM          SQUAT_1RM
卧拉             BENCH_PULL
十桨最大功率      POWER_10
10桨功率          POWER_10
```

以后历史 Excel 就不用每个解析器重复写指标名称判断。

---

# 37. test_measurements 单位规范

当前已经：

```text
metric_code
value_num
unit
```

设计合理。

必须规定：

> `unit` 默认应该来自 metric_definitions.unit。

Excel单位不同：

```text
1000w

1kw
```

导入时统一：

```text
1000
W
```

---

# 38. 测试记录唯一性

不建议简单建立：

```text
athlete_id + test_date
```

唯一。

因为一天可能进行多个测试。

判断重复建议：

```text
athlete_id

test_date

test_type

metric_code

side
```

再结合源文件判断。

---

# 39. 每日监控模型

当前：

```text
daily_wellness
2767 条
```

设计合理。

继续作为：

> 每日恢复状态和主观/基础生理监控主表。

字段：

```text
sleep_hours

sleep_quality

morning_pulse

weight_kg

fatigue_index

soreness_index

mood_index

status
```

全部保留。

---

# 40. daily_wellness 唯一规则

继续采用：

```text
athlete_id
+
wellness_date
```

一天一个每日状态记录是合理的。

如果未来出现：

```text
上午/晚上两次状态
```

再升级模型。

V1 不处理。

---

# 41. 身体成分

当前：

```text
athlete_body_measurements
2485 条
```

结构较完整。

确定：

```text
长期保留
```

不转为动态指标表。

---

# 42. 身体成分和 daily_wellness 中 weight 重复

当前：

```text
daily_wellness.weight_kg
```

和：

```text
athlete_body_measurements.weight_kg
```

都可能保存体重。

这不是完全错误。

需要定义职责：

```text
daily_wellness.weight_kg
=
运动员日常晨重
```

```text
athlete_body_measurements.weight_kg
=
正式身体成分测试时体重
```

禁止互相覆盖。

---

# 43. 运动损伤

当前：

```text
injury_records
12 条
```

确定为唯一伤病记录表。

无需创建：

```text
athlete_injury
```

第二套模型。

---

# 44. injury_records 后续建议增加

可以考虑增加：

```text
severity

recovery_date

return_training_date

resolved_at
```

但 V1 不是必须。

现有：

```text
status
pain_score
restrictions
rehab_plan
review_date
```

已经可以继续使用。

---

# 45. 竞技状态

当前：

```text
competitive_state_assessments
81 条
```

以及：

```text
champion_model_standards
90 条

metric_scoring_rules
198 条
```

这三张表构成：

```text
指标
↓
评分规则
↓
冠军模型标准
↓
运动员竞技状态评估
```

设计方向正确。

全部保留。

---

# 46. 竞技状态必须是“结果数据”

禁止用户直接随意编辑：

```text
overall_score
```

长期建议：

```text
测试数据
训练数据
恢复数据
   ↓
评分规则
   ↓
competitive_state_assessments
```

自动产生。

---

# 47. athletes 主表

当前：

```text
athletes
78 条
```

继续作为运动员核心身份表。

但是目前存在：

```text
project TEXT

team TEXT
```

问题。

---

# 48. 项目字段

当前实际：

```text
赛艇
72

皮划艇
3

激流
3
```

短期保留：

```text
project
```

第二阶段建议规范为：

```text
project_code
```

例如：

```text
ROWING

CANOE_SPRINT

CANOE_SLALOM
```

---

# 49. team 字段问题

当前：

```text
athletes.team
```

保存字符串。

同时已经存在：

```text
project_teams
```

9 条队伍。

因此长期建议：

```text
athletes.team_id
```

关联：

```text
project_teams.id
```

---

# 50. team 重构方式

V1 不立即删除：

```text
athletes.team
```

先增加：

```text
team_id
```

迁移：

```text
project + team
```

匹配：

```text
project_teams
```

然后代码逐步改为：

```text
team_id
```

最后再停用：

```text
team
```

字符串列。

---

# 51. project_teams 唯一职责

以后：

```text
project_teams
```

作为正式队伍字典。

至少：

```text
id

project

name

active
```

可以继续。

---

# 52. athletes地区问题

当前：

```text
athletes.region
athletes.city
athletes.county
```

同时存在：

```text
athlete_origins
```

几乎重复。

---

# 53. 地区权威模型

最终确定：

```text
athlete_origins
```

为运动员来源地区唯一权威表。

因此：

```text
athletes.region
athletes.city
athletes.county
```

长期 Deprecated。

---

# 54. athlete_origins

职责：

```text
运动员籍贯

来源地区

输送地区
```

保存：

```text
province

city

county
```

---

# 55. athlete_profiles origin字段

当前还存在：

```text
native_place

origin_place

origin_unit

origin_coach
```

这些不是简单的省市县。

因此继续保留。

定义：

```text
athlete_origins
=
标准行政地区
```

```text
athlete_profiles.origin_unit
=
运动员原输送单位
```

两者不要混淆。

---

# 56. 当前地区存在异常数据

当前已有：

```text
city = ddd
county = ddd
```

以及：

```text
county = 1
```

这种明显非标准行政区数据。

因此迁移过程中必须加：

```text
地区数据质量校验
```

不能把旧值无条件复制。

---

# 57. athlete_aliases

目前：

```text
0 条
```

但是数据导入一定要启用。

作用：

```text
张恒

张 恒

张恒（男）

老张
```

全部可以映射：

```text
athlete_id = xxx
```

---

# 58. athlete_aliases 建议补充数据

每次用户人工确认：

```text
Excel姓名
→
运动员
```

后可以询问：

```text
保存为别名
```

以后自动匹配。

---

# 59. 数据导入体系

目前：

```text
data_import_batches
8 条
```

和：

```text
data_import_items
35096 条
```

说明已经存在完整的数据暂存体系基础。

这两张表：

> **必须作为后续 Excel 导入核心基础继续保留。**

---

# 60. data_import_batches

职责：

> 一个上传文件对应一个导入批次。

目前已有：

```text
file_hash

source_filename

source_mimetype

file_size

project

parser_version

status

sheet_count

item_count

valid_count

warning_count

error_count

imported_count

skipped_count
```

结构非常适合继续使用。

---

# 61. 不再新增 source_file

之前规划的：

```text
source_file
```

不再单独建立。

因为：

```text
data_import_batches
```

已经包含文件来源元信息。

如未来需要真正保存文件物理地址，可以直接增加：

```text
storage_path

storage_object_key
```

---

# 62. data_import_items

当前：

```text
35096 条
```

已经支持：

```text
item_type

athlete_id

raw_athlete_name

event_date

session_label

test_type

metric_code

metric_label

side

value_num

unit

exercise_name

set_index

target_reps

actual_reps

actual_weight_kg

intensity_percent

payload_json

source_sheet

source_address

raw_value

quality

messages_json

business_key
```

这实际上已经是：

> **通用导入暂存数据模型。**

所以继续强化即可。

---

# 63. data_import_items item_type

统一正式支持：

```text
athlete_profile

wellness

training_session

training_segment

training_set

test_measurement

body_measurement

injury_record

competitive_state
```

所有历史解析器最终只能输出上述标准中间类型。

---

# 64. Excel解析器不能直接写正式表

必须：

```text
Excel
 ↓
Parser
 ↓
data_import_items
 ↓
校验
 ↓
用户确认
 ↓
Commit Service
 ↓
正式表
```

禁止：

```text
Parser
 ↓
training_sessions
```

直接写业务表。

---

# 65. strength_import_batches

当前：

```text
0 条
```

并且与：

```text
data_import_batches
```

职责重复。

最终：

```text
Deprecated
```

所有力量导入也使用：

```text
data_import_batches
```

---

# 66. strength_result_sets.import_batch_id

当前：

```text
import_batch_id
```

关联：

```text
strength_import_batches
```

同时又已经存在：

```text
data_import_batch_id
```

这是明显重复。

最终统一：

```text
data_import_batch_id
```

---

# 67. strength_result_sets字段清理

最终 Deprecated：

```text
import_batch_id
```

保留：

```text
data_import_batch_id
```

等旧代码完成迁移后删除。

---

# 68. 数据来源统一

目前很多表都有：

```text
source
```

建议统一枚举：

```text
manual

excel

device

api

system
```

不要出现：

```text
手动

MANUAL

manual_input

excel_import
```

多个表达。

---

# 69. quality字段统一

多个表当前都有：

```text
quality
```

建议统一：

```text
valid

warning

invalid

confirmed
```

---

# 70. is_demo字段

目前：

```text
daily_wellness

athlete_body_measurements

test_sessions

test_measurements

competitive_state_assessments

training_sessions
```

等均使用：

```text
is_demo
```

继续保留。

用于区分：

```text
演示数据
真实数据
```

但正式统计 API 默认：

```text
is_demo = 0
```

---

# 71. 日期字段规范

SQLite 本身没有强制 DATE 类型。

目前日期大量使用：

```text
TEXT
```

这是可以接受的。

但必须强制存：

```text
YYYY-MM-DD
```

例如：

```text
2026-09-06
```

禁止正式数据中混用：

```text
2026/9/6

2026.09.06

9月6日
```

---

# 72. 时间字段规范

统一：

```text
HH:mm:ss
```

或：

```text
HH:mm
```

项目确定一种。

推荐：

```text
HH:mm
```

例如：

```text
08:30
```

---

# 73. created_at / updated_at

SQLite统一：

```text
YYYY-MM-DD HH:mm:ss
```

所有新表或新增字段统一：

```text
CURRENT_TIMESTAMP
```

---

# 74. 不要把0和NULL混用

例如：

```text
rpe = NULL
```

表示：

> 没有记录。

```text
rpe = 0
```

表示：

> 实际记录为0。

所有迁移脚本必须区分。

---

# 75. training_session心率/功率字段

当前：

```text
average_heart_rate

max_heart_rate

average_power_w

stroke_rate_spm
```

这些属于一次训练的汇总指标。

可以保留。

不需要因为存在：

```text
metric_definitions
```

就全部拆出去。

原则：

```text
训练课固定常用汇总指标
→ training_sessions
```

```text
可动态扩展测试指标
→ test_measurements
```

---

# 76. 训练课强度分区目前的问题

当前：

```text
training_sessions.intensity_zone
```

只能表达一个：

> 主强度。

而历史 Excel 中一节课可能同时：

```text
U3 8km

U2 10km

AT 4km
```

因此不能只依赖：

```text
training_sessions.intensity_zone
```

---

# 77. 强度明细解决方案

优先利用：

```text
training_session_segments
```

一个训练 Session：

```text
training_sessions
```

下面拆：

```text
多个Segment
```

每个 Segment 记录：

```text
category_code

duration_min

distance_km
```

V1 建议给：

```text
training_session_segments
```

增加：

```text
intensity_zone
```

字段。

最终：

```text
Session：
专项耐力训练

Segment 1：
U3 8km

Segment 2：
U2 10km

Segment 3：
AT 4km
```

---

# 78. training_sessions.intensity_zone定位

保留：

```text
intensity_zone
```

但重新定义：

> 本节训练课的主要强度区间。

详细结构：

```text
training_session_segments
```

---

# 79. 水陆训练比值

以后统计：

```text
水上训练量
/
陆上训练量
```

不应该新建：

```text
water_land_ratio
```

数据库字段。

通过：

```text
training_sessions

training_session_segments

strength_result_sets
```

计算。

---

# 80. 强度百分比

也不要存：

```text
u2_percent
```

这种固定字段。

根据：

```text
SUM(segment.distance)
```

动态计算。

---

# 81. SRPE / SMVL

当前训练表已经有：

```text
srpe

smvl
```

继续保留。

但必须明确计算定义。

例如：

```text
SRPE = RPE × duration_min
```

如果 `smvl` 有你项目自己的计算规则，需要将公式写入数据字典或代码注释。

禁止出现：

> 字段存在，但开发人员不知道怎么算。

---

# 82. 训练计划模型

当前：

```text
training_plans
```

以及：

```text
special_training_plans

special_training_plan_sessions
```

暂时全部保留。

但是两套计划的业务职责要明确。

---

# 83. training_plans

定义：

> 运动员级综合训练计划。

---

# 84. special_training_plans

定义：

> 队伍/项目级专项训练计划。

例如：

```text
赛艇队一周专项训练计划
```

---

# 85. special_training_plan_sessions

定义：

> 专项计划中的具体训练课。

---

# 86. 计划和实际训练关联

当前：

```text
training_sessions.plan_session_id
```

存在。

应该继续利用。

关系：

```text
special_training_plan_sessions
        ↓
training_sessions
```

形成：

```text
计划
↓
实际执行
↓
完成度
```

---

# 87. specialty_catalog

当前：

```text
2 条
```

继续作为专项类型目录。

`training_sessions.specialty_id`：

保留。

---

# 88. special_test_events / special_test_results

当前：

```text
0 条
```

但这是：

> 船组/组合测试。

与：

```text
test_sessions
```

运动员个人测试模型不同。

因此不删除。

---

# 89. 两类测试区别

```text
test_sessions
```

主要：

> 个人运动员测试。

```text
special_test_events
+
special_test_results
```

主要：

> 船组、组合、多人专项成绩。

职责不同。

---

# 90. athlete_profiles

继续作为：

> 运动员详细档案扩展表。

不将所有字段塞回：

```text
athletes
```

这是正确的一对一扩展结构。

---

# 91. athlete_profiles隐私字段

包含：

```text
identity_number

phone

home_address

emergency_contact

emergency_phone
```

这些属于敏感个人资料。

前端接口必须：

```text
按权限返回
```

不能列表接口默认全部返回。

---

# 92. athlete_strength_tests关联的 strength_ai_advice

当前：

```text
strength_ai_advice
0 条
```

外键/业务语义依赖：

```text
athlete_strength_tests
```

由于旧力量测试模型将 Deprecated，

这张表也必须调整。

---

# 93. strength_ai_advice处理

当前没有数据，因此建议未来改为关联：

```text
test_session_id
```

而不是：

```text
strength_test_id
```

如果暂无相关业务：

```text
暂时保留
```

但禁止继续开发旧关联。

---

# 94. app_metadata

保留。

以后可存：

```text
schema_version

metric_version

import_parser_version

database_migration_version
```

---

# 95. audit_logs

保留。

数据库重构后，重要操作应该记录：

```text
IMPORT_COMMIT

IMPORT_ROLLBACK

ATHLETE_MERGE

DATA_CORRECTION

TEST_UPDATE

INJURY_UPDATE
```

---

# 96. 旧表处理状态清单

最终：

| 表                              | 状态                   |
| ------------------------------ | -------------------- |
| athletes                       | KEEP                 |
| athlete_profiles               | KEEP                 |
| athlete_origins                | KEEP                 |
| athlete_aliases                | KEEP                 |
| athlete_body_measurements      | KEEP                 |
| training_sessions              | CORE                 |
| training_session_segments      | CORE / MODIFY        |
| training_records               | MIGRATE + DEPRECATED |
| strength_result_sets           | CORE / MODIFY        |
| strength_training_sets         | DEPRECATED           |
| athlete_strength_tests         | MIGRATE + DEPRECATED |
| test_sessions                  | CORE                 |
| test_measurements              | CORE                 |
| metric_definitions             | CORE                 |
| metric_aliases                 | CORE                 |
| daily_wellness                 | CORE                 |
| injury_records                 | CORE                 |
| competitive_state_assessments  | KEEP                 |
| champion_model_standards       | KEEP                 |
| metric_scoring_rules           | KEEP                 |
| data_import_batches            | CORE                 |
| data_import_items              | CORE                 |
| data_import_athlete_candidates | KEEP                 |
| strength_import_batches        | DEPRECATED           |
| project_teams                  | KEEP / MODIFY        |
| training_plans                 | KEEP                 |
| special_training_plans         | KEEP                 |
| special_training_plan_sessions | KEEP                 |
| specialty_catalog              | KEEP                 |
| special_test_events            | KEEP                 |
| special_test_results           | KEEP                 |
| strength_ai_advice             | MODIFY               |
| users                          | KEEP                 |
| account_profiles               | KEEP                 |
| coach_profiles                 | KEEP                 |
| coach_athletes                 | KEEP                 |
| user_area_permissions          | KEEP                 |
| user_project_permissions       | KEEP                 |
| user_team_permissions          | KEEP                 |
| regional_manager_regions       | KEEP                 |
| user_dashboard_preferences     | KEEP                 |
| registration_requests          | KEEP                 |
| audit_logs                     | KEEP                 |
| app_metadata                   | KEEP                 |

---

# 97. 第一阶段需要真正修改的表

本次 V1 不要一次改44张表。

只修改最关键的：

```text
athletes

project_teams

training_sessions

training_session_segments

strength_result_sets

test_sessions

test_measurements

metric_aliases

data_import_batches

data_import_items
```

同时迁移：

```text
training_records

athlete_strength_tests
```

---

# 98. V1 建议新增字段

## athletes

增加：

```text
team_id INTEGER
```

---

## training_session_segments

增加：

```text
intensity_zone TEXT
```

可以考虑：

```text
rpe REAL
```

但不是必须。

---

## data_import_batches

如果目前原文件还没有持久化路径：

增加：

```text
storage_path TEXT
```

---

## strength_result_sets

建议增加：

```text
exercise_code TEXT
```

并最终废弃：

```text
import_batch_id
```

统一使用：

```text
data_import_batch_id
```

---

# 99. V1 不建议新增的表

暂时不要再建：

```text
athlete_test_record

athlete_metric_record

source_file

import_task

training_intensity_detail

strength_training_detail
```

因为现有数据库已经有对应模型。

---

# 100. Excel历史模板最终落表

## 周训练量强度负荷统计

解析：

```text
训练日期
训练内容
U3/U2/U1...
训练时长
公里数
```

落：

```text
training_sessions
+
training_session_segments
```

---

# 101. 力量测试、10桨最大功率

落：

```text
test_sessions
+
test_measurements
```

---

# 102. 赛前力量测试

前测：

```text
test_sessions
test_type = PRE
```

或者：

```text
protocol = PRE
```

后测：

```text
POST
```

具体字段规范后续在 Excel Import SPEC 定义。

---

# 103. 力量训练负荷表

落：

```text
training_sessions
+
strength_result_sets
```

例如：

```text
training_sessions

2026-09-06
力量训练
```

下面：

```text
深蹲 120kg × 8 × 4
```

转换多个：

```text
strength_result_sets
```

---

# 104. 身体成分Excel

落：

```text
athlete_body_measurements
```

---

# 105. 生理/恢复Excel

落：

```text
daily_wellness
```

如果是阶段性实验测试：

```text
test_sessions
+
test_measurements
```

由指标性质决定。

---

# 106. 所有导入必须先经过暂存层

统一：

```text
历史Excel

 ↓

Parser

 ↓

data_import_batches

 ↓

data_import_items

 ↓

运动员匹配

 ↓

指标匹配

 ↓

单位转换

 ↓

日期标准化

 ↓

异常检测

 ↓

人工确认

 ↓

Commit

 ↓

正式业务表
```

---

# 107. 数据库迁移文件规划

建议新增：

```text
db/migrations
```

虽然 SQLite 项目不一定必须使用 Flyway，但仍然要采用版本化 SQL。

例如：

```text
V001__add_team_id_to_athletes.sql

V002__add_intensity_zone_to_segments.sql

V003__normalize_metric_alias.sql

V004__migrate_training_records.sql

V005__migrate_training_wellness.sql

V006__migrate_strength_tests.sql

V007__deprecate_strength_training_sets.sql

V008__deprecate_strength_import_batches.sql
```

---

# 108. SQLite重构特别注意

SQLite 修改表结构不像 MySQL 那么自由。

涉及删除列、修改约束时，推荐：

```text
创建新表

↓

复制数据

↓

验证

↓

删除旧表

↓

重命名新表
```

而不是大量执行：

```text
ALTER COLUMN
```

---

# 109. 所有迁移前必须备份

执行：

```text
training-monitor.db
```

复制：

```text
training-monitor-before-refactor.db
```

禁止直接在唯一数据库上修改。

---

# 110. 第一阶段：建立数据库基线

迁移前记录：

```text
每张表行数

训练总数

运动员数量

测试数量

测试指标数量

训练公里总数

训练时长总数
```

例如当前：

```text
athletes
78

training_sessions
3245

training_records
408

test_sessions
2581

test_measurements
6448

athlete_strength_tests
4637

daily_wellness
2767

athlete_body_measurements
2485
```

迁移完成后必须重新统计。

---

# 111. 第二阶段：迁移 training_records

步骤：

```text
① 读取408条旧训练

② 判断training_sessions是否已存在对应课

③ 不存在则创建

④ wellness字段拆到daily_wellness

⑤ 记录迁移映射

⑥ 比对训练总量
```

---

# 112. 不允许仅比较行数

因为：

```text
一条旧记录
```

可能拆成：

```text
一条training_session

+

一条daily_wellness
```

所以迁移验收要比较业务指标。

---

# 113. training_records迁移验收

至少比较：

```text
总训练分钟

总训练公里

各训练类型训练量

各运动员训练次数

各日期训练量
```

迁移前后应一致或有明确差异说明。

---

# 114. 第三阶段：迁移 athlete_strength_tests

步骤：

```text
① 解析 metrics_json

② 匹配 metric_definitions

③ 没有标准指标进入异常列表

④ 创建test_sessions

⑤ 创建test_measurements

⑥ targets_json → target_value

⑦ 校验结果
```

---

# 115. athlete_strength_tests迁移异常

可能出现：

```text
未知指标名称

无单位

JSON字段为空

重复指标

异常数值
```

不得直接丢弃。

输出迁移报告。

---

# 116. metric_aliases优先补齐

在正式迁移历史力量数据前，先建立别名字典。

否则同一个指标可能变成：

```text
BENCH_PULL

bench_pull

卧拉

卧拉最大
```

多套指标。

---

# 117. 第四阶段：队伍标准化

执行：

```text
athletes.team

 ↓

匹配

project_teams

 ↓

写 team_id
```

无法匹配：

```text
进入异常名单
```

不得直接创建重复队伍。

---

# 118. team字符串短期仍保留

在所有接口切换完之前：

```text
athletes.team
```

继续存在。

新代码优先：

```text
team_id
```

旧字段仅兼容。

---

# 119. 第五阶段：地区收敛

比较：

```text
athletes.region/city/county
```

和：

```text
athlete_origins
```

如果一致：

```text
保留 athlete_origins
```

如果冲突：

```text
生成差异报告
```

不自动覆盖。

---

# 120. 第六阶段：修改后端读写路径

所有训练新增：

```text
training_sessions
```

所有力量训练：

```text
strength_result_sets
```

所有测试：

```text
test_sessions
test_measurements
```

所有状态：

```text
daily_wellness
```

---

# 121. 禁止新代码访问

完成第一阶段后，新业务禁止直接访问：

```text
training_records

athlete_strength_tests

strength_training_sets

strength_import_batches
```

---

# 122. Repository / Mapper约束

可以将旧 Mapper：

```text
TrainingRecordMapper
```

加：

```text
@Deprecated
```

并增加注释：

```text
禁止新增调用，请使用 TrainingSessionRepository
```

---

# 123. AI开发约束

在项目开发规范里加入：

```text
禁止在未确认数据库标准模型的情况下创建新业务表。

禁止为新增测试指标增加数据库列。

禁止绕过 data_import_items 直接从 Excel 写业务表。

禁止继续使用 Deprecated 表开发新功能。
```

这条非常重要。

---

# 124. 数据管理一级模块

原项目：

```text
数据采集
```

最终替换为：

```text
数据管理
```

一级菜单。

---

# 125. 数据管理内容

```text
数据管理
├─ 数据导入
├─ 导入记录
├─ 导入模板
├─ 指标字典
└─ 数据标准
```

---

# 126. 数据标准页面

直接基于数据库真实标准展示：

```text
运动员标准

训练类型

训练结构

强度区间

测试指标

单位

数据来源

数据质量状态
```

---

# 127. 指标字典页面

直接管理：

```text
metric_definitions
```

不要建立第二套配置。

---

# 128. 指标别名页面

可以在指标字典详情增加：

```text
字段别名
```

实际维护：

```text
metric_aliases
```

例如：

```text
10桨

十桨功率

10桨最大功率
```

都映射：

```text
POWER_10
```

---

# 129. 运动员别名

类似处理：

```text
athlete_aliases
```

以后 Excel 导入：

```text
优先标准姓名

↓

别名匹配

↓

模糊匹配

↓

人工确认
```

---

# 130. 数据库最终目标

本次重构完成后形成：

```text
                    【运动员】

                     athletes

                        ↓

 ┌───────────────┬──────────────┬───────────────┐
 ↓               ↓              ↓               ↓

训练             测试           状态            身体成分

training_      test_          daily_          athlete_body_
sessions       sessions       wellness        measurements

 ↓               ↓
segments       measurements

 ↓               ↓
strength_       metric_
result_sets     definitions

                        ↓

                    伤病

                injury_records
```

---

# 131. 数据导入最终架构

```text
                各种历史Excel

                      ↓

                 Parser层

                      ↓

            data_import_batches

                      ↓

             data_import_items

                      ↓

        ┌─────────────┼───────────────┐

        ↓             ↓               ↓

   运动员匹配      指标匹配        数据校验

        ↓             ↓               ↓

              用户确认

                  ↓

              Commit层

                  ↓

        ┌─────────┼─────────┐

        ↓         ↓         ↓

      训练       测试       状态
```

---

# 132. 重构后唯一权威模型

最终明确：

### 运动员

```text
athletes
+
athlete_profiles
+
athlete_origins
```

### 训练

```text
training_sessions
+
training_session_segments
+
strength_result_sets
```

### 测试

```text
test_sessions
+
test_measurements
+
metric_definitions
```

### 状态

```text
daily_wellness
```

### 身体成分

```text
athlete_body_measurements
```

### 伤病

```text
injury_records
```

### 竞技状态

```text
competitive_state_assessments
+
champion_model_standards
+
metric_scoring_rules
```

### 数据导入

```text
data_import_batches
+
data_import_items
+
data_import_athlete_candidates
+
athlete_aliases
+
metric_aliases
```

---

# 133. V1重构明确不做

第一阶段暂时不做：

```text
全部44张表重建

改用MySQL/PostgreSQL

所有中文枚举一次性改英文

彻底删除旧表

重新实现权限系统

重新设计训练计划系统

重写竞技状态算法
```

避免数据库重构无限扩大。

---

# 134. V1实施优先级

## P0

必须完成：

```text
training_records
→
training_sessions

athlete_strength_tests
→
test_sessions/test_measurements

strength_training_sets
→
停止使用

strength_import_batches
→
停止使用
```

---

## P1

完成：

```text
athletes.team
→
team_id

地区模型收敛

metric_aliases

athlete_aliases

training_session_segments强度能力
```

---

## P2

完成：

```text
数据管理页面

历史Excel解析器

字段映射

异常校验

导入模板
```

---

# 135. 数据库重构验收标准

### 验收1

新业务不再写：

```text
training_records
```

---

### 验收2

新力量测试不再写：

```text
athlete_strength_tests
```

---

### 验收3

所有测试指标来自：

```text
metric_definitions
```

---

### 验收4

Excel导入统一经过：

```text
data_import_batches
+
data_import_items
```

---

### 验收5

训练分析页面只读取：

```text
training_sessions
```

体系。

---

### 验收6

测试分析页面只读取：

```text
test_sessions
+
test_measurements
```

---

### 验收7

运动员一天可以存在多堂训练课。

---

### 验收8

一次训练可以存在多个强度分段。

---

### 验收9

新增测试指标不需要：

```text
ALTER TABLE
```

---

### 验收10

旧数据迁移前后：

```text
训练公里

训练时间

测试成绩

运动员数量
```

核对一致。

---

# 136. 最终开发顺序

严格按以下顺序：

```text
① 备份SQLite数据库
```

↓

```text
② 建立数据库基线统计
```

↓

```text
③ 给旧表打Deprecated标记
```

↓

```text
④ 补齐必要的新字段
```

↓

```text
⑤ 建立metric_aliases
```

↓

```text
⑥ training_records数据迁移
```

↓

```text
⑦ wellness数据拆分迁移
```

↓

```text
⑧ athlete_strength_tests迁移
```

↓

```text
⑨ team/team_id迁移
```

↓

```text
⑩ 地区数据收敛
```

↓

```text
⑪ 修改后端Entity/Mapper/Service
```

↓

```text
⑫ 修改现有查询与图表API
```

↓

```text
⑬ 停止旧表写入
```

↓

```text
⑭ 开发数据管理模块
```

↓

```text
⑮ 开发历史Excel模板解析器
```

↓

```text
⑯ 开发字段映射
```

↓

```text
⑰ 数据校验和异常处理
```

↓

```text
⑱ 稳定后删除旧表
```

---

# 137. 最终重构原则

整个竞迹项目后续统一遵循：

> **已有正确模型优先复用，不重新造第二套表。**

> **一个业务领域只允许存在一个权威数据模型。**

> **动态体育测试指标使用 metric_definitions + test_measurements。**

> **一次训练使用 training_sessions，一堂训练内部细分使用 training_session_segments。**

> **力量动作组使用 strength_result_sets。**

> **日常恢复状态使用 daily_wellness。**

> **身体成分使用 athlete_body_measurements。**

> **伤病使用 injury_records。**

> **所有历史 Excel 先进入 data_import_batches / data_import_items，再提交业务表。**

> **Excel 决定的是解析方式，不决定数据库结构。**

> **旧表先迁移、验证、停写，最后再删除，禁止一次性破坏性重构。**

---

# 138. 重构完成后的数据库定位

现在：

```text
44张表
+
多套模型重叠
+
历史字段残留
```

重构完成后：

```text
44张表未必明显减少
```

但会变成：

```text
核心业务表
      +
功能扩展表
      +
权限系统表
      +
历史Deprecated表
```

每张表职责明确。

最终真正重要的不是：

> 表越少越好。

而是：

> **同一种数据只有一个权威来源。**

这就是本次竞迹数据库收敛重构的最终目标。
