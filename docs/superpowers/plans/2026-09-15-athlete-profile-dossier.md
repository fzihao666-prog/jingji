# 运动员综合档案实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有个人档案页中完成单运动员综合档案、真实恢复趋势、专项测试筛选和个人团队比较。

**Architecture:** 新建服务端只读档案查询服务，集中实现有效数据过滤、同队同项目比较及统一训练汇总；`server/index.ts` 保持 HTTP 参数、认证和访问范围适配。前端通过 `src/api.ts` 和 `src/types.ts` 获得数据，`PersonalPage` 只组合既有和新增模块。

**Tech Stack:** React、TypeScript strict、Express、SQLite、现有 Recharts/ECharts 图表组件、Node API 回归脚本。

**Spec:** `docs/superpowers/specs/2026-09-15-athlete-profile-dossier-design.md`

## Global Constraints

- 不新增一级页面、平行数据模型、模拟数据、医学判断或自动训练建议。
- 所有浏览器请求必须进入 `src/api.ts`，所有访问范围必须由服务端确认。
- 比较范围必须由目标运动员真实 `team_id`、项目和页面日期范围推导，至少两名可比运动员。
- 排除演示、估算及质量为 `insufficient`、`outlier`、`estimated` 的记录；缺失保持 `null` 或空数组。
- 伤病当前状态截至页面结束日，病史保持全量并明确标记为历史记录。
- 完成后必须运行 `npm run check` 和 `npm run build`。

---

### Task 1: 档案查询领域服务与回归脚本

**Files:**

- Create: `server/athlete-profile-service.ts`
- Create: `scripts/athlete-profile-check.mjs`
- Modify: `server/index.ts`

**Interfaces:**

- Consumes: `buildOverviewPayload({ athleteIds, from, to, project, individual })`、SQLite `db`、已验证的目标运动员和可访问运动员 ID 集合。
- Produces: `buildWellnessTrends(input)`、`buildProfileComparison(input)`、`filterSpecialTestEventsByAthlete(input)`。

- [ ] **Step 1: 编写失败的 API 回归脚本**

```js
const wellness = await json(
  `/api/athletes/${athlete.id}/wellness-trends?from=2026-07-01&to=2026-07-31`,
  {},
  token
);
assert(wellness.status === 200, 'wellness trends request failed');
assert(
  wellness.payload.series.every((series) =>
    series.points.every((point) => point.value !== 0 || point.source !== 'missing')
  ),
  'missing wellness was coerced to zero'
);

const comparison = await json(
  `/api/athletes/${athlete.id}/profile-comparison?from=2026-07-01&to=2026-07-31&project=${encodeURIComponent(athlete.project)}`,
  {},
  token
);
assert(comparison.status === 200, 'profile comparison request failed');
assert(
  comparison.payload.scope.teamId === athlete.teamId,
  'comparison scope must use athlete team id'
);
assert(
  comparison.payload.items.every(
    (item) => item.teamSampleCount === null || item.teamSampleCount >= 2
  ),
  'single-athlete team comparison leaked'
);
```

- [ ] **Step 2: 运行脚本并确认因路由缺失失败**

Run: `node scripts/athlete-profile-check.mjs`

Expected: FAIL，提示 `wellness trends request failed` 或 404。

- [ ] **Step 3: 实现最小领域服务**

```ts
export type ProfileScope = {
  athleteId: number;
  teamId: number | null;
  project: string;
  from: string;
  to: string;
};

export function buildWellnessTrends(input: ProfileScope & { comparableAthleteIds: number[] }) {
  // 查询 daily_wellness 的有效非演示日报，并按日期返回个人值、团队均值和样本数。
}

export function buildProfileComparison(input: ProfileScope & { comparableAthleteIds: number[] }) {
  // 复用 buildOverviewPayload 的训练量；测试类按同日期/允许窗口及相同单位比较。
}
```

