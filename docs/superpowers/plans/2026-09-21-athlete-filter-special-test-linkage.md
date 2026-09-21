# 运动员筛选与专项测试联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让两个训练首页默认展示团队分析，并通过底部可搜索运动员卡片切换为带团队参照的个人分析和专项测试表现。

**Architecture:** 两页分别维护不持久化的 `athleteId`。专项概览 API 接收并验证个人 ID，返回个人训练、完整团队基准和专项测试比较；体能页按相同项目和周期分别派生团队与个人指标。提取共享选择器与专项测试比较纯函数。

**Tech Stack:** React、TypeScript strict、Vite、Express、SQLite、Vitest、既有 CSS、ECharts/Recharts。

**Spec:** `docs/superpowers/specs/2026-09-21-athlete-filter-special-test-linkage-design.md`

## Global Constraints

- 初始 `athleteId = null`，不得写 URL、应用级状态或持久化存储；刷新和清除均回到团队视图。
- 候选只来自已授权、项目匹配且符合已选队伍范围的运动员；前端搜索不能替代服务端鉴权。
- 个人、团队、趋势与专项测试均复用同一项目、队伍、`from` 与 `to`。
- 缺失数据明确展示缺失状态；禁止模拟、估算或零填充。
- 浏览器请求仅经由 `src/api.ts`；服务端校验 ID、权限、项目和队伍。
- 不新增依赖；禁止 `any`；交互可键盘操作且有可见焦点。

## Review Focus

- 越权、跨项目或队伍外 ID 必须拒绝（Task 2）。
- 个人或团队测试缺失时不得形成零差异（Tasks 1、3）。
- 选择个人不能把团队共同课次的既有去重基准缩成单人（Tasks 1、2）。
- 搜索、清除、项目/队伍变化不得留下失效选择（Tasks 2、3）。
- 超出五张卡片必须滚动可达，并支持键盘选择（Task 2、4）。

---

### Task 1: 专项测试比较与专项概览载荷

**Files:**
- Modify: `shared/special-training.ts:1-112`
- Create: `shared/special-training.test.ts`
- Modify: `server/overview-service.ts:801-842`
- Modify: `server/index.ts:7273-7299`
- Modify: `src/api.ts:561-567`
- Modify: `scripts/api-check.mjs`

**Interfaces:**
- Consumes: 已授权团队的专项测试样本 `{ athleteId, testDate, distanceM, boatClass, bestMs }` 与既有训练聚合。
- Produces: `buildSpecialTestComparison({ athleteId, tests })` 返回 `{ athlete, teamAverage, deltaMs }`；`api.specialTrainingOverview(from, to, project, teamId, athleteId)` 返回个人 `training`、完整 `teamTraining`、`selectedAthlete` 和 `specialTestComparison`。

- [ ] **Step 1: 写入专项测试比较的失败测试**

```ts
it('取最近成绩并计算同日期、距离、艇型的团队均值', () => expect(buildSpecialTestComparison({ athleteId: 7, tests: [{ athleteId: 7, testDate: '2026-09-18', distanceM: 2000, boatClass: 'M1x', bestMs: 415000 }, { athleteId: 8, testDate: '2026-09-18', distanceM: 2000, boatClass: 'M1x', bestMs: 410000 }] })).toMatchObject({ athlete: { bestMs: 415000 }, teamAverage: 412500, deltaMs: 2500 }));
it('无个人成绩时不零填充', () => expect(buildSpecialTestComparison({ athleteId: 7, tests: [] })).toEqual({ athlete: null, teamAverage: null, deltaMs: null }));
```

- [ ] **Step 2: 运行测试，确认失败原因是新导出不存在**

Run: `npm test -- shared/special-training.test.ts`

Expected: FAIL，`buildSpecialTestComparison` 未导出。

- [ ] **Step 3: 最小实现纯函数和类型**

```ts
export type SpecialTestSample = { athleteId: number; testDate: string; distanceM: number; boatClass: string; bestMs: number };
export function buildSpecialTestComparison(input: { athleteId: number; tests: SpecialTestSample[] }): SpecialTestComparison { /* 个人最新记录；同日/距离/艇型每人一条成绩均值 */ }
```

- [ ] **Step 4: 写入服务端载荷组合与边界失败测试**

