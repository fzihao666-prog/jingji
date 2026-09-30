# 设计：小程序伤病跟进与教练待办闭环

## 0. 既有事实（本设计的落点）

- 待办唯一口径在 `server/core/coach-daily-todos.ts`：`buildDailyTodos()` 输出 `{date, timezone, generatedAt, windowStart, highLoadThreshold, counts, missing[], attention[], incompleteTime[]}`；`attention` 条目形如 `{athleteId, athleteName, project, team, load24h, highLoad, injury|null, timeIncomplete}`，入选条件 `highLoad || injury`（coach-daily-todos.ts:123-135）。伤病条目取"每运动员最近一条 `status != 'healthy'` 记录"（readDailyTodos 的相关子查询，:193-205）。
- 路由在 `server/index.ts:110-127`，`requireRole('SCC','PRJ','REG','TD','DMD')` + `selectableProjects` + `accessibleAthleteIds`。
- `injury_records` 字段：`record_type/injury_name/body_part/side/status/pain_score/onset_date/restrictions/rehab_plan/review_date/note/created_by/created_at`（db-initialize.ts:168-186）；`GET /api/athletes/:id/injuries` 返回全部字段 + 创建人，`LIMIT 100`（athlete-routes.ts:929-951）。
- `daily_wellness.status`：本人自评仅 `normal/rest`，教练代填额外 `attention/alert`（self-daily-service.ts:70-77）。
- 小程序端 `utils/daily-todos.js` 是网络边界校验 + 纯视图逻辑：`dailyTodoView()` 逐字段校验响应（含 `highLoadThreshold !== 600` 硬校验、counts 与三个分组数组长度一致性），`filterDailyTodos()` 做分组筛选/搜索并重算计数；分组筛选常量 `TODO_FILTERS = ['all','missing','attention','incomplete']`。
- 首页待办行整体是 `<button class="todo-row" bindtap="goToAthlete">`（index.wxml:80、89）；队伍总览已有 `mini-button + catchtap` 的代填按钮模式与 `fillTrainingForAthlete/fillWellnessForAthlete` 处理器（index.wxml:136-141、index.js:530-545）；`injury-report` 页已接受 `?athleteId=` 参数（profile.js:234）。
- 小程序页面缓存 30 秒内按 `isPageCacheFresh`（含 `dataVersion`）复用；`request-guard` 保证仅最新响应写入。

## 1. 服务端设计

### 1.1 新表 `coach_todo_followups`（幂等迁移）

```sql
CREATE TABLE IF NOT EXISTS coach_todo_followups (
  user_id INTEGER NOT NULL,
  athlete_id INTEGER NOT NULL,
  followup_date TEXT NOT NULL,          -- 北京日期 YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, athlete_id, followup_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);
```

- 放入 `db-initialize.ts` 既有初始化序列，`CREATE TABLE IF NOT EXISTS` 天然幂等；无数据回填、无历史表改动，满足 AGENTS.md 迁移约束。
- 语义是"教练个人今日工作流标记"，不是训练事实：不参与任何统计口径，不违反"新训练事实只写三表"的边界。
- 增长控制：标记按天失效；在 PUT 写入路径附带一条 `DELETE WHERE followup_date < date('now', '-90 days')`（北京时间换算后）的惰性清理，防长期膨胀，失败不影响主流程。

### 1.2 `buildDailyTodos` / `readDailyTodos` 扩展

输入增加两个可选集合，保持纯函数可脱离数据库单测：

- `restAthleteIds: number[]`：`readDailyTodos` 新增查询 `SELECT athlete_id FROM daily_wellness WHERE athlete_id IN (...) AND wellness_date = :today AND status = 'rest'`。
- `reviewDueInjuries: TodoReviewInjury[]`：新查询，取每运动员最近一条 `status != 'healthy' AND review_date != ''` 的记录（相关子查询模式与现有 injuries 查询一致），SQL 内联过滤 `review_date <= date(:now, '+3 day')`（北京时间日期入参，避免 SQLite 时区歧义）。

`buildDailyTodos` 输出扩展：

- `attention` 条目增加 `restRequested: boolean`；入选条件改为 `highLoad || injury || restRequested`。
- 新分组 `reviewDue`：条目 `{athleteId, athleteName, project, team, reviewDate, dueIn, injuryName, bodyPart, status, painScore}`，`dueIn` 在 TS 内用北京日期差计算（逾期为负），按 `dueIn` 升序。
- `counts` 增加 `reviewDue`。
- 响应根增加 `followedUp: number[]`（当前用户、当前项目、北京今天的标记，与 `athletes` 同源过滤）。
- 新导出常量 `REVIEW_DUE_WINDOW_DAYS = 3`；600 AU 口径不动。

`readTeamOverview` 的 wellness 查询补 `status` 列，行输出增加 `wellnessStatus: string | null`。

