# 变更提案：小程序伤病跟进与教练待办闭环

## Why（为什么做）

小程序分析（2026-09-30）确认两个最高优先级缺口：

1. **康复视角：伤病"记下来了"，但康复没有流程。** `injury_records` 只有自由文本 `rehab_plan` 与一个 `review_date` 字段；运动员可反复提交疼痛反馈，但档案页看不到"同一部位疼痛评分随时间的变化"，康复师无法判断趋势；复查日期没有人提醒，教练不打开档案不会注意到"该复查了"。
2. **教练视角：待办"看得见"，但"办不完"。** 待办行只能跳档案，不能就地代填或上报伤病；已跟进的对象第二天原样出现；运动员自评"需要休息"（`daily_wellness.status='rest'`）不进入任何待办分组，主动示弱信号反而要教练翻队伍总览才能看到。

两项均只依赖既有数据（`injury_records` 的 `body_part`/`pain_score`/`review_date`、`daily_wellness` 的 `status`），无需新增训练事实表（唯一新增表是教练个人的"已跟进"工作流标记，不属于训练事实）。

## What Changes（变更内容）

1. **疼痛趋势按部位展示**：新增服务端聚合接口 `GET /api/athletes/:id/injuries/pain-trend`，按部位返回近期每日疼痛评分序列；档案页伤病分区新增只读"疼痛趋势"卡（运动员看本人，管理角色看授权运动员）。
2. **复查到期提醒**：教练每日待办新增"复查提醒"分组（`reviewDue`）：最近一条非健康且填写了复查日期的伤病记录，复查日期在今天起 3 天内（含已逾期）即进入该分组；档案页伤病列表显示"距复查 X 天 / 今天复查 / 已逾期 X 天"。
3. **待办就地动作**：待办每行增加"代填训练 / 代填日报 / 上报伤病"动作按钮，复用既有代填跳转与 `injury-report?athleteId=` 入口；行主体点击仍为查看档案。
4. **今日已跟进标记**：新增服务端轻量工作流状态（`coach_todo_followups` 表，按 用户×运动员×日期），待办响应返回当前用户今日已跟进名单；客户端将已跟进对象从各组折叠为"已跟进"区并可撤销，分组计数随隐藏重算。
5. **需要休息并入待办**：当日 `daily_wellness.status='rest'` 的运动员进入"负荷与伤病关注"分组并标注"自评需要休息"；队伍总览行增加 wellness 状态标签。

## Non-goals（明确不做）

- 不做结构化康复复评记录表、重返训练标准核对（后续单独立项）。
- 不做订阅消息推送（原规划 P2-5，另行评审立项）；本次只做待办内的提醒。
- 不做教练评语/回应通道。
- 不改动伤病记录的写入规则、角色降级（ATL 强制 feedback/observation）与 600 AU 高负荷口径。
- 不引入图表库；疼痛趋势沿用 WXML 柱条/迷你条模式。

## Impact（影响范围）

- **能力规格**：`health-and-recovery`（疼痛趋势、复查倒计时）、`overview-and-analysis`（每日待办分组、就地动作、已跟进、休息标注）。
- **服务端**：`server/core/db-initialize.ts`（新表，幂等迁移）、`server/core/coach-daily-todos.ts`（待办扩展）、`server/index.ts`（待办跟进接口）、`server/athlete/athlete-routes.ts`（疼痛趋势接口）。
- **小程序**：`services/api.js`、`utils/daily-todos.js`（校验与视图）、`pages/index`（待办卡）、`pages/profile`（伤病分区）、样式。
- **测试**：`utils/daily-todos.test.js`、`scripts/api-check.mjs`（新增分组断言）、`scripts/coach-daily-todos-mini-check.mjs`；验证命令沿用 `npm run check / lint / test / api-check / mini:typecheck / mini:dictionary-check / database-lock-check`。
- **文档**：`README.md` 小程序能力段、`docs/specs/health-and-recovery.md`、`docs/specs/overview-and-analysis.md`、`docs/architecture.md`（新表）。
