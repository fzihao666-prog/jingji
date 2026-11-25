# 变更提案：小程序核心页面 UI/UX 统一重设计

## Why（为什么做）

小程序核心页面经过多轮功能迁移，视觉与交互逐渐分散：

1. **训练总览信息层级平铺**：6 张指标卡等权排列，趋势/结构/RPE 图表标题与实现风格不一，核心数据不突出；专项/体能训练量只有汇总数字，没有按日并列对比。
2. **状态能力分散**：今日状态卡在首页、恢复日报表单独立成页，没有「今日状态 → 填报 → 指标 → 趋势 → 历史」的完整状态检测体验；恢复趋势只在档案页以对照表呈现，且无疲劳维度趋势。
3. **三套人员列表各写一遍**：首页「队伍运动员」、专项「运动员」、体能「运动员」三处各自实现搜索、分页与行卡片（`utils/pagination.js` 复用但行模板/交互不一致）；点击行均跳档案 Tab，无法在本页切换个人分析视图。
4. **备案信息位置**：`icp-filing` 挂在设置列表之后，与「退出登录」距离过近，未形成页面底部固定内容区。

## What Changes（变更内容）

1. **统一基础视觉层**：`app.wxss` 引入品牌 CSS 变量（`--ink/--river/--mist/--line/--muted` 等，与 Web 端 `00-base-tokens.css` 同值）；统一卡片、section 头、指标卡、空/错状态样式；指标卡色调收敛进品牌色族（去紫色渐变）。
2. **公共运动员模块**：新增 `components/athlete-selector`（搜索 + 运动员卡片 + 每页 5 人翻页 + 选中高亮 + 可选「档案」详情入口），三处人员列表统一改用该组件，删除重复行模板。
3. **训练总览重排**：页面标题（项目/队伍/周期元信息）→ 全局筛选 → 今日状态（ATL）→ 核心指标 2×2（累计/专项/体能/训练负荷，恢复时长与损伤情况保留为次级行）→ 训练趋势（专项/体能训练时长并列柱状图 + 训练负荷独立图表，不混用纵轴）→ 训练结构（专项/体能/恢复占比条）→ RPE 状态趋势 → 重点人员（教练待办 + 队伍运动员）。
4. **状态检测页**：重塑 `pages/wellness-entry` 为状态检测页：今日状态 → 填报/修改入口 → 状态指标两列卡（睡眠时长、晨脉、体重、主观疲劳、肌肉酸痛、RPE；RPE 来自训练课次、与晨间疲劳分列）→ 单指标趋势（睡眠|晨脉|体重|疲劳，一次一轴）→ 历史记录；教练视角增加队伍状态概览（应填/已填/未填/需关注，来自 `/api/coach/team-overview`）。
5. **趋势数据增量**：`GET /api/athletes/:id/wellness-trends` 响应增量增加 `fatigue`（疲劳）趋势项（`daily_wellness.fatigue_index` 既有列，口径不变），供状态检测页指标切换使用。
6. **个人分析视图切换**：选中运动员后，专项页调用 `/api/special-training/overview?athleteId=`（服务端已支持且校验权限）切换个人专项数据；体能页切换既有按人体能接口；提供「返回团队视角」入口；行卡尾部保留进档案详情入口。
7. **备案信息**：`icp-filing` 调整为「我的」页底部固定内容区：`京ICP备2026065980号` 居中、12–13px、低对比辅助色、适配底部安全区；沿用点按复制工信部查询网址行为。

## Non-goals（明确不做）

- 不改权限模型、训练统计口径、数据库结构；不新增业务事实接口（仅 `wellness-trends` 响应增量一个趋势字段）。
- 不引入图表库；沿用 WXML 柱形/占比条实现。
- 不新建「关于竞迹」页（全库不存在此页）；不把网站备案号 `京ICP备2026066298号-1` 放入小程序。
- 不做账号权限配置、批量导入等网页端能力；不动登录/注册/档案/填报表单的业务规则。
- 占比/结构图表继续固定展示全部分类、0 值行保留；空图沿用既有「示例数据」标注或空状态模式，不伪造测量数据。

## Impact（影响范围）

- **小程序**：`app.wxss`（变量与基础组件类）、`components/athlete-selector/`（新）、`pages/index`、`pages/wellness-entry`、`pages/special`、`pages/strength`、`pages/mine`、`components/icp-filing`、`services/api.js`（`specialTrainingOverview` 增加可选 `athleteId`、`wellnessTrends` 消费扩展）、`templates/training-state.wxml`（清退重复人员行）。
- **服务端**：`server/analysis/athlete-profile-service.ts`（`buildWellnessTrends` 增加 fatigue 趋势项，增量兼容）。
- **测试**：`utils/` 与页面既有 vitest 用例回归；`npm run mini:typecheck`、`npm run mini:dictionary-check`、`npm run api-check`（wellness-trends 形状）、`npm run check`、`npm run lint`。
- **文档**：`WeChat Mini Program/README.md`（状态检测页、人员模块统一、备案位置）；`docs/specs/overview-and-analysis.md`、`docs/specs/health-and-recovery.md` 对应 delta。
