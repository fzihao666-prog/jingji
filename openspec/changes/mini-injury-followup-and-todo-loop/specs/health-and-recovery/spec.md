# Delta 规格：健康、伤病与恢复（health-and-recovery）

## ADDED Requirements

### Requirement: 按部位疼痛趋势查询

系统 SHALL 提供只读接口 `GET /api/athletes/:id/injuries/pain-trend`，按身体部位返回该运动员近 N 天（查询参数 `days`，默认 30，允许 7–90）的每日疼痛评分序列，且该接口 MUST 复用 `hasAthleteAccess` 访问范围校验（运动员仅本人，管理角色按授权范围）。

聚合口径：

- 数据来源仅 `injury_records`，不区分 `record_type`（`formal` 与 `feedback` 都参与，运动员疼痛反馈是趋势的主要信号）。
- 同一部位同一天存在多条记录时，MUST 取 `created_at` 最新（并列取 `id` 最大）一条的 `pain_score` 作为当日值。
- 日期窗口按北京时间计算，响应 MUST 显式返回 `startDate` 与 `endDate`。
- 部位序列按最近一次记录时间倒序排列；每个部位 MUST 返回 `latestPainScore`、`latestStatus`、`latestRecordAt`。
- 无任何疼痛记录时返回空 `parts` 数组，不得以 0 补齐。

#### Scenario: 教练查看近 30 天疼痛趋势

- **WHEN** 有权限的管理角色请求 `GET /api/athletes/:id/injuries/pain-trend?days=30`，且该运动员近 30 天在"肩部"有 3 条疼痛反馈、在"膝部"有 1 条正式伤病记录
- **THEN** 响应返回两个部位；肩部序列含 3 个按日取最新评分的点，膝部序列含 1 个点；每个部位带 `latestPainScore` 与 `latestStatus`

#### Scenario: 无权访问返回 403

- **WHEN** ATL 运动员请求其他运动员的疼痛趋势
- **THEN** 返回 403，不泄露目标运动员是否存在

#### Scenario: 窗口参数越界

- **WHEN** 请求 `days=0`、`days=91` 或非整数
- **THEN** 返回 400 与中文错误信息

### Requirement: 档案页伤病列表显示复查倒计时

小程序档案页的伤病记录列表 SHALL 对 `status ≠ healthy` 且 `reviewDate` 非空的记录显示复查倒计时标签：已逾期显示"复查已逾期 X 天"，当天显示"今天复查"，未来显示"X 天后复查"；`reviewDate` 为空或状态为健康的记录不显示该标签。倒计时按北京时间日期差计算，由客户端基于既有 `GET /api/athletes/:id/injuries` 响应本地计算，不新增请求。

#### Scenario: 逾期记录显示倒计时

- **WHEN** 档案页加载某运动员伤病列表，其中一条康复中记录的 `reviewDate` 为 3 天前
- **THEN** 该行显示"复查已逾期 3 天"

#### Scenario: 无复查日期不显示

- **WHEN** 记录的 `reviewDate` 为空字符串
- **THEN** 该行不出现复查标签，布局不塌陷
