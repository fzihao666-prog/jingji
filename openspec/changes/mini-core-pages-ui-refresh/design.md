# 设计：小程序核心页面 UI/UX 统一重设计

## 0. 既有事实（本设计的落点）

- 品牌令牌在 Web 端 `src/styles/00-base-tokens.css:10-21`：`--ink #092b39`、`--river #176f7f`、`--teal #1b9d95`、`--mint #7cc7b5`、`--signal #e65d43`、`--amber #e1a42c`、`--mist #edf3f4`、`--line #d8e3e6`、`--muted #6d8088`；小程序 `app.json` 导航/TabBar 已用同色，`app.wxss` 为硬编码值、无 CSS 变量。
- 训练总览 `pages/index/index.wxml`（143 行）自上而下：scope-filter → 加载条 → 今日状态（ATL）→ 6 指标卡（累计/专项/体能/恢复时长、负荷 AU、损伤）→ 训练负荷趋势（WXML 柱形）→ 训练结构占比条 → RPE 趋势 → 状态监测待办（教练）→ 队伍运动员（教练）。
- 状态能力分散：今日状态卡 `index.wxml:16-45`（`utils/today-status.js` 视图模型）；恢复日报表单 `pages/wellness-entry`（字段模型 `utils/wellness-form.js:6-14`：睡眠时长/睡眠质量/晨脉/体重/疲劳/酸痛/心情 + 今日训练状态；RPE 在 `pages/training-entry`，属训练课次）。全库无「状态检测」页面。
- 三套人员列表：`index.wxml:127-139`（队伍运动员）、`special.wxml:139-152`（运动员）、`templates/training-state.wxml:7-17`（training-athletes，strength 用）；分页统一走 `utils/pagination.js`（`PAGE_SIZE = 5`）+ `components/pager-nav`；行点击统一 `utils/page-actions.js:29-38 goToAthlete` 跳档案 Tab。
- `/api/special-training/overview`（`server/special/special-training-routes.ts:390`）**已支持可选 `athleteId`** 并做 `accessibleAthleteIds` + 项目归属校验；`services/api.js:109` 封装未透传该参数。体能页已是单人视角（`api.strengthTests/strengthTrainingResults/trainingPlans(athleteId)`）。
- `GET /api/athletes/:id/wellness-trends`（`analysis-routes.ts:506` → `buildWellnessTrends`，`athlete-profile-service.ts:117`）返回 `trends[]`：`rpe/sleepHours/morningPulse/weightKg`，点形状 `{date, personalValue, teamMean, teamSampleCount, hasPersonalValue}`；`daily_wellness.fatigue_index` 列存在（`db-initialize.ts:892`）但无趋势项。档案页消费该接口。
- `GET /api/coach/team-overview`（`index.ts:231` → `readTeamOverview/buildTeamOverview`，`coach-daily-todos.ts:371-417`）返回 `summary {total, trained, wellnessReported, averageLoad}` 与行（含 `hasTraining/wellnessReported/wellnessStatus/fatigueIndex/...`），可直接支撑教练侧「应填/已填/未填/需关注」。
- `components/icp-filing` 读根 `filing.js` 常量（`京ICP备2026065980号` + `https://beian.miit.gov.cn/`），点按复制网址；现挂在 `mine.wxml:33` 设置列表之后。登录/注册页也展示同一备案号。全库无「关于竞迹」页面。
- 空数据约定：占比固定全类目、0 值行保留（`utils/chart-placeholder.js` 补全）；空图沿用既有「示例数据」标注（README 首段）或 `templates/training-state` 空/错状态；`utils/training-empty.js` 提供人员列表空态。缺失显示 `--`/`—` 的口径见 `utils/format.js` 与9ad47d0「缺失态文案统一」。

## 1. 设计规格（DESIGN SPECIFICATION）