兼容性：响应只增字段/分组；现有网页端不消费这些接口，小程序端校验函数同步更新（见 2.1），无破坏面。

### 1.3 新路由（`server/index.ts`，紧邻既有 coach 路由）

- `PUT /api/coach/daily-todos/followups`、`DELETE /api/coach/daily-todos/followups`
  - `requireRole('SCC','PRJ','REG','TD','DMD')`；zod `strictObject({ project, athleteIds })`，`project` 复用 `PROJECTS` 校验，`athleteIds` 为去重后 1–50 个正整数。
  - 逐个校验 `hasAthleteAccess`（等价于属于 `accessibleAthleteIds`）且 `athletes.project = :project`，任一失败整批 403，不部分写入。
  - 日期取服务端北京今天（`beijingDate(new Date())`），不接受客户端传日期。
  - `PUT` 用 `INSERT OR IGNORE`；`DELETE` 按 `(user_id, athlete_id, followup_date)` 删除；两者都返回 `{ followedUp: number[] }`。
- 疼痛趋势路由放 `server/athlete/athlete-routes.ts`（与 injuries 路由同文件同校验层）：`GET /api/athletes/:id/injuries/pain-trend`，`requireAuth` + `hasAthleteAccess`；zod 校验 `days` 为 7–90 整数默认 30。

### 1.4 疼痛趋势聚合 SQL

单条查询完成"按部位按天取最新"：

```sql
SELECT body_part AS bodyPart, substr(created_at, 1, 10) ... -- 见下
```

采用窗口写法（SQLite 3.25+ 支持，node:sqlite 内置版本满足）：

```sql
SELECT body_part AS bodyPart, pain_score AS painScore, record_type AS recordType,
       status, created_at AS createdAt
FROM (
  SELECT ir.*, ROW_NUMBER() OVER (
    PARTITION BY body_part, date(created_at, '+8 hours')  -- 注意 created_at 为 UTC，需换北京日
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM injury_records ir
  WHERE athlete_id = ? AND created_at >= ?
) WHERE rn = 1
ORDER BY bodyPart, createdAt
```

- 日期归属用 `date(created_at, '+8 hours')` 换算北京日；窗口起点 `created_at >= datetime(:startTime)`（北京 endDate+1 的 00:00 换回 UTC）。
- 序列在 TS 侧按北京日分组为 `series[{date, painScore, recordType}]`，并汇总 `latestPainScore/latestStatus/latestRecordAt`；`recordType` 仅作来源标注（`formal`/`feedback`），不做可信度分级。
- 展示层不输出诊断或趋势结论，只呈现评分序列与状态——延续"不输出诊断"的既有约束。

## 2. 小程序端设计

### 2.1 `utils/daily-todos.js`（边界校验 + 纯视图）

- `dailyTodoView()`：
  - counts 循环键与分组数组校验扩展为 `['total','submitted','missing','attention','incompleteTime','reviewDue']`，并校验 `reviewDue` 数组条目形状（`reviewDate` 日期串、`dueIn` 整数、`bodyPart/injuryName/status` 文本）。
  - `attention` 条目校验 `restRequested` 布尔值，reason 拼接增加"自评需要休息"（排在高负荷/伤病之后、时间缺失之前）。
  - 校验 `followedUp` 为安全整数数组；为每个分组条目计算 `followed: boolean`。
  - `reviewDue` 条目生成展示文本：`dueIn < 0` → `复查已逾期 X 天`，`0` → `今天复查`，`> 0` → `X 天后复查`（日期差由服务端 `dueIn` 给出，客户端不做时区换算）。
- `filterDailyTodos()`：新增 `review` 分组筛选（`TODO_FILTERS = ['all','missing','attention','review','incomplete']`，chip 文案"复查提醒"）；在筛选前先按 `followedUp` 把已跟进条目从四个分组剔除并单独收敛为 `followedUpList`（同样参与关键词搜索）；chip 计数基于隐藏后的名单重算（现有逻辑天然支持）。

### 2.2 `pages/index` 待办卡

