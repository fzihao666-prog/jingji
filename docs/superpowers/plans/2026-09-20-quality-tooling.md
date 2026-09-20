# 前端质量工具链 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可执行的 lint、纯逻辑单元测试和组件故事验证，并保留现有业务检查入口。

**Architecture:** ESLint Flat Config 作为 TypeScript/React 静态检查入口，复用现有 Stylelint 配置处理 CSS。Vitest 的配置合并到 Vite 配置中，首批测试只覆盖无环境依赖的领域函数。Storybook 作为独立的组件状态目录和 a11y 检查入口，在基础检查稳定后接入。

**Tech Stack:** npm、TypeScript、Vite、React、ESLint、Stylelint、Vitest、Storybook。

**Spec:** `docs/superpowers/specs/2026-09-20-quality-tooling-design.md`

## Global Constraints

- 不修改训练负荷、sRPE、专项统计、权限、API 合同或数据库结构。
- 新增依赖先经依赖审查；锁文件变更只包含本次获批工具的解析结果。
- 保留 `visual-check`、`api-check` 和所有既有检查脚本。
- 不使用 `any`；测试只验证真实的纯领域函数。
- 先运行定向检查，再运行 `npm run check` 与 `npm run build`。

## Review Focus

- ESLint 忽略 `dist`、`coverage` 和 `node_modules`，但不能忽略 `server`、`shared` 或 `scripts` 源码。
- `normalizeProject` 的中文项目别名与项目代码仍返回已有的受限 `Project` 值，未知值返回 `null`。
- 训练状态差异在任一输入缺失、团队均值为零时不产生虚假的差值百分比。
- Storybook 的无数据状态不得把缺失指标渲染为 `0`。
- `package.json` 中已有的 `visual-check` 继续可被 npm 运行。

## 文件结构

- `package.json`：保留既有脚本，增加或校正质量工具命令和开发依赖。
- `package-lock.json`：仅记录获批依赖的确定版本。
- `eslint.config.js`：Flat Config，集中定义源代码静态检查范围和规则。
- `vite.config.ts`：复用 Vite 插件和别名设置，增加 Vitest 配置。
- `vitest.config.ts`：仅为 Storybook 浏览器项目合并 Vite 配置。
- `shared/projects.test.ts`：项目规范化的纯逻辑测试。
- `server/athlete-profile-service.ts`：仅在需要导出纯训练状态计算函数时做最小提取；不得改变接口逻辑。
- `server/athlete-profile-service.test.ts`：缺失值和团队均值为零的训练状态差异测试。
- `.storybook/main.ts`、`.storybook/preview.tsx`：Storybook 的 Vite、故事扫描、a11y 和全局样式配置。
- `.storybook/vitest.setup.ts`：Storybook 浏览器测试初始化。
- `src/components/ProfileTrainingStatus.stories.tsx`：训练情况组件的默认、缺失数据和边界状态。

### Task 1: 审查并锁定开发依赖

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: npm 的 `package-lock.json` 与当前 `package.json` 中的 Vite、React、ESLint 版本。
- Produces: 经过审查、与现有版本兼容的 ESLint、Vitest 与 Storybook 开发依赖集合。

- [ ] **Step 1: 审查候选依赖**

审查 `@eslint/js`、`typescript-eslint`、`eslint-plugin-react-hooks`、`eslint-plugin-jsx-a11y`、`vitest`、`@vitest/coverage-v8`、`storybook`、`@storybook/react-vite`、`@storybook/addon-a11y`、`@storybook/addon-vitest`、`@vitest/browser-playwright` 的许可证、安装脚本、维护状态、大小和与 Vite/React 的兼容性。只有审查通过的包可安装。

- [ ] **Step 2: 保留既有脚本并写入工具脚本**

在 `scripts` 中保留：

```json
"visual-check": "node scripts/visual-check.mjs"
```

并保留以下质量命令：

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"lint:styles": "stylelint \"src/**/*.css\"",
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: 安装经审查的第一阶段依赖**

使用 npm 写入 ESLint 和 Vitest 所需开发依赖；只在第三阶段再安装 Storybook 依赖。

Run: `npm install --save-dev <approved-eslint-and-vitest-packages>`

Expected: `package.json` 与 `package-lock.json` 仅包含审查通过的依赖变更。

- [ ] **Step 4: 验证脚本可解析**

Run: `npm run lint -- --help && npm run test -- --help`