```ts
it('个人载荷保留完整团队基准和专项测试比较', () => expect(combineSpecialTrainingAnalysis({ training: { summary: { load: 1680 } }, teamTraining: { summary: { load: 1510 } }, specialTestComparison: { athlete: { bestMs: 415000 }, teamAverage: 412500, deltaMs: 2500 } })).toMatchObject({ teamTraining: { summary: { load: 1510 } }, specialTestComparison: { deltaMs: 2500 } }));
```

- [ ] **Step 5: 实现 API 参数与服务端范围校验**

```ts
const athleteId = req.query.athleteId === undefined ? null : Number(req.query.athleteId);
if (athleteId !== null && (!Number.isInteger(athleteId) || athleteId <= 0 || !hasAthleteAccess(user, athleteId))) return res.status(403).json({ message: '无权查看该运动员专项训练。' });
```

读取目标运动员后校验其项目；有 `teamId` 时校验队伍。用完整当前范围计算 `teamTraining`，仅用 `[athleteId]` 计算个人 `training`，只读取当前周期的可见专项测试样本。未选个人时保持当前 `training` 和 `athletes` 响应兼容。

- [ ] **Step 6: 在 API 检查中覆盖授权边界**

在 `scripts/api-check.mjs` 的临时测试数据中断言：合法 ID 返回个人和团队载荷；越权 ID 返回 403；跨项目返回 400；指定队伍外 ID 返回 403。禁止读取或输出生产数据库。

- [ ] **Step 7: 运行测试并提交**

Run: `npm test -- shared/special-training.test.ts && npm run api-check && npm run special-training-check`

Expected: PASS。

```bash
git add shared/special-training.ts shared/special-training.test.ts server/overview-service.ts server/index.ts src/api.ts scripts/api-check.mjs
git commit -m "feat: support personal special training analysis"
```

### Task 2: 共享且可访问的运动员选择器

**Files:**
- Create: `src/components/AthleteAnalysisSelector.tsx`
- Create: `src/components/AthleteAnalysisSelector.css`
- Create: `src/components/athlete-analysis-selector.ts`
- Create: `src/components/athlete-analysis-selector.test.ts`

**Interfaces:**
- Consumes: 调用方已按权限/项目/队伍裁剪的 `Athlete[]`、`selectedAthleteId`、`onSelect`、`onClear`、`renderSummary`。
- Produces: `filterAnalysisAthletes(athletes, query)` 和 `<AthleteAnalysisSelector />`。

- [ ] **Step 1: 写入失败搜索测试**

```ts
it('按姓名、队伍、编号和小项归一化过滤', () => { const athletes = [{ id: 7, name: '张 三', team: '一队', identityNumber: 'A-07', specialties: '单人艇' }]; expect(filterAnalysisAthletes(athletes, '张三')).toHaveLength(1); expect(filterAnalysisAthletes(athletes, ' a-07 ')).toHaveLength(1); expect(filterAnalysisAthletes(athletes, '单人艇')).toHaveLength(1); });
```

- [ ] **Step 2: 运行并确认搜索函数不存在**

Run: `npm test -- src/components/athlete-analysis-selector.test.ts`

Expected: FAIL，`filterAnalysisAthletes` 未导出。

- [ ] **Step 3: 实现搜索、卡片语义和五卡片滚动布局**

```tsx
<section aria-labelledby={headingId}><label htmlFor={searchId}>搜索运动员</label><input id={searchId} type="search" value={query} onChange={onQueryChange} /><button type="button" aria-pressed={selectedAthleteId === null} onClick={onClear}>全部运动员</button><div className="athlete-analysis-selector-list">{visible.map((athlete) => <button type="button" aria-pressed={athlete.id === selectedAthleteId} onClick={() => onSelect(athlete.id)} />)}</div></section>
```

卡片通过 `renderSummary` 仅显示真实字段；无结果显示文本空状态。CSS 使用约五张卡片高度及 `overflow-y: auto`，并设置 `:focus-visible` 和 `[aria-pressed='true']` 的高对比样式。

- [ ] **Step 4: 运行测试并提交**

Run: `npm test -- src/components/athlete-analysis-selector.test.ts`

Expected: PASS。