- WXML 结构调整：`todo-row` 现为 `<button>`，按钮不能嵌套按钮——每行改为 `<view class="todo-row-block">` 包裹：原 `<button class="todo-row">`（主体，保留 `goToAthlete` 与 aria-label）+ 新增 `<view class="todo-row-actions">`，内放 `mini-button`（沿用队伍总览的按钮类与 `catchtap` 模式）。
- 动作处理器：新增 `fillTrainingForTodo`/`fillWellnessForTodo`/`reportInjuryForTodo`，内部直接复用既有跳转（`training-entry?athleteId=`、`wellness-entry?athleteId=`、`injury-report?athleteId=`）；`missing/incompleteTime` 行显示前两个按钮，`attention` 行按 `injury` 是否存在显示"上报伤病"，`reviewDue` 行显示"上报伤病（复查）"。
- 已跟进：行尾增加"已跟进"按钮（`markFollowedUp`），"已跟进"折叠区每行提供"撤销跟进"（`unmarkFollowedUp`）；两者调用 API 后仅更新本页 `todoView`（重跑 `filterDailyTodos`），不整页重载；`todos.followedUp` 随响应更新。返回首页/下拉刷新仍走既有重算路径。
- 新分组 WXML：`复查提醒 · N 人`，行内容为 `姓名 · 队伍` + `{{dueLabel}} · {{injuryName}}（{{bodyPart}}）`，`dueLabel` 由 2.1 生成。
- a11y：每个新按钮独立 `aria-label`（"为XX代填训练/代填恢复日报/为XX上报伤病/标记XX今日已跟进/撤销XX已跟进"），沿用 `hover-class="access-active"`。
- 页面缓存：标记/撤销与代填返回后的待办刷新都通过既有 `refreshTodos`（独立 request-guard）路径，不触碰 `isPageCacheFresh` 判据。

### 2.3 `pages/profile` 伤病分区

- 复查倒计时：`profileView()` 对每条记录按 2.1 同规则生成 `reviewLabel`（客户端本地按北京日期差计算，`utils/date.js` 已有北京今日工具）；展示在 `list-row-meta`。
- 疼痛趋势卡：伤病分区头部下新增只读卡片"疼痛趋势 · 近 N 天"：
  - 每部位一行：部位名 + 迷你柱条序列（复用 `trend-chart`/`ratio-list` 的 WXML 柱条模式，不引库）+ `最新评分/状态标签`；
  - 点击行弹出既有 `showTrendModal` 明细（逐日评分与来源标签）；
  - 空数据显示"近 N 天无疼痛记录"，不填 0；
  - 数据随档案页既有 `loadPageData` 并行加载（`api.painTrend(athleteId, 30)`），403/空态走统一 error-box 重试。

### 2.4 `services/api.js` 新增

- `painTrend(athleteId, days)` → `GET /api/athletes/:id/injuries/pain-trend?days=`
- `markTodoFollowups(project, athleteIds)` → `PUT /api/coach/daily-todos/followups`
- `unmarkTodoFollowups(project, athleteIds)` → `DELETE /api/coach/daily-todos/followups`
- 全部走既有 `request()` 封装（Bearer、401 处理、错误分类），不新增请求通道。

## 3. 决策记录

| 决策 | 选择 | 理由与放弃项 |
| --- | --- | --- |
| 已跟进标记存哪 | 服务端小表 | 跨设备/重装不丢、未来网页端可复用、与"服务端唯一口径"一致；放弃客户端本地存储（丢数据）与复用 `user_dashboard_preferences`（形状不符） |
| 休息并入哪 | `attention` 分组加原因 | 保持四个 chip 的信息密度，`rest` 本身就是"需要关注"语义；放弃新分组（chip 过多、counts 语义复杂化） |
| 复查提醒依据哪条记录 | 最近一条非健康且带复查日期的记录 | 与既有"最新状态"口径一致；若按"最近一条带复查日期的记录"，旧复查日会覆盖新伤病的判断 |
| 疼痛趋势聚合位置 | 服务端接口 | 窗口有界、口径可测、访问校验单点；放弃客户端用 `GET /injuries` LIMIT 100 自算（窗口受限、聚合规则散落） |
| 当日多条记录取值 | 当日最新一条的评分 | 反映最新自报；放弃取最大值（会把同日好转误报为持续恶化），康复师看序列自行判断 |
| `dueIn` 计算位置 | 服务端 | 北京时区口径单点；客户端只做文案 |
| 复查提醒窗口 | 3 天（常量导出） | 覆盖"本周内要复查"的现场节奏；不做成可配置项，避免过早参数化 |

## 4. 风险与对策

- **客户端校验器脆弱**：`dailyTodoView` 是严格校验，新增字段必须同步扩展校验键与条目形状，否则上线即"数据格式异常"。对策：tasks 中单列该项 + `daily-todos.test.js` 新增用例先行。
- **counts 不变式**：客户端断言 `submitted + missing = total`；`reviewDue/followedUp` 不参与该等式，注意不要把新分组错入等式。
- **UTC/北京日边界**：疼痛趋势按 `created_at('+8 hours')` 归日、复查窗口以北京日期入参；两条路径都要有跨日时刻（如 UTC 16:30）的测试。
- **按钮嵌套**：WXML 按钮不可嵌套，行结构必须重构为 block + 双交互区；回归真机点击热区。
- **越权面**：followups 与 pain-trend 均复用 `hasAthleteAccess`/`accessibleAthleteIds`，api-check 增加 ATL、越权管理账号、跨项目三组负例。
- **演示数据**：`injury_records` 无 demo 标记，疼痛趋势与复查提醒天然包含演示库数据；与既有待办伤病口径一致，不在本变更内区分。