Expected: 两个命令均由对应工具响应，不出现 `command not found`。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lint and test tooling"
```

### Task 2: 配置 ESLint 与保留 Stylelint 边界

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json`
- Modify: `stylelint.config.js`（仅当实际检查结果要求最小兼容调整时）

**Interfaces:**
- Consumes: Task 1 安装的 ESLint 依赖，以及 `eslint-config-prettier`。
- Produces: `npm run lint` 可检查 `src`、`server`、`shared`、`scripts` 的 TS/TSX；`npm run lint:styles` 继续只检查 CSS。

- [ ] **Step 1: 写入 Flat Config**

创建 `eslint.config.js`，忽略下列生成或依赖目录，并为业务源码开启规则：

```js
ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'data/**', 'tmp/**']
```

TypeScript/TSX 规则至少包含 `@typescript-eslint/no-explicit-any: 'error'`、`@typescript-eslint/ban-ts-comment`（仅允许带说明的 `@ts-expect-error`）、`react-hooks/rules-of-hooks: 'error'`、`react-hooks/exhaustive-deps: 'warn'`、`jsx-a11y` recommended、`no-eval: 'error'`、`no-implied-eval: 'error'` 和 `react/no-danger: 'error'`。最后应用 Prettier 兼容配置。

- [ ] **Step 2: 运行静态检查并分类首轮结果**

Run: `npm run lint`

Expected: 输出逐文件问题；不得通过关闭整个源码目录或推荐规则集来获得通过。

- [ ] **Step 3: 修复本次配置直接暴露的可安全修复项**

只修复明确的格式、无效导入、废弃注释或危险 API 规则问题。对大规模历史规则债务，在 ESLint 配置中按规则并附理由做临时降级，不修改业务算法。

- [ ] **Step 4: 验证 CSS 检查**

Run: `npm run lint:styles`

Expected: 仅扫描 `src/**/*.css`；不扫描构建产物或数据目录。

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js stylelint.config.js package.json src server shared scripts
git commit -m "chore: configure source linting"
```

### Task 3: 接入 Vitest 并覆盖稳定领域函数

**Files:**
- Modify: `vite.config.ts`
- Create: `shared/projects.test.ts`
- Modify: `server/athlete-profile-service.ts`（仅最小导出纯函数时）
- Create: `server/athlete-profile-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `vitest` 和当前 `normalizeProject(value: unknown): Project | null`。
- Produces: `npm run test` 在 Node 环境下运行纯逻辑测试；不启动 Express、不读取生产数据。

- [ ] **Step 1: 写入项目代码规范化测试**

创建 `shared/projects.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { normalizeProject } from './projects.js';

describe('normalizeProject', () => {
  it('将赛艇中文名称规范为 ROWING', () => {
    expect(normalizeProject('赛艇')).toBe('ROWING');
  });

  it('拒绝未知项目', () => {
    expect(normalizeProject('未知项目')).toBeNull();
  });
});
```

此测试验证已有逻辑；它不伴随生产行为变更，因此不伪造“先失败”的 TDD 循环。

- [ ] **Step 2: 在 Vite 配置中增加 Node 测试项目**

在 `vite.config.ts` 的 `defineConfig` 返回值中增加：

```ts
test: {
  environment: 'node',
  include: ['shared/**/*.test.ts', 'server/**/*.test.ts'],
  restoreMocks: true,
},
```

- [ ] **Step 3: 运行规范化测试并确认通过**

Run: `npm run test -- shared/projects.test.ts`

Expected: 两个断言通过，证明测试执行的是现有项目白名单规范化函数。

- [ ] **Step 4: 为训练状态差异提取可测试纯函数并先写失败测试**

仅当 `trainingStatusMetric` 不能被测试导入时，将其以明确的输入/输出类型导出；测试应固定下列行为：个人 `null` 或团队均值 `null` 时 `difference` 与 `differencePercent` 为 `null`；团队均值为 `0` 时差异率为 `null`。

```ts
expect(
  trainingStatusMetric({
    key: 'duration', label: '训练时长', unit: '分钟', personalValue: null, teamValues: [10, 14],
  }).difference
).toBeNull();
expect(
  trainingStatusMetric({
    key: 'load', label: '训练负荷', unit: 'AU', personalValue: 12, teamValues: [0, 0],
  }).differencePercent
).toBeNull();
```

Run: `npm run test -- server/athlete-profile-service.test.ts`

Expected: 在导出该纯函数前，测试因“模块不导出 `trainingStatusMetric`”失败。

- [ ] **Step 5: 以最小变更导出纯函数并验证定向测试**

