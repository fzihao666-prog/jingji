# 实施任务：小程序伤病跟进与教练待办闭环

> 依赖顺序：1 → 2 → 3 → 4；2.x 与 3.x 中的验证项随步执行，最后跑全量回归。

## 1. 服务端

- [x] 1.1 `server/core/db-initialize.ts`：新增 `coach_todo_followups` 表（主键 `user_id, athlete_id, followup_date`，双外键 CASCADE），`CREATE TABLE IF NOT EXISTS` 幂等；确认 `database-lock-check` 与既有库升级路径不受影响。
- [x] 1.2 `server/core/coach-daily-todos.ts`：
  - [x] 导出常量 `REVIEW_DUE_WINDOW_DAYS = 3`；
  - [x] `buildDailyTodos` 输入增加 `restAthleteIds`、`reviewDueInjuries`、`followedUpAthleteIds`（均可选，缺省空），纯函数行为可单测；
  - [x] `attention` 条目增加 `restRequested`，入选条件改为 `highLoad || injury || restRequested`；
  - [x] 新增 `reviewDue` 分组（`dueIn` 按北京日期差计算、`dueIn` 升序）与 `counts.reviewDue`；
  - [x] 响应根增加 `followedUp: number[]`；
  - [x] `readDailyTodos` 增加 rest / reviewDue / followups 三条查询（reviewDue 用"最近一条非健康且 `review_date != ''`"相关子查询，SQL 内联 `review_date <= today + 3`）；
  - [x] `readTeamOverview` wellness 查询补 `status` 列，行输出 `wellnessStatus`。
- [x] 1.3 `server/index.ts`（紧邻既有 coach 路由）：
  - [x] `PUT /api/coach/daily-todos/followups` 与 `DELETE /api/coach/daily-todos/followups`：`requireRole('SCC','PRJ','REG','TD','DMD')`、zod strictObject（`project` ∈ PROJECTS、`athleteIds` 去重 1–50 个正整数）、逐个 `hasAthleteAccess` + 项目匹配（任一失败整批 403）、服务端北京日期、`INSERT OR IGNORE` / 删除幂等、响应 `{ followedUp }`、PUT 附带 90 天惰性清理；
  - [x] `GET /api/coach/daily-todos` 传入当前用户 followups（按项目过滤）。
- [x] 1.4 `server/athlete/athlete-routes.ts`：新增 `GET /api/athletes/:id/injuries/pain-trend`：`requireAuth` + `hasAthleteAccess`；`days` 7–90 整数默认 30；窗口函数"按部位按北京日取最新一条"聚合；响应 `{athleteId, days, startDate, endDate, parts[]}`；空数据返回空 `parts`。
- [x] 1.5 单元测试（Vitest，放 `server/core/coach-daily-todos` 对应测试文件或新增）：
  - [x] rest 运动员进入 attention；`normal` 不进入；
  - [x] reviewDue：明天复查 `dueIn=1`、已逾期为负、今天为 0、`healthy` 不入组、"最近一条无复查日期"不入组；
  - [x] followups 幂等与 90 天清理；
  - [x] 疼痛趋势：同日多条取最新、UTC→北京日跨日归属、空数据、`days` 边界。

## 2. 小程序端

- [x] 2.1 `utils/daily-todos.js`：
  - [x] `dailyTodoView` 校验扩展：counts 键加 `reviewDue`、`reviewDue` 数组条目形状、`attention.restRequested`、`followedUp` 安全整数数组；
  - [x] reason 拼接加"自评需要休息"；`reviewDue` 条目生成 `dueLabel`（逾期/今天/X 天后）；
  - [x] `filterDailyTodos` 增加 `review` 分组（`TODO_FILTERS` 加 `'review'`），先剔除已跟进条目并收敛 `followedUpList`，计数基于隐藏后名单。
- [x] 2.2 `utils/daily-todos.test.js`：以上每条校验/视图规则先行补用例（TDD：先红后绿）。
- [x] 2.3 `services/api.js`：新增 `painTrend(athleteId, days)`、`markTodoFollowups(project, athleteIds)`、`unmarkTodoFollowups(project, athleteIds)`，全部走既有 `request()`。
- [x] 2.4 `pages/index` 待办卡：
  - [x] 行结构改为 `todo-row-block`（主体按钮 + 动作区），按钮不嵌套；
  - [x] `missing/incompleteTime` 行：代填训练 / 代填日报；`attention` 行：前两者 +（有伤病时）上报伤病；`reviewDue` 行：上报伤病（复查）；全部 `catchtap` + 独立 `aria-label`；
  - [x] 新增 `reviewDue` 分组 WXML（`复查提醒 · N 人`、`dueLabel` 文案）；
  - [x] 行尾"已跟进"按钮与"已跟进 · N 人"折叠区（含撤销）；标记/撤销成功后仅重算 `todoView`，不整页重载；
  - [x] chip 组新增"复查提醒"；空态文案（"暂无临近复查的伤病"）。
