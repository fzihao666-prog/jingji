# Delta 规格：总览聚合与教练看板（overview-and-analysis）

## ADDED Requirements

### Requirement: 每日待办复查提醒分组

`GET /api/coach/daily-todos` SHALL 在既有 `missing`、`attention`、`incompleteTime` 之外返回第四个分组 `reviewDue`（复查提醒），并在 `counts` 中返回 `reviewDue` 计数。

入选口径：

- 对权限范围内每名运动员，取其最近一条 `status ≠ 'healthy'` 且 `review_date` 非空的伤病记录（按 `created_at` 最新、并列取 `id` 最大；不考虑比它更新的无复查日期记录）。
- 当 `review_date ≤ 北京时间今天 + REVIEW_DUE_WINDOW_DAYS`（常量 3，服务端唯一口径）时进入该分组，含已逾期与当天到期。
- 分组条目 MUST 包含：`athleteId`、`athleteName`、`team`、`reviewDate`、`dueIn`（整数天：负数=已逾期，0=今天复查，正数=剩余天数，由服务端按北京时间计算）、`injuryName`、`bodyPart`、`status`、`painScore`。
- 分组按 `dueIn` 升序（逾期最久的排最前）。

#### Scenario: 复查日期临近进入提醒

- **WHEN** 某运动员最近一条非健康伤病记录的 `review_date` 为明天
- **THEN** 该运动员出现在 `reviewDue` 分组，`dueIn = 1`

#### Scenario: 已有更新的伤病记录但无复查日期

- **WHEN** 运动员 A 最近一条非健康记录未填复查日期，而倒数第二条记录填了 2 天前的复查日期
- **THEN** A 不进入 `reviewDue` 分组（只看最近一条）

#### Scenario: 健康记录不提醒

- **WHEN** 运动员最近一条伤病记录 `status = 'healthy'`
- **THEN** 该运动员不进入 `reviewDue` 分组

### Requirement: 自评休息并入待办关注分组

`GET /api/coach/daily-todos` SHALL 读取权限范围内运动员当北京时间今天 `daily_wellness.status = 'rest'` 的记录，使这些运动员进入 `attention` 分组，条目 MUST 携带 `restRequested: true`；`highLoad` 与 `injury` 为空的自评休息运动员同样入选。`attention` 条目其余字段与口径不变。`GET /api/coach/team-overview` 的每行 SHALL 增加 `wellnessStatus`（当天 `daily_wellness.status` 或 `null`）。

#### Scenario: 自评休息的运动员进入关注分组

- **WHEN** 运动员当天提交恢复日报并选择"需要休息"，近 24 小时负荷低于阈值且无未痊愈伤病
- **THEN** 该运动员出现在 `attention` 分组且 `restRequested = true`

#### Scenario: 正常训练自评不进入关注分组

- **WHEN** 运动员当天日报 `status = 'normal'` 且无高负荷、无伤病
- **THEN** 该运动员不出现在 `attention` 分组

### Requirement: 待办条目就地动作

小程序每日待办的每个分组条目 SHALL 提供就地动作按钮，且行主体点击仍为查看档案：

- `missing`、`attention`、`incompleteTime` 行：**代填训练**（跳转 `training-entry?athleteId=`）与**代填日报**（跳转 `wellness-entry?athleteId=`）。
- `attention` 行且 `injury` 非空、`reviewDue` 行：**上报伤病**（跳转 `injury-report?athleteId=`）。
- 动作按钮 MUST 使用 `catchtap` 阻止冒泡，不触发行主体的档案跳转；每个按钮 MUST 有独立 `aria-label`（含运动员姓名）。
- 跳转目标页面 MUST 复用既有的目标运动员校验与服务端权限；本需求不新增任何写接口。

#### Scenario: 从待办直接代填日报

- **WHEN** 教练在"当天未填报"分组点击某运动员行的"代填日报"
- **THEN** 进入该运动员的恢复日报页，不触发档案跳转；返回首页后待办按既有刷新机制重算

#### Scenario: 从伤病关注行直接上报伤病

- **WHEN** 教练在"负荷与伤病关注"分组点击带伤病条目的"上报伤病"
- **THEN** 进入该运动员的伤病上报页，部位与侧别字典不变，提交走既有 `POST /api/athletes/:id/injuries`

### Requirement: 教练今日已跟进标记

系统 SHALL 提供按 用户 × 运动员 × 北京日期 的待办"已跟进"工作流标记（独立小表，不属于训练事实），并满足：

- `PUT /api/coach/daily-todos/followups`：请求体 `{ project, athleteIds }`（每项目每请求最多 50 个运动员 ID）；仅限 `SCC/PRJ/REG/TD/DMD`；每个 `athleteId` MUST 属于 `accessibleAthleteIds` 且其 `athletes.project` 等于请求的 `project`，否则 403/400；写入幂等（重复标记不产生重复行）；响应返回当前用户在该项目今日的完整 `followedUp` 名单。
- `DELETE /api/coach/daily-todos/followups`：同构请求体，撤销标记，幂等。
- `GET /api/coach/daily-todos` 响应 SHALL 增加 `followedUp: number[]`（当前用户、当前项目、今天的标记）。
- 标记只对当天生效：昨日及更早的标记 MUST NOT 影响后续日期的待办展示。

小程序端 SHALL：

- 将当前用户已跟进的运动员从四个分组中隐藏，折叠为"已跟进 · N 人"区块，支持逐个"撤销跟进"后回到原分组；
- 分组 chip 计数与搜索结果 MUST 基于隐藏后的名单重算（沿用现有 `filterDailyTodos` 纯视图逻辑）；
- 标记/撤销成功后原地更新视图，不整页重载；标记属于当前登录用户，切换账号后不串用。

#### Scenario: 标记已跟进后从待办隐藏

- **WHEN** 教练对"负荷与伤病关注"分组中的某运动员点击"已跟进"
- **THEN** 该运动员从该分组隐藏并出现在"已跟进"折叠区，chip 计数减 1，刷新页面后仍保持（服务端持久化）

#### Scenario: 次日待办不受昨日标记影响

- **WHEN** 教练昨日标记某运动员已跟进，今天该运动员仍未填报
- **THEN** 今天该运动员重新出现在"当天未填报"分组

#### Scenario: 越权标记被拒绝

- **WHEN** 管理角色对 `accessibleAthleteIds` 之外的运动员调用 PUT followups
- **THEN** 返回 403，不写入任何行

#### Scenario: 运动员角色不可用

- **WHEN** ATL 调用任一 followups 接口
- **THEN** 返回 403