服务内建立共享 `isUsableRecord` 谓词，明确排除 `is_demo=1`、演示/估算来源和不合格质量；团队候选只保留同 `team_id`、同项目、有效且位于已授权 ID 集合的运动员。专项测试成员筛选通过 JSON 解析成员 ID，不对艇组成绩进行个人化计算。

- [ ] **Step 4: 在路由层接入访问范围与参数校验**

```ts
app.get('/api/athletes/:id/wellness-trends', requireAuth, (req, res) => {
  const athleteId = Number(req.params.id);
  if (!hasAthleteAccess(req.authUser!, athleteId))
    return res.status(403).json({ message: '无权访问该运动员。' });
  const { from, to } = normalizeOverviewRange({
    from: cleanString(req.query.from),
    to: cleanString(req.query.to),
  });
  return res.json(buildWellnessTrends(resolveProfileScope(req.authUser!, athleteId, from, to)));
});
```

为比较摘要添加同样的 `project`、日期和访问校验；为专项测试查询添加可选 `athleteId`，并在查询前校验该运动员可访问且项目一致。

- [ ] **Step 5: 运行档案与专项测试回归脚本**

Run: `node scripts/athlete-profile-check.mjs && npm run special-test-check`

Expected: PASS；脚本确认无训练日报不会成为 0、单人队伍不产生团队均值、专项结果只包含目标成员。

- [ ] **Step 6: 提交该任务**

```bash
git add server/athlete-profile-service.ts server/index.ts scripts/athlete-profile-check.mjs
git commit -m "feat: add athlete profile data queries"
```

### Task 2: 传输类型、API 门面与复用模块输入

**Files:**

- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `src/components/InjuryRecoveryModule.tsx`
- Modify: `src/components/StrengthProfileModule.tsx`

**Interfaces:**

- Consumes: Task 1 的 `wellness-trends`、`profile-comparison` 与专项测试响应。
- Produces: `WellnessTrendsPayload`、`ProfileComparisonPayload`、可选 `to` 的伤病模块、可选日期范围的体能测试模块。

- [ ] **Step 1: 为 API 门面编写类型失败检查**

```ts
const result = await api.profileComparison(athlete.id, from, to, project);
const sampleCount: number | null = result.comparison.items[0]?.teamSampleCount ?? null;
void sampleCount;
```

将该片段放入 `scripts/athlete-profile-check.mjs` 的临时 TypeScript 编译夹具或专用 `.ts` 检查文件，确保新类型缺失时 `npm run check` 失败。

- [ ] **Step 2: 运行类型检查并确认失败**

Run: `npm run check`

Expected: FAIL，提示 `profileComparison` 或 `ProfileComparisonPayload` 不存在。

- [ ] **Step 3: 添加类型和 API 门面**

```ts
export type ProfileComparisonItem = {
  key: string; label: string; unit: string; personalValue: number | null;
  teamMean: number | null; difference: number | null; teamSampleCount: number | null;
  dateLabel: string | null; unavailableReason: string | null;
};

async profileComparison(id: number, from: string, to: string, project: Project) {
  return request<{ comparison: ProfileComparisonPayload }>(`/api/athletes/${id}/profile-comparison?${new URLSearchParams({ from, to, project })}`);
}
```

`api.specialTests` 扩展可选 `athleteId`；新增 `api.wellnessTrends`。`InjuryRecoveryModule` 接收 `asOfDate` 并将当前状态筛至该日期，历史标题标记“历史记录”；`StrengthProfileModule` 的所有用户可见“运动员表现”文本、导出文件名和 PDF 标题改为“体能测试档案”。

- [ ] **Step 4: 运行类型检查并确认通过**

Run: `npm run check`

Expected: PASS。

- [ ] **Step 5: 提交该任务**

```bash
git add src/types.ts src/api.ts src/components/InjuryRecoveryModule.tsx src/components/StrengthProfileModule.tsx
git commit -m "feat: expose athlete profile data to client"
```

