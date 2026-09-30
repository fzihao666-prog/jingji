# 健康、伤病与恢复规格

> 状态基准：mini-injury-followup-and-todo-loop（2026-09-30）。本文描述当前能力，变更历史见 `openspec/changes/` 归档。

## 伤病记录

- `injury_records` 是伤病与疼痛的唯一事实源：`record_type`（formal/feedback）、`body_part`、`side`、`status`（healthy/observation/restricted/rehab/suspended）、`pain_score`（0-10）、`onset_date`、`restrictions`、`rehab_plan`、`review_date`、`note`。
- 写入口径：管理角色经 `POST /api/athletes/:id/injuries` 写入正式记录（formal）；ATL 只能提交本人疼痛反馈，服务端强制 `record_type=feedback`、`status=observation` 并丢弃状态、限制与康复计划字段；所有写入复用 `hasAthleteAccess` 访问范围校验，越权返回 403。
- 小程序档案页提供上报入口，最新记录的状态决定教练待办与伤病关注的解除。

## 疼痛趋势（按部位）

系统提供只读接口 `GET /api/athletes/:id/injuries/pain-trend`，按身体部位返回近 N 天（查询参数 `days`，默认 30，允许 7–90 整数）的每日疼痛评分序列，复用 `hasAthleteAccess`（运动员仅本人，管理角色按授权范围），越权 403，窗口越界 400。

聚合口径：

- 数据来源仅 `injury_records`，`formal` 与 `feedback` 都参与（运动员疼痛反馈是趋势的主要信号）。
- 同一部位同一天存在多条记录时，取 `created_at` 最新（并列取 `id` 最大）一条的 `pain_score`；排序与过滤使用 SQL `datetime()`，不按字符串比较（created_at 存在 SQLite UTC 文本与 ISO 两种历史格式）。
- 未来时间戳记录不参与聚合（与教练待办的伤病关注口径一致）。
- 日期窗口按北京时间计算，响应显式返回 `startDate` 与 `endDate`；部位按最近记录时间倒序，每部位返回 `latestPainScore`、`latestStatus`、`latestRecordAt`。
- 无记录时返回空 `parts`，不以 0 补齐；展示层只呈现评分序列与状态标签，不输出趋势结论或诊断。

小程序档案页伤病分区展示"疼痛趋势"只读卡：每部位一行迷你柱条，柱高为评分占比，点击柱体弹窗显示单日评分与来源（疼痛反馈/伤病记录）；空数据显示空态文案。

## 复查倒计时与复查提醒

- 档案页伤病列表对 `status ≠ healthy` 且 `reviewDate` 非空的记录显示复查倒计时：`复查已逾期 X 天` / `今天复查` / `X 天后复查`，按北京日期差本地计算；无复查日期或健康记录不显示。
- 教练每日待办包含"复查提醒"分组（见 `overview-and-analysis` 规格），档案与待办共用"最近一条非健康且填了复查日期的记录"这一口径。