- [x] 2.5 `pages/profile`：
  - [x] `profileView` 为伤病行生成 `reviewLabel`（本地北京日期差，规则与规格一致）；
  - [x] 伤病分区新增"疼痛趋势"卡：部位行 + 迷你柱条 + 最新评分/状态标签，点击弹 `showTrendModal` 明细，空态不填 0，随 `loadPageData` 并行加载并接入 error-box 重试；
  - [x] 新增/复用局部样式，仅用 `app.wxss` 既有色彩变量。
- [ ] 2.6 真机/工具回归清单（未执行：本环境无微信开发者工具/真机，待人工回归）（微信开发者工具 + 真机）：ATL 看本人趋势与倒计时、SCC 代填/上报/标记全流程、越权账号 403 提示、快速切项目、弱网草稿不串、断网重试。

## 3. 全量验证

- [x] 3.1 `npm run check`、`npm run lint`（0 error）、`npm run mini:typecheck`、`npm run mini:dictionary-check`。
- [x] 3.2 `npm run test`：`daily-todos.test.js`、`page-scope`/`tab-load-skeleton` 回归不破。
- [x] 3.3 `npm run api-check`：新增断言组——followups 角色门禁（ATL 403、越权 403、跨项目 403）、幂等重复标记、reviewDue/rest 出现在待办响应、pain-trend 权限与聚合形状。
- [x] 3.4 `npm run database-lock-check`；如涉及并发改动按 AGENTS.md 补定向检查。
- [x] 3.5 `npm run build`（服务端代码改动随构建验证）。
- [x] 3.6 `scripts/coach-daily-todos-mini-check.mjs`：扩展跑真实 `page-scope`/`daily-todos` 覆盖新分组、已跟进隐藏与撤销重算。

## 4. 文档与收尾

- [x] 4.1 `docs/specs/health-and-recovery.md`、`docs/specs/overview-and-analysis.md`：按本变更 delta 落正式规格。
- [x] 4.2 `WeChat Mini Program/README.md` 与根 `README.md`：补充疼痛趋势、复查提醒、待办就地动作、已跟进标记、休息标注五项能力。
- [x] 4.3 `docs/architecture.md`：登记 `coach_todo_followups` 表及其"工作流状态、非训练事实"定位。
- [x] 4.4 交付说明：列出改动文件、验证结果与遗留风险（康复复评结构化、订阅消息仍为后续变更）。

## 5. 追加迭代（2026-09-30，用户反馈）

- [x] 5.1 待办动作按钮移入卡片内部：四组与已跟进区统一为 `.todo-card`（整体点按进档案 + 按钮 `catchtap`），对齐队伍总览交互；清理废弃的 `.todo-row`/`.todo-row-block` 样式。
- [x] 5.2 未填报名单分页：`utils/daily-todos.js` 新增纯函数 `paginateMissing`（每页 5 人、越界收敛、空名单单页），`pages/index` 增加 `todoMissingPage` 状态与上一页/下一页处理器；筛选/搜索/切项目回第一页，标记跟进沿用当前页。单测 4 例（20/20 通过）。
- [x] 5.3 真机回归点：翻页按钮禁用态、卡片内按钮不触发档案跳转、切项目后页码重置。

## 6. 翻页溢出优化（2026-09-30，按用户 Mini Spec）

- [x] 6.1 Web 统一分页逻辑：新建 `src/utils/pagination.ts`（`clampPage`/`pageRange`/`buildPagerItems` 省略号模型：首尾保留、当前页前后各 1 页、贴边内补 1 页）；`RosterPage` 改用省略号页码修复页数多时全量渲染溢出，`AthleteManagementPage` 改用 `pageRange`；两页各自的内联 `safePage` 逻辑删除；vitest include 增加 `src/**/*.test.ts`，新增 `src/utils/pagination.test.ts`（6 例）。
- [x] 6.2 Web 样式：`.roster-pagination` 加 flex-wrap/限宽/裁剪，新增 `.roster-pagination-ellipsis`。
- [x] 6.3 Mini 样式硬化：`.todo-pager` 显式限宽 + overflow hidden；按钮最小点击高度 72rpx（=36px @375 设计宽）、`white-space: nowrap`；指示区 `flex: 0 1 auto; min-width: 0` 自适应收缩，窄屏无横向滚动。
- [x] 6.4 Mini 逻辑复用：新建 `utils/pagination.js`（`clampPage`/`buildPagerState`，与网页端同语义），`daily-todos.js` 的 `paginateMissing` 改为调用它；新增 `utils/pagination.test.js`（3 例）。
- [x] 6.5 说明：完整页码 + 省略号形态属宽屏（网页端），小程序按 spec §4 采用紧凑形态，不展示页码序列。
