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
- 动作按钮 MUST 位于待办卡片内部（卡片整体点按为查看档案，按钮 `catchtap` 阻止冒泡），与队伍总览行的交互模式一致。
- "当天未填报"名单 MUST 支持分页浏览：每页最多展示 5 人（`MISSING_PAGE_SIZE` 常量）；翻页控件为居中的"上一页 · 页号指示 · 下一页"（页号仅作指示不可点按：当前页号高亮显示，并标注"/ y 页 · 共 N 人"；小程序按紧凑形态不展示完整页码序列，无需页码省略）；翻页区域 MUST 限宽且裁剪溢出（width/max-width 100%、overflow hidden）、按钮最小点击高度 72rpx 且文字不换行、指示区可自适应收缩，窄屏不产生横向滚动；仅一页时不渲染翻页控件；筛选、搜索或切换分组后回到第一页；标记/撤销跟进后名单变短时页码自动收敛到有效范围，不出现空白页。

#### Scenario: 从待办直接代填日报

- **WHEN** 教练在"当天未填报"分组点击某运动员行的"代填日报"
- **THEN** 进入该运动员的恢复日报页，不触发档案跳转；返回首页后待办按既有刷新机制重算

#### Scenario: 从伤病关注行直接上报伤病

- **WHEN** 教练在"负荷与伤病关注"分组点击带伤病条目的"上报伤病"
- **THEN** 进入该运动员的伤病上报页，部位与侧别字典不变，提交走既有 `POST /api/athletes/:id/injuries`

### Requirement: 人员列表统一展示与翻页

小程序所有"人员列表"类区域 SHALL 统一采用与"当天未填报"一致的展示与翻页逻辑，且 MUST 复用统一实现：

- 分页纯逻辑 `utils/pagination.js` 的 `paginateList(items, page, pageSize)`（`PAGE_SIZE = 5`）：≤5 人全部展示，>5 人每页 5 人，末页不足正常展示不补假数据，页码越界自动收敛；
- 翻页控件为全局注册的自定义组件 `components/pager-nav`（上一页 · 页号指示 · 下一页，页号仅作指示不可点按），页码状态由父级持有，组件只触发 `pagechange` 事件；控件容器限宽裁剪、按钮最小点击高度 72rpx、文字不换行、指示区用 `aria-live="polite"` 播报且不依赖非标准 `aria-role`；
- 流程 MUST 为"先筛选/搜索得到完整人员结果，再按每页 5 人分页"；筛选、搜索或分组变化后回到第一页；标记/撤销等不改变名单结构的操作沿用当前页并越界收敛；
- 已接入列表：每日待办的未填报/负荷与伤病/复查提醒/时间待补/已跟进五组、队伍总览成员、首页伤病关注名单、专项训练运动员汇总列表；
- 不接入的例外（非人员展示列表或特殊交互控件）：今日训练课次列表（课次非人员）、专项测试成绩列表（每行为测试事件）、测试录入成员选择器（表单输入控件）、档案页伤病与身体成分记录（单人记录）；
- 空名单 MUST 显示对应业务空状态文案，不渲染空占位卡片或翻页控件。

#### Scenario: 超过 5 人的列表按 5 人翻页

- **WHEN** 任一已接入人员列表在筛选后有 12 名运动员
- **THEN** 首屏只展示 5 人，翻页控件显示"1 / 3 页 · 共 12 人"，末页展示剩余 2 人

#### Scenario: 筛选变化后回到第一页

- **WHEN** 用户翻到第 2 页后修改搜索关键词或切换分组
- **THEN** 该列表回到第一页并重新按 5 人分页

### Requirement: 教练今日已跟进标记

系统 SHALL 提供按 用户 × 运动员 × 北京日期 的待办"已跟进"工作流标记（独立小表，不属于训练事实），并满足：

- `PUT /api/coach/daily-todos/followups`：请求体 `{ project, athleteIds }`（每项目每请求最多 50 个运动员 ID）；仅限 `SCC/PRJ/REG/TD/DMD`；每个 `athleteId` MUST 属于 `accessibleAthleteIds` 且其 `athletes.project` 等于请求的 `project`，否则 403/400；写入幂等（重复标记不产生重复行）；响应返回当前用户在该项目今日的完整 `followedUp` 名单。
- `DELETE /api/coach/daily-todos/followups?project=&athleteIds=`：传参走 query（`athleteIds` 为逗号分隔整数，最多 50 个），因 `wx.request` 对 DELETE 请求体的行为跨端不可靠；其余校验与幂等要求同 PUT。
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
