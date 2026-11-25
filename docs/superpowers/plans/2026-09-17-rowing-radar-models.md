# 赛艇专项与体能雷达模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在个人档案中实现项目可配置的雷达框架，并仅启用已确认的赛艇专项 5 维和体能 6 维。

**Architecture:** 共享纯领域模块定义维度、方向与标准化。服务端以新接口读取真实有效测试记录和带可追溯来源的冠军参考；缺少任一来源要件时不返回参考数值。前端复用 ECharts，在 FMS 后显示两张全宽的“雷达 + 差值”卡片。

**Tech Stack:** React、TypeScript strict、Express、SQLite、ECharts。

**Spec:** `/Users/firstmac/.codex/attachments/429285ec-8a1e-4c5d-9f63-7ad2348c57bf/pasted-text.txt`

## Global Constraints

- 仅配置赛艇；其他项目不得回退使用赛艇维度。
- 专项：主项水上计时、2000m、5000m、30分钟20桨、递增测功仪峰值功率。
- 体能：相对深蹲、相对卧拉、相对高翻/高拉、垂直纵跳、卧拉2分钟、前支撑。
- 排除演示、估算、异常、来源不明数据；缺失不补0。
- 冠军参考必须有 URL、来源名称、年份、协议、性别和艇型/适用范围。
- 时间为越小越好；其他维度为越大越好；可达成度最高显示120%，真实值不截断。
- 运动员查询复用服务端访问范围校验，浏览器调用只经 `src/api.ts`。

---

### Task 1: 共享维度与标准化规则

**Files:**
- Create: `shared/athlete-radar-model.ts`
- Create: `scripts/athlete-radar-model-check.mjs`

**Interfaces:**
- Produces `ROWING_RADAR_DIMENSIONS`、`RadarDirection`、`buildRadarComparison()`。

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict';
import { buildRadarComparison } from '../shared/athlete-radar-model.ts';
assert.deepEqual(buildRadarComparison('lower_better', 388, 372), {
  achievedPercent: 95.9, signedDifference: 16, comparable: true,
});
assert.deepEqual(buildRadarComparison('higher_better', 1.7, 1.5), {
  achievedPercent: 113.3, signedDifference: 0.2, comparable: true,
});
assert.deepEqual(buildRadarComparison('higher_better', null, 1.5), {
  achievedPercent: null, signedDifference: null, comparable: false,
});
```

- [ ] **Step 2: 确认失败**

Run: `node scripts/athlete-radar-model-check.mjs`

Expected: `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现最小领域模块**

```ts
export const ROWING_RADAR_DIMENSIONS = {
  special: [
    ['rowing_on_water_time', '主项水上计时', 's', 'lower_better'],
    ['rowing_erg_2000_time', '2000m测功仪', 's', 'lower_better'],
    ['rowing_erg_5000_time', '5000m测功仪', 's', 'lower_better'],
    ['rowing_erg_30min_20spm_split', '30分钟20桨配速', 's/500m', 'lower_better'],
    ['rowing_erg_peak_power', '递增测功仪峰值功率', 'W', 'higher_better'],
  ],
  physical: [
    ['relative_squat', '相对深蹲', '倍体重', 'higher_better'],
    ['relative_bench_pull', '相对卧拉', '倍体重', 'higher_better'],
    ['relative_high_pull', '相对高翻/高拉', '倍体重', 'higher_better'],
    ['vertical_jump', '垂直纵跳', 'cm', 'higher_better'],
    ['bench_pull_2min', '卧拉2分钟', '次', 'higher_better'],
    ['front_plank', '前支撑', 's', 'higher_better'],
  ],
} as const;
```

实现 `buildRadarComparison(direction, currentValue, referenceValue)`：输入为 null、非有限数或参考为0时不可比；否则按方向计算达成度，并把真实差值四舍五入为一位。

- [ ] **Step 4: 验证通过并提交**

Run: `node scripts/athlete-radar-model-check.mjs`

Expected: 退出码 `0`。

```bash
git add shared/athlete-radar-model.ts scripts/athlete-radar-model-check.mjs
git commit -m "feat: define rowing radar dimensions"
```

### Task 2: 来源可追溯的个人雷达接口

**Files:**
- Modify: `server/db.ts`
- Modify: `server/index.ts`
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `scripts/api-check.mjs`

**Interfaces:**
- Produces `GET /api/athletes/:id/radar-models?from=YYYY-MM-DD&to=YYYY-MM-DD`。
- Returns `{ special: AthleteRadarModel, physical: AthleteRadarModel }`。

- [ ] **Step 1: 写失败 API 检查**

```js
const result = await jsonRequest(`/api/athletes/${athlete.id}/radar-models?from=2026-01-01&to=2026-12-31`, coachToken);
assert.equal(result.special.dimensions.length, 5);
assert.equal(result.physical.dimensions.length, 6);
assert.ok(result.special.dimensions.every((x) => x.currentValue === null || !x.isDemo));
```

