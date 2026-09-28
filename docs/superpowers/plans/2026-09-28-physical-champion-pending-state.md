# 体能训练冠军模型待填充状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不写入任何冠军参考值的前提下，将体能训练页冠军模型区域升级为可解释的待填充状态，并保留真实团队或个人测试值。

**Architecture:** 保持现有 `StrengthTrainingDashboard` 的全局项目、周期和运动员筛选，以及现有真实测试聚合逻辑。冠军模型卡片只展示项目、模式、参考状态和当前真实测试摘要；所有依赖冠军参考值的雷达、差距、成员对比、矩阵与趋势统一显示明确的待参考状态，不生成虚假的零值、差距或达成度。

**Tech Stack:** React、TypeScript strict、现有 `ChartCard`/`ContentState`、CSS。

**Spec:** 用户消息“体能训练｜冠军模型增强 SPEC”；后续确认：六个冠军参考维度全部待填充。

## Global Constraints

- 不写入、推算或展示冠军参考数值。
- 缺失冠军参考时使用“待填充/待专家确认”，不以 0、队伍均值或个人目标替代。
- 保留当前项目、周期和运动员筛选；个人模式保留真实个人测试值，团队模式保留真实团队均值。
- 不新增依赖，不改动数据库、API、权限或现有真实测试筛选规则。
- 图表和数据区域必须提供可读文本状态，颜色不能是唯一信息载体。

## Review Focus

- 个人模式与团队模式的标题和真实数值范围不得混淆。
- 冠军参考缺失时不得出现百分比、差值或默认零值。
- 空测试数据与“有测试但无冠军参考”必须有不同的说明。
- 窄屏下指标行必须保持可读，不裁切状态文字。
- 不得改变现有训练计划入口或体能训练其余模块。

### Task 1: 冠军模型待填充主卡片

**Files:**
- Modify: `src/pages/TrainingDashboards.tsx`
- Modify: `src/pages/SpecialTrainingPage.css`

**Interfaces:**
- 将 `PhysicalChampionModelPlaceholder` 保持为页面私有组件；输入继续为项目、当前范围标签和真实指标。
- 主卡片输出六个既有体能维度的“待填充”状态与最多六项当前真实指标，不输出冠军值、差值或达成度。

- [ ] **Step 1: 写出视觉状态验收清单**

记录团队有数据、个人有数据、没有测试数据三种状态的预期文本；每种状态都不包含数值化冠军比较。

- [ ] **Step 2: 修改主卡片标记**

将标题说明改为“冠军参考待填充”；使用语义化标题、列表和状态文本展示项目、模式、参考状态与真实数据摘要。

- [ ] **Step 3: 添加最小 CSS**

在既有冠军卡片样式旁新增待填充信息、指标网格和响应式规则；复用已有色彩变量，不添加内联样式或新视觉依赖。

- [ ] **Step 4: 运行类型和静态检查**

Run: `npm run check && npm run lint`

Expected: 两个命令退出码均为 `0`。

### Task 2: 依赖参考值的分析区域

**Files:**
- Modify: `src/pages/TrainingDashboards.tsx`

**Interfaces:**
- 在冠军模型主卡片下增加一个语义化“冠军对标分析”区域。
- 仅当正式冠军来源和值存在时才允许渲染雷达、差距、成员目标图、矩阵和趋势；本次固定渲染待参考说明，不计算任何比较数据。

- [ ] **Step 1: 写出状态验收清单**

确认状态文本逐项说明雷达、差距分析、成员对比、能力矩阵、趋势均等待参考标准，而非缺少运动员测试。

- [ ] **Step 2: 实现待参考分析区**

使用 `SectionHeader`、`ChartCard` 与 `ContentState` 组织不超过一个紧凑区域；文本说明启用条件和当前真实测试数据仍在页面下方现有模块中展示。

- [ ] **Step 3: 人工无障碍核查**

确认标题层级连续、无互动元素不使用伪按钮、状态信息不只依赖颜色，并在 760px 断点检查文字可读性。

- [ ] **Step 4: 运行类型和静态检查**

Run: `npm run check && npm run lint`

Expected: 两个命令退出码均为 `0`。

### Task 3: 用户文档与完整验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新体能训练说明**

明确冠军参考值未配置时的页面行为：不显示冠军标准、差距、达成度、目标对比、矩阵或趋势；缺失不补零。

- [ ] **Step 2: 执行影响范围验证**

Run: `npm run check && npm run lint && npm test && npm run build`

Expected: 每个命令退出码为 `0`。

- [ ] **Step 3: 执行手工页面检查**

打开体能训练页，检查团队、选中运动员和无测试数据状态；验证训练计划入口仍可用。

