# 总览与训练分析规格

> 状态基准：mini-injury-followup-and-todo-loop（2026-09-30）。本文描述教练每日待办相关能力，变更历史见 `openspec/changes/` 归档。

## 教练每日待办

`GET /api/coach/daily-todos`（限 `SCC/PRJ/REG/TD/DMD`，按 `selectableProjects` 与 `accessibleAthleteIds` 过滤，仅支持北京时间当天）返回四个分组与计数：

- `missing`：当天未提交正式训练；
- `attention`：24 小时 SRPE ≥ 600 AU，或存在未痊愈伤病（最新记录口径，近 24 小时更新单独标注），或当日恢复日报自评 `status=rest`（条目携带 `restRequested: true`，原因文案"自评需要休息"）；
- `incompleteTime`：缺少有效开训时间；
- `reviewDue`：复查提醒，见下节。

响应同时携带 `followedUp`（当前用户在该项目今日已跟进的运动员 ID 列表）。`GET /api/coach/team-overview` 每行携带 `wellnessStatus`（当天日报状态或 null），小程序展示"需要休息/需要关注/需要警示"标签。

## 复查提醒分组（reviewDue）

- 每名运动员取最近一条 `status ≠ healthy` 且 `review_date` 非空的伤病记录（按 `created_at` 最新、并列取 `id` 最大；不看更早记录的复查日期；排除未来时间戳记录）。
- `review_date ≤ 北京时间今天 + REVIEW_DUE_WINDOW_DAYS`（常量 3，服务端唯一口径，含已逾期与当天到期）时进入分组，按 `dueIn` 升序（逾期最久在前）。
- 条目包含 `reviewDate` 与 `dueIn`（服务端按北京日期计算：负数=已逾期、0=今天、正数=剩余天数），客户端只生成文案，不做时区换算。

## 待办条目就地动作

小程序待办每行（主体点击仍为查看档案）提供就地动作：未填报/关注/时间待补行提供"代填训练""代填日报"；关注行有伤病时提供"上报伤病"；复查提醒行提供"上报伤病（复查）"。动作按钮 `catchtap` 阻止冒泡并携带含运动员姓名的 `aria-label`；跳转复用既有代填与伤病上报入口，不新增写接口。

## 今日已跟进标记

系统提供按 用户 × 运动员 × 北京日期 的待办跟进工作流标记（`coach_todo_followups` 表；个人工作流状态，不属于训练事实，不参与任何统计口径）：

- `PUT /api/coach/daily-todos/followups`：请求体 `{ project, athleteIds }`（去重后 1–50 个）；仅限管理角色；每个运动员必须属于 `accessibleAthleteIds` 且 `athletes.project` 与请求一致，任一失败整批 403，不做部分写入；`INSERT OR IGNORE` 幂等，写入时惰性清理 90 天前的过期标记；响应返回当前项目今日完整 `followedUp` 名单。
- `DELETE /api/coach/daily-todos/followups?project=&athleteIds=`：传参走 query（`wx.request` 对 DELETE 请求体的行为跨端不可靠），其余校验与幂等同 PUT。
- 标记只对当天生效；小程序将已跟进对象从各分组隐藏、收敛为"已跟进"折叠区（同人跨分组去重，保留首个分组标签），支持逐个撤销后回到原分组，分组计数基于隐藏后名单重算。