1. **目的**：竞迹小程序核心页面移动端信息层级与交互统一，服务运动员/教练高频查看训练与身体状态。
2. **风格方向**：Industrial/utilitarian × Editorial data hierarchy（专业竞技数据站：密集数据卡、大数字层级、克制装饰）。
3. **色板**（品牌令牌覆盖 ui-design 默认配色；禁止色收敛）：
   - `--ink #092b39` 标题/导航、`--river #176f7f` 品牌主青、`--teal #1b9d95`/`--mint #7cc7b5` 图表系列、`--signal #e65d43` 警示、`--amber #e1a42c` RPE/变化标注、`--mist #edf3f4` 页面底、`--paper #fff` 卡片、`--line #d8e3e6` 边框、`--muted #6d8088` 辅助字。
   - 覆盖说明：竞迹品牌色板（Web 既有设计系统）优先于 ui-design 技能默认配色；紫色系（tone-purple）渐变收敛进品牌青/琥珀族。
4. **字体**：品牌栈 `'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans SC'`（覆盖「禁用系统字体」默认规则：小程序无法稳定内嵌自定义字体，品牌建立在该栈上）。数值大字号粗体、单位/说明小字号弱化（10-12px 级）。
5. **布局策略**：左右留白 16px（32rpx）；单列 section 流 + 核心指标 2×2 紧凑网格；图表单列通栏；section 头左对齐（品牌色条 + 标题 + 右侧弱化元信息），非居中对称模板；卡片 24rpx 圆角、细边框优先于重阴影；点击目标 ≥ 80rpx；适配底部安全区（`env(safe-area-inset-bottom)`）；禁止横向滚动。

## 2. 页面设计

### 2.1 训练总览（pages/index）

布局顺序：**页面标题区 → 全局筛选 → 今日状态（ATL）→ 核心指标 → 训练趋势 → 训练结构 → RPE 状态 → 重点人员**。

- 标题区：「训练总览」+ 元信息行（当前项目 · 队伍 · 统计周期），scope-filter 紧随其下（沿用统一筛选，图表内不再重复日期选择）。
- 核心指标：第一行 2×2——累计训练时长(h)、专项训练时长(h)、体能训练时长(h)、训练负荷(AU)；第二行保留恢复训练时长与损伤情况（既有指标不删）。指标卡：大数值 + 小单位 + 变化/说明行；缺失 `--`、0 正常显示 0。
- 训练趋势：主图「专项/体能训练时长」按日并列柱状图（数据源 `overview.analytics.days[].specialDurationMin/physicalDurationMin`，同日期同单位小时）；「训练负荷」沿用独立 AU 图（个人 vs 团队参照、点按明细），**不同单位不共轴**。
- 训练结构：专项/体能/恢复 负荷占比条（紧凑比例条，全类目 0 值保留）。
- RPE 状态：沿用 0-10 趋势（均值点 ± 标准差带），点按明细。
- 重点人员：教练「状态监测」待办 + 「队伍运动员」（AthleteSelector，见 2.3）。
- 空数据：保留全部指标卡、图表标题与容器，展示既有空状态/示例数据标注；无运动员或无记录不隐藏页面。

### 2.2 状态检测（重塑 pages/wellness-entry）

布局顺序：**今日状态 → 填报入口 → 状态指标 → 近期趋势 → 历史记录**（教练追加**队伍状态概览**）。

- 今日状态：北京时间日期 + 已填报/未填报（恢复日报口径），不用医学判断标签。
- 填报入口：主按钮「今日填报」/「修改今日记录」滚动锚定到表单区；保存成功/失败/未保存草稿均有明确反馈（沿用 `utils/form-draft.js` 与既有 toast）。
- 状态指标：两列指标卡——睡眠时长(h)、晨脉(bpm)、体重(kg)、主观疲劳、肌肉酸痛、RPE（训练课次口径，与晨间疲劳分列，标注来源）。
- 近期趋势：指标切换 `睡眠 | 晨脉 | 体重 | 疲劳`，一次一图一单位；数据源 `wellness-trends`（fatigue 增量项，见 §3）；缺数据的指标保持可见并显空状态。
- 历史记录：近 7 日已保存记录行（日期 + 指标摘要 + 自评状态），来自既有回填数据/趋势点，缺失显 `--`。
- 教练视角：队伍概览——应填报/已填报/未填报人数 + 需关注人员（自评 rest/attention/alert 或高负荷/伤病，来自 `teamOverview` 行与既有待办口径）；代填沿用既有 picker。
- 运动员视角只显示本人数据（服务端权限兜底）。