导出 `trainingStatusMetric`，不改变其实现或调用方；再次运行上一步命令。

Expected: 缺失值与零均值的断言通过。

- [ ] **Step 6: 运行定向测试和完整单元测试**

Run: `npm run test -- shared/projects.test.ts server/athlete-profile-service.test.ts && npm run test`

Expected: 定向与完整 Vitest 测试均通过。

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts shared/projects.test.ts server/athlete-profile-service.ts server/athlete-profile-service.test.ts
git commit -m "test: cover project and training status metrics"
```

### Task 4: 接入 Storybook 并为训练情况组件建立状态覆盖

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `.storybook/main.ts`
- Create: `.storybook/preview.tsx`
- Create: `.storybook/vitest.setup.ts`
- Create: `src/components/ProfileTrainingStatus.stories.tsx`

**Interfaces:**
- Consumes: Task 1 审查通过的 Storybook 依赖、`ProfileTrainingStatus` 组件及其公开 Props。
- Produces: `npm run storybook` 可浏览故事，`npm run build-storybook` 可构建静态目录，`npm run test:storybook` 可在 Chromium 中执行 stories。

- [ ] **Step 1: 安装审查通过的 Storybook 依赖并增加脚本**

增加：

```json
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build",
"test:storybook": "vitest run --project storybook"
```

使用与 Task 1 审查结论一致的兼容版本安装 Storybook、React Vite 框架适配器、a11y addon、Vitest addon 与 Playwright 浏览器 provider。

- [ ] **Step 2: 创建 Storybook 主配置**

` .storybook/main.ts` 扫描 `src/**/*.stories.@(ts|tsx)`，指定 React Vite framework，并添加 `@storybook/addon-a11y`；不复制 Vite 服务器代理或 Express 配置。

- [ ] **Step 3: 创建全局预览配置**

`.storybook/preview.tsx` 导入现有全局样式，设置合理的默认布局；若组件需要 Provider，则仅在此提供统一 decorator。

- [ ] **Step 4: 增加 Storybook Vitest 浏览器项目**

创建 `vitest.config.ts`，合并 `vite.config.ts`，并将 `@storybook/addon-vitest/vitest-plugin` 配置为名为 `storybook` 的项目；用 `@vitest/browser-playwright` 在无头 Chromium 执行，`configDir` 指向 `.storybook`，初始化文件为 `.storybook/vitest.setup.ts`。`storybookScript` 使用 npm 脚本：

```ts
storybookScript: 'npm run storybook -- --no-open'
```

- [ ] **Step 5: 创建训练情况组件故事**

在 `ProfileTrainingStatus.stories.tsx` 使用组件真实 Props 创建三种状态：完整个人/团队对照、个人或团队缺失数据、团队均值为零。缺失状态断言可见“暂无数据”或 “--”，不得显示 `0` 作为替代值。

- [ ] **Step 6: 构建、执行故事测试并人工检查 a11y 结果**

Run: `npm run build-storybook && npm run test:storybook`

Expected: Storybook 构建和 Chromium stories 测试成功；a11y addon 已注册，严重问题不能被全局禁用。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .storybook src/components/ProfileTrainingStatus.stories.tsx
git commit -m "chore: add training status stories"
```

### Task 5: 完整验证与工具回归

**Files:**
- Modify: 仅修复前四个任务直接导致的配置或测试问题；不得重写业务实现。

**Interfaces:**
- Consumes: Task 1–4 产物。
- Produces: 可复现的本地质量检查序列及诚实的失败报告。

- [ ] **Step 1: 运行格式、静态检查和单元测试**

Run: `npm run format:check && npm run lint && npm run lint:styles && npm run test`

Expected: 所有命令通过；若发现存量失败，记录具体文件、规则和不修改它的原因。

- [ ] **Step 2: 运行类型与构建检查**

Run: `npm run check && npm run build && npm run build-storybook`

Expected: TypeScript、Vite 和 Storybook 构建均成功。

- [ ] **Step 3: 回归既有验证入口**

Run: `npm run visual-check && npm run api-check`

Expected: `visual-check` 命令存在并运行；`api-check` 若仍因已知训练总览数据完整性问题失败，报告该失败位置，不通过修改工具配置掩盖它。

- [ ] **Step 4: 检查变更边界**

Run: `git diff --check && git status --short`

Expected: 无空白错误；没有训练算法、权限、数据库结构或无关业务文件改动。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json eslint.config.js vite.config.ts stylelint.config.js .storybook shared server src/components
git commit -m "chore: verify quality tooling"
```
