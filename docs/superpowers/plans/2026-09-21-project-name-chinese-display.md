# 运动项目中文展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有前端页面将项目代码统一渲染为中文名称，同时保持接口与筛选值为项目代码。

**Architecture:** `shared/projects.ts` 已提供 `projectLabel`，作为唯一展示映射。页面仅在 JSX 文本和 option 文本边界调用该函数，不改变 `project` 的状态、比较、请求参数或 key。

**Tech Stack:** TypeScript、React、Vite、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-21-project-name-chinese-display-design.md`

## Global Constraints

- 数据、权限、查询和表单提交继续使用项目代码。
- 不新增依赖、不修改服务端或数据库。
- 未知或历史中文值由 `projectLabel` 原样回退。

## Review Focus

- 项目下拉框文本为中文，但 option value 仍为代码。
- 项目代码用于数组比较、请求参数和 React key 时不得被中文替换。
- 运动员、教练、队伍与个人档案的组合信息中项目名为中文。
- 标题、说明与空状态中的项目名为中文。
- 项目代码不在用户可见的前端文本中出现。

---

### Task 1: 验证共享项目展示映射

**Files:**
- Modify: `shared/projects.test.ts`
- Modify: `shared/projects.ts`（仅在测试发现缺口时）

**Interfaces:**
- Consumes: `projectLabel(project: Project | string): string`
- Produces: 已验证的中文展示映射与未知值回退。

- [ ] **Step 1: 添加失败测试**

```ts
expect(projectLabel('ROWING')).toBe('赛艇');
expect(projectLabel('CANOE_SPRINT')).toBe('皮划艇');
expect(projectLabel('历史项目')).toBe('历史项目');
```

- [ ] **Step 2: 运行测试确认映射行为**

Run: `npm test -- shared/projects.test.ts`

- [ ] **Step 3: 仅在必要时补齐映射实现**

保持 `projectLabel` 以 `PROJECT_DEFINITIONS.nameZh` 映射代码、以原字符串回退未知值。

- [ ] **Step 4: 再次运行测试**

Run: `npm test -- shared/projects.test.ts`

### Task 2: 替换全站前端可见项目文本

**Files:**
- Modify: `src/components/DateToolbar.tsx`, `ProjectMark.tsx`, `AthleteProfileCharts.tsx`, `StrengthProfileModule.tsx`, `SpecialDataImportDialog.tsx`, `SpecialPerformancePanel.tsx`
- Modify: `src/pages/AccountsPage.tsx`, `AthleteManagementPage.tsx`, `CoachManagementPage.tsx`, `DataImportPage.tsx`, `LoginPage.tsx`, `OverviewPage.tsx`, `PersonalPage.tsx`, `PhysiologyBiochemistryPage.tsx`, `RegionAccessPage.tsx`, `RosterPage.tsx`, `SpecialTestsPage.tsx`, `TeamsPage.tsx`, `TrainingDashboards.tsx`, `TrainingPlanPage.tsx`

**Interfaces:**
- Consumes: `projectLabel` from `shared/projects.ts`.
- Produces: 中文可见文本，保留原始项目代码作为值、条件判断、请求参数和 key。

- [ ] **Step 1: 在每个文件引入 `projectLabel`**

```ts
import { projectLabel } from '../../shared/projects';
```

按文件相对路径调整导入层级；已有 `shared/projects` 导入时合并到同一语句。

- [ ] **Step 2: 修改纯展示边界**

```tsx
<strong>{projectLabel(athlete.project)}</strong>
<span>{projectLabel(project)} · {team}</span>
<option key={project} value={project}>{projectLabel(project)}</option>
```

- [ ] **Step 3: 保留逻辑代码值**

```ts
const teams = allTeams.filter((team) => team.project === project);
api.createTeam(project, name);
```

不得将以上逻辑改为中文名称。

- [ ] **Step 4: 搜索并复查展示遗漏**

Run: `rg -n "\\{[^}]*\\.project[^}]*\\}|\\{project\\}" src --glob '*.tsx'`

逐项确认剩余命中是非可见逻辑、属性值，或已被 `projectLabel` 包装。

### Task 3: 更新说明并验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在功能说明中补充展示规则**

说明项目代码用于内部数据与权限，网页展示统一使用中文名称。

- [ ] **Step 2: 运行验证**

Run: `npm test -- shared/projects.test.ts && npm run check && npm run lint && npm run build`

- [ ] **Step 3: 人工页面回归**

使用项目筛选、运动员列表、队伍目录、个人档案和训练页确认中文显示，确认筛选后的请求仍携带代码值。