- [ ] **Step 2: 确认端点尚不存在**

Run: `npm run api-check`

Expected: 对新端点收到 `404`。

- [ ] **Step 3: 增加幂等表和服务端读取**

在 `server/db.ts` 新增 `radar_reference_sources`（`name`、`url`、`source_year`、`protocol`、`verified_at`）和 `radar_reference_values`（`project`、`radar_kind`、`metric_key`、`gender`、`boat_class`、`value_num`、`unit`、`source_id`、`active`），并为组合查询建索引。

在 `server/index.ts` 新路由中执行 `requireAuth`、`hasAthleteAccess` 和项目一致性校验。仅取 `test_measurements`、`test_sessions`、`athlete_body_measurements` 中最新且有效、非演示记录；三项相对力量以同日或此前最近有效体重计算。专项水上计时必须匹配性别、艇型、距离。参考值必须关联完整且已验证来源；否则返回 `reference_pending` 和空参考值，绝不回退到现有无来源模型表。

- [ ] **Step 4: 补齐客户端类型与门面**

```ts
export type AthleteRadarDimension = {
  key: string; label: string; unit: string;
  direction: 'higher_better' | 'lower_better';
  currentValue: number | null; referenceValue: number | null;
  achievedPercent: number | null; signedDifference: number | null;
  status: 'ready' | 'measurement_pending' | 'reference_pending';
  source: { name: string; url: string; year: number; protocol: string } | null;
};
```

在 `src/api.ts` 增加 `radarModels(id, from, to)`。

- [ ] **Step 5: 验证通过并提交**

Run: `npm run api-check`

Expected: 赛艇返回 5+6 个维度；无可靠数据时是待采集/待配置，不是 `0`。

```bash
git add server/db.ts server/index.ts src/types.ts src/api.ts scripts/api-check.mjs
git commit -m "feat: add verified athlete radar model API"
```

### Task 3: 档案页两张雷达卡片

**Files:**
- Create: `src/components/AthleteRadarComparison.tsx`
- Modify: `src/pages/PersonalPage.tsx`
- Modify: `src/styles.css`
- Modify: `scripts/visual-check.mjs`

**Interfaces:**
- Consumes Task 2 的 `AthleteRadarModel`；produces `AthleteRadarComparison({ model, loading, title })`。

- [ ] **Step 1: 写失败的视觉断言**

```js
await page.getByRole('heading', { name: '专项测试雷达' }).waitFor();
await page.getByRole('heading', { name: '体能测试雷达' }).waitFor();
```

- [ ] **Step 2: 确认失败**

Run: `npm run visual-check -- tmp/radar-visual http://127.0.0.1:5173`

Expected: 找不到“专项测试雷达”。

- [ ] **Step 3: 实现卡片**

复用 `EChart`，雷达最大轴值为 `120`。仅 `status === 'ready'` 的指标进入 series；少于三项时用 `ContentState` 明确列出待采集/待参考原因。右侧用 `dl > div > dt/dd` 展示当前、参考、真实单位差值和达成度；来源用可聚焦普通链接呈现。FMS 后依次插入两张全宽卡片；仅赛艇请求数据，其他项目显示“该项目雷达维度待配置”。

新增专用样式：桌面为约 `58/42` 图表/明细，`900px` 以下单列；不使用强阴影；文本可换行；单位小于主值。

- [ ] **Step 4: 验证并提交**

Run: `npm run visual-check -- tmp/radar-visual http://127.0.0.1:5173`

Expected: 桌面无横向溢出，窄屏先图后明细，缺失来源不显示虚假值。

```bash
git add src/components/AthleteRadarComparison.tsx src/pages/PersonalPage.tsx src/styles.css scripts/visual-check.mjs
git commit -m "feat: show rowing radar cards"
```

### Task 4: 交付验证与说明

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新说明**

说明赛艇雷达仅使用真实、有效、非演示测试数据；来源、协议或参考缺失时显示待配置；其他项目待独立审核。

- [ ] **Step 2: 执行验证**

Run: `node scripts/athlete-radar-model-check.mjs && npm run api-check && npm run check && npm run build`

Expected: 全部退出码 `0`；仅允许现有 chunk 体积提示。

- [ ] **Step 3: 人工无障碍检查**

在 320px 与 200% 缩放下检查无横向溢出；键盘可聚焦来源链接；状态不只靠颜色；读屏顺序为指标、当前、参考、差值、达成度。

## Self-review

- Task 1 覆盖 5 项专项与 6 项体能维度、方向、标准化和超100%规则。
- Task 2 覆盖真实数据、权限、项目隔离、来源可追溯和缺失处理。
- Task 3 覆盖 FMS 后的两张卡片、右侧差值和响应式布局。
- Task 4 覆盖用户说明、自动验证和人工访问性验证。
- 初始不得写入冠军数值：尚未逐项得到可验证的冠军参考；页面应如实显示待配置。
