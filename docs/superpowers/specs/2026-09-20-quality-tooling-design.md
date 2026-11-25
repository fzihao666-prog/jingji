# 前端质量工具链设计

## 目标

为当前 Vite + React + TypeScript 项目建立可在本地稳定执行的代码规范、单元测试和组件状态验证能力。现有训练业务统计、权限、算法和 API 行为不在本次配置范围内。

## 已确认现状

- 使用 npm（`package-lock.json`）和 Vite + React。
- `package.json` 已新增 ESLint、Stylelint 与 Vitest 脚本，但 ESLint 配置、Vitest 依赖和测试文件尚不存在。
- `stylelint.config.js` 已存在，可继续使用。
- `vite.config.ts` 是 Vite 配置的唯一入口。
- 当前没有 Storybook 配置、依赖或 stories。
- `visual-check` 是既有脚本，必须保留。

## 范围与顺序

### 第一阶段：ESLint 与 Stylelint

- 保留并校正现有脚本，恢复 `visual-check`。
- 新增 ESLint Flat Config，覆盖 `src/`、`server/`、`shared/`、`scripts/` 中的 TypeScript/TSX。
- 检查 TypeScript 基础问题、React Hooks、JSX 无障碍和显式不安全 API；不将格式化规则与 Prettier 重复配置。
- 继续以现有 Stylelint 配置检查 `src/**/*.css`。
- 第一轮发现的存量问题应逐项修复或有范围明确的临时豁免，不能静默关闭整类规则。

### 第二阶段：Vitest

- 将 Vitest 的 `test` 配置合并到 `vite.config.ts`，避免别名或插件配置分叉。
- 纯领域逻辑使用 Node 环境；暂不增加 DOM、浏览器或端到端测试环境。
- 首批测试覆盖训练数据聚合、缺失值展示、项目代码规范化等纯逻辑；不以 mock 替代真实领域函数。
- 保留既有 `api-check` 为服务端集成验证，工具接入不得改变其业务断言。

### 第三阶段：Storybook

- 在前两阶段稳定后接入与已安装 React/Vite 版本兼容的 Storybook。
- 使用 `.storybook/main.ts` 与 `.storybook/preview.tsx` 统一管理配置和全局 Provider。
- 先为训练情况等可复用展示组件编写默认、缺失数据、边界数值及关键交互故事。
- 启用 a11y 检查；Storybook 测试与普通 Vitest 测试分开运行，避免增加基础单元测试的运行成本。

## 依赖与边界

- 新增依赖必须先完成许可证、维护情况、安装脚本与依赖树审查。
- 不修改训练负荷、sRPE、专项统计、权限、API 合同或数据库结构。
- 不修改 CI、锁文件以外的敏感配置；依赖安装产生的锁文件变更仅限本次新增工具。

## 验收标准

1. `npm run lint`、`npm run lint:styles` 能在项目根目录执行。
2. `npm run test` 至少运行一组有业务价值的纯逻辑测试。
3. `npm run check` 与 `npm run build` 保持通过。
4. 既有 `visual-check`、`api-check` 等脚本不丢失。
5. Storybook 接入后，`npm run storybook` 与 `npm run build-storybook` 可执行，并至少含一组可复用组件故事。
6. 各阶段失败都能定位到具体规则、测试或故事，而非被全局忽略。
