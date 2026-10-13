# 实施任务：小程序核心页面 UI/UX 统一重设计

> 依赖顺序：1 → 2 → 3/4/5 可并行 → 6；验证项随步执行，最后全量回归。

## 1. 基础视觉层与公共组件

- [x] 1.1 `app.wxss`：引入品牌 CSS 变量（`--ink/--river/--teal/--mint/--signal/--amber/--mist/--paper/--line/--muted`，与 `00-base-tokens.css` 同值）；建立统一 section 头、卡片、指标卡、空/错状态样式；指标卡色调收敛进品牌色族（去 tone-purple 紫色渐变）；既有硬编码色逐步改用变量（页面级不再新增硬编码）。
- [x] 1.2 新增 `components/athlete-selector/`（js/wxml/wxss/json）：properties `title/athletes/selectedId/showDetail/emptyText`，内置搜索 + 每页 5 人分页（复用 `utils/pagination.js` + `components/pager-nav`）+ 选中高亮 + 「档案 ›」详情入口（catchtap）+ 空态；`bind:select` 抛出选中运动员，`bind:clear` 抛出清除选择。
- [x] 1.3 单测：分页重算（搜索后回第 1 页）、选中态、空数据；沿用 vitest 既有组织方式。

## 2. 服务端趋势增量

- [x] 2.1 `server/analysis/athlete-profile-service.ts`：`queryWellness` 列联合扩 `'fatigue_index'`，`buildWellnessTrends` 增加 `trend('fatigue', '疲劳', '', ...)`；既有键与点形状不变。
- [x] 2.2 `npm run api-check` 增加断言：wellness-trends 含 `fatigue` 趋势项、形状与既有项一致；`npm run check` 通过。

## 3. 训练总览重排（pages/index）

- [x] 3.1 标题区：「训练总览」+ 项目/队伍/周期元信息行；scope-filter 紧随其下。
- [x] 3.2 核心指标：第一行 2×2（累计/专项/体能时长、训练负荷），第二行保留恢复时长与损伤情况；数值大字 + 单位小字 + 说明行；0 显 0、缺失显 `--`。
- [x] 3.3 训练趋势：新增「专项/体能训练时长」按日并列柱状图（`analytics.days` 的 special/physicalDurationMin）；训练负荷 AU 保留为独立图表，不共轴；点按明细沿用。
- [x] 3.4 训练结构 / RPE 状态：沿用数据口径，统一图表标题、图例与卡片样式；占比全类目 0 值保留。
- [x] 3.5 重点人员：教练待办（状态监测）样式统一；「队伍运动员」换用 `athlete-selector`，点击=下钻个人视图并高亮，「返回团队视角」清除选择，「档案 ›」跳档案；删除旧人员行模板。
- [x] 3.6 空数据：全部指标卡与图表容器保留，展示既有空状态/示例数据标注；无人员显示「暂无可管理运动员」。

## 4. 状态检测页（重塑 pages/wellness-entry）

- [x] 4.1 页面骨架改为：今日状态 → 填报入口 → 状态指标两列卡 → 近期趋势 → 历史记录（教练：队伍状态概览）；导航标题改「状态检测」；表单区保留（锚点滚动，业务规则不动）。
- [x] 4.2 状态指标：睡眠时长、晨脉、体重、主观疲劳、肌肉酸痛、RPE 两列卡；RPE 标注训练课次来源、与晨间疲劳分列；缺失显 `--`、0 显 0。
- [x] 4.3 近期趋势：指标切换 `睡眠|晨脉|体重|疲劳` 单指标柱/线形图（WXML），数据 `api.wellnessTrends`（含 fatigue 增量）；无数据指标保持可见并显空状态。
- [x] 4.4 历史记录：近 7 日记录行（日期 + 摘要 + 自评状态），沿用回填数据；保存成功/失败反馈与草稿提示沿用既有实现。
- [x] 4.5 教练视角：`api.teamOverview` 渲染应填/已填/未填人数与需关注人员（自评 rest/attention/alert、高负荷、伤病）；代填 picker 沿用；运动员视角仅本人。
- [ ] 4.6 真机/工具回归清单（人工，本环境无开发者工具/真机，待人工回归）：填报—保存—修改全流程、弱网草稿、教练代填、趋势切换、安全区。

## 5. 专项/体能运动员模块统一（pages/special、pages/strength）

- [x] 5.1 两页人员模块换用 `athlete-selector`（标题/空态按页配置），删除 `training-athletes` 重复行模板的人员卡片部分。
- [x] 5.2 special：点击运动员 → `specialTrainingOverview` 传 `athleteId` 切换个人专项视图，指标/图表同步，「返回团队视角」还原；周期/项目筛选保留。
- [x] 5.3 strength：点击运动员 → 切换选中运动员（scope），指标/图表同步；未选中显「请选择运动员」空视图；保留「档案 ›」详情入口。
- [x] 5.4 权限：ATL 不展示人员模块（沿用 acfc585）；选中只允许当前项目可访问列表内运动员，越权请求由服务端 403 拦截并显错误态。

## 6. 我的页备案信息（pages/mine、components/icp-filing）

- [x] 6.1 `icp-filing` 调整为页面底部固定内容区：`京ICP备2026065980号` 居中 12–13px `--muted` 低对比辅助色；与上模块间距 ≥ 24px；`env(safe-area-inset-bottom)` 适配；不遮挡 TabBar。
- [x] 6.2 沿用点按复制工信部查询网址；登录/注册页备案号样式与文案一致性检查（号码不变、不放网站备案号）。

## 7. 全量验证与收尾

- [x] 7.1 `npm run mini:typecheck`、`npm run mini:dictionary-check`、`npm run check`、`npm run lint`。
- [x] 7.2 `npm run test`：分页、wellness-form、today-status、training-empty、page-scope 等相关用例回归；新增组件/视图用例通过。
- [x] 7.3 `npm run api-check`（含 2.2 断言）；`npm run build`（服务端改动）。
- [x] 7.4 文档：`WeChat Mini Program/README.md`（状态检测页、AthleteSelector、备案位置）、`docs/specs/overview-and-analysis.md` 与 `docs/specs/health-and-recovery.md`（fatigue 趋势）。
- [x] 7.5 交付说明：改动文件、验证结果、仍需真机确认项、剩余风险。