```bash
git add src/components/AthleteAnalysisSelector.tsx src/components/AthleteAnalysisSelector.css src/components/athlete-analysis-selector.ts src/components/athlete-analysis-selector.test.ts
git commit -m "feat: add athlete analysis selector"
```

### Task 3: 两个首页接入独立的团队/个人状态

**Files:**
- Modify: `src/App.tsx:313-338`
- Modify: `src/pages/TrainingDashboards.tsx:549-735`
- Modify: `src/pages/SpecialTrainingDashboard.tsx:1-326`
- Modify: `src/pages/SpecialTrainingPage.css:370-620`
- Create: `src/pages/strength-analysis-scope.ts`
- Create: `src/pages/strength-analysis-scope.test.ts`
- Modify: `README.md:当前已实现`

**Interfaces:**
- Consumes: Task 1 的专项载荷、Task 2 的选择器和既有项目/日期/队伍筛选。
- Produces: 两页内部的 `selectedAthleteId: number | null`、标题范围提示、关键指标的个人/团队/差异、专项测试表现。

- [ ] **Step 1: 写入体能范围失败测试**

```ts
it('选择个人时只缩小个人数据而保留完整团队范围', () => expect(selectStrengthAnalysisScope([{ id: 7 }, { id: 8 }], 7)).toEqual({ selectedIds: [7], teamIds: [7, 8] }));
```

- [ ] **Step 2: 运行并确认模块不存在**

Run: `npm test -- src/pages/strength-analysis-scope.test.ts`

Expected: FAIL，范围函数尚未导出。

- [ ] **Step 3: 接入体能页**

移除顶部运动员下拉及 `StrengthProps` 的应用级 ID/回调。在页面内使用 `useState<number | null>(null)`，始终保存当前项目的团队数据，另按该 ID 派生个人数据。个人模式标题显示名称和清除按钮，核心指标与图表展示个人值、团队均值、差异；末尾渲染选择器，卡片显示真实课次、时长、负荷与核心体测摘要。删除 `App.tsx` 对体能首页的应用级 ID 传递，但不改个人档案与训练计划调用。

- [ ] **Step 4: 接入专项页**

以页面内状态把 ID 传入 Task 1 API；项目/队伍变化或响应不含选中人时清除。用选择器替换只读名单。个人模式的训练统计和图表读取个人 `training`，四项指标展示 `teamTraining` 同口径均值和差异；“专项测试表现”展示日期、距离、艇型、成绩、团队均值和差异，缺失时渲染 `ContentState`。

- [ ] **Step 5: 更新 README、运行定向验证并提交**

Run: `npm test -- src/pages/strength-analysis-scope.test.ts src/components/athlete-analysis-selector.test.ts shared/special-training.test.ts && npm run check && npm run special-training-check`

Expected: PASS。

```bash
git add src/App.tsx src/pages/TrainingDashboards.tsx src/pages/strength-analysis-scope.ts src/pages/strength-analysis-scope.test.ts src/pages/SpecialTrainingDashboard.tsx src/pages/SpecialTrainingPage.css README.md
git commit -m "feat: unify training athlete analysis selection"
```

### Task 4: 浏览器回归与完整验证

**Files:**
- Modify: `scripts/visual-check.mjs`（仅当该脚本已有可扩展的交互断言能力时）

**Interfaces:**
- Consumes: Tasks 1–3 的最终接口与页面。
- Produces: 可复验的团队默认、搜索、键盘选择、清除和专项测试表现检查。

- [ ] **Step 1: 在运行页面验证关键交互**

用一个可查看多名运动员的非运动员演示账号确认：两页首次均为团队模式；搜索姓名可通过键盘选择卡片；标题显示当前运动员；清除恢复团队；专项页显示成绩比较或明确缺失；变更项目/队伍不会保留范围外人。若现有浏览器脚本不能做 DOM/键盘断言，记录限制，不用截图代替交互断言。

- [ ] **Step 2: 运行完整验证**

Run: `npm test && npm run check && npm run lint && npm run special-training-check && npm run api-check && npm run build`

Expected: 全部退出码 0；任何既有无关失败均记录命令、失败项和关联性。

- [ ] **Step 3: 提交验证调整**

```bash
git add scripts/visual-check.mjs
git commit -m "test: cover athlete analysis workflow"
```