### Task 3: 个人档案组合页与恢复/比较可视化

**Files:**

- Modify: `src/pages/PersonalPage.tsx`
- Modify: `src/styles.css`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 2 的 API 门面、全局 `from`、`to`、`project`、当前运动员和既有图表模块。
- Produces: 单页五区域综合档案，所有卡片遵循全局筛选。

- [ ] **Step 1: 编写页面结构回归断言**

```js
await page.getByRole('heading', { name: '运动员档案', exact: true }).waitFor();
for (const title of ['制胜要素分析', '训练情况', '生理生化与恢复状态', '个人 vs 团队对比']) {
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}
await page.getByText('生理生化数据暂未接入').waitFor();
```

将断言加入 `scripts/personal-profile-title-check.mjs` 并令预期文本先保持新标题，使检查在页面尚未改造时失败。

- [ ] **Step 2: 运行页面回归脚本并确认失败**

Run: `node scripts/personal-profile-title-check.mjs artifacts-athlete-profile http://127.0.0.1:5173`

Expected: FAIL，提示找不到新的区域标题。

- [ ] **Step 3: 组合页面区域与真实数据状态**

```tsx
<section aria-labelledby="profile-recovery-title">
  <SectionHeading id="profile-recovery-title" title="生理生化与恢复状态" />
  <ContentState
    kind="empty"
    title="生理生化数据暂未接入"
    description="等待正式数据模型接入后展示。"
  />
  <WellnessTrendCards trends={wellnessTrends} />
  <InjuryRecoveryModule athlete={selectedAthlete} user={props.user} asOfDate={props.to} />
</section>
```

保留现有个人信息首屏未提交改动、身体成分、FMS、冠军模型、力量测试录入/PDF 和伤病模块；将当前训练摘要拆为体能训练与专项训练卡片，数据只取当前运动员、项目和日期范围。专项测试单独显示艇组语义和空状态；有氧耐力只映射服务端返回的有效指标。比较卡显示范围、单位、样本数、日期和不可比原因。

- [ ] **Step 4: 实现样式并保持可访问性**

```css
.personal-profile-section {
  display: grid;
  gap: var(--space-4);
}
.personal-profile-comparison-empty {
  color: var(--text-muted);
}
```

复用 `src/styles.css` 的现有色彩变量和卡片规则；趋势图提供文字摘要，图例和状态不只靠颜色表达，窄屏下卡片单列排列。

- [ ] **Step 5: 更新用户文档并执行页面检查**

Run: `node scripts/personal-profile-title-check.mjs artifacts-athlete-profile http://127.0.0.1:5173`

Expected: PASS；标题、体能测试档案文案、录入、导出和运动员只读权限均保持正确。

在 `README.md` 的“当前已实现”补充单页综合档案、恢复趋势和团队比较范围说明。

- [ ] **Step 6: 提交该任务**

```bash
git add src/pages/PersonalPage.tsx src/styles.css README.md scripts/personal-profile-title-check.mjs
git commit -m "feat: compose athlete profile dossier"
```

### Task 4: 全量验证与交付检查

**Files:**

- Modify: `docs/architecture.md`（仅当实现中的路由/服务边界与设计不同）

**Interfaces:**

- Consumes: 前三项提交后的工作树。
- Produces: 可复现验证结果与准确交付说明。

- [ ] **Step 1: 运行定向回归**

Run: `node scripts/athlete-profile-check.mjs && npm run special-test-check && npm run api-check`

Expected: PASS。

- [ ] **Step 2: 运行类型与生产构建**

Run: `npm run check && npm run build`

Expected: PASS。

- [ ] **Step 3: 审核工作树与文档一致性**

Run: `git diff --check && git status --short`

Expected: 没有空白错误；只包含本需求的预期文件。

- [ ] **Step 4: 提交验证后的文档差异（如有）**

```bash
git add README.md docs/architecture.md
git commit -m "docs: describe athlete profile dossier"
```