### 2.3 公共运动员模块（components/athlete-selector）

- 结构：模块标题 + 人员总数 → 搜索框 → 运动员卡片列表（每页 5 人）→ pager-nav 翻页（第 x/y 页 · 共 n 人）。
- 卡片：左默认人物图标 → 中姓名 + 性别/年龄/队伍/项目（有则显）→ 右状态/选中标记 + 「档案 ›」详情入口；整卡可点（选中/下钻），详情入口 catchtap 跳档案；**不显示身份证号**。
- 选中态：品牌青描边 + 浅青底；再次点按选中卡片或「返回团队视角」清除选择（专项/总览适用）。
- 行为参数化（properties）：`title`、`athletes`、`selectedId`、`showDetail`、`emptyText`；分页/搜索为组件内纯视图计算（复用 `utils/pagination.js`），筛选后回到第 1 页，禁用无效翻页。
- 接入：index「队伍运动员」（点击=下钻个人周期视图，保留团队参照与返回入口）、special「运动员」（点击= `specialTrainingOverview(..., athleteId)` 切换个人专项视图）、strength「运动员」（点击=切换选中运动员，页面指标/图表同步）。服务端继续按权限校验，前端不构造越权参数。

### 2.4 我的页备案信息

- 结构：用户信息 → 功能/设置入口 → 退出登录 → **底部备案区**（固定内容区，非悬浮）。
- 备案区：`小程序备案号：京ICP备2026065980号` 居中、12–13px、`--muted` 低对比辅助色；与上模块间距 ≥ 24px；`padding-bottom: calc(24px + env(safe-area-inset-bottom))`；不遮挡 TabBar、不影响滚动。沿用点按复制查询网址（不使用 HTML 链接/无效 WebView）。

## 3. 服务端增量（唯一后端改动）

`buildWellnessTrends`（`athlete-profile-service.ts`）趋势数组增量增加：

```ts
trend('fatigue', '疲劳', '', queryWellness(scope, 'fatigue_index'), scope.athleteId)
```

- `queryWellness` 的列联合类型扩 `'fatigue_index'`；点形状与既有四项完全一致；响应只增字段不改既有键，档案页消费端不受影响。
- 不改计算口径、不做医学判断；无数据日期不出点（与既有趋势一致）。

## 4. 视觉与交互规范（全页面共用）

- 间距刻度：section 间距 20px、卡内边距 16px、卡间距 12px、指标网格 gap 12px；页面左右 16px。
- 字阶：页面/模块标题 18-20px 粗、卡标题 15-16px、数值 22-28px 粗、单位/辅助 11-12px `--muted`。
- 状态色语义：成功/已填报 `--teal`、警示/需关注 `--amber`、危险/未愈 `--signal`、中性 `--muted`；不引入高饱和新色。
- 加载/空/错误/无权限：复用 `templates/training-state`（Loading/空态/错误重试）与 `training-empty` 文案口径；无权限显「权限不足」类提示，不静默隐藏。
- 可点区域 ≥ 80rpx；长姓名允许换行或省略号；窄屏单列化沿用既有 ≥700px 居中容器。

## 5. 验证路由

- `npm run mini:typecheck`、`npm run mini:dictionary-check`、`npm run check`、`npm run lint`、`npm test`（分页/页面视图/趋势用例）。
- 服务端增量：`npm run api-check` 断言 wellness-trends 含 fatigue 项且既有键不变；`npm run build` 随服务端改动验证。
- 真机项（本环境无开发者工具/真机，列入交付说明）：安全区/TabBar 遮挡、窄屏长姓名、点击热区、趋势切换流畅性。
