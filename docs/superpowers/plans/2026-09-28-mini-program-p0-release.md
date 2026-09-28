# 微信小程序 P0 上线修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让提交的小程序默认使用生产 HTTPS API，并阻断注册审核关闭造成的匿名跨队伍教练开户。

**Architecture:** 小程序配置保持唯一生产 HTTPS origin，由单元测试锁定。注册审核开关收敛为 DMD 专属；审核关闭只可自动激活运动员，教练仍进入现有 pending 审核路径，复用既有审核人项目/队伍范围校验。

**Tech Stack:** 原生微信小程序 JavaScript、Express、TypeScript、SQLite、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-28-mini-program-p0-release-design.md`

## Global Constraints

- 不新增依赖、不读取或提交 `.env`、JWT 密钥或生产数据。
- 生产 API 必须为唯一 HTTPS origin，`NETWORK_DEBUG=false`。
- 所有授权均由服务端拒绝优先执行；客户端状态只用于展示。
- 不修改真实生产 Nginx、证书或微信公众平台设置；以真机验收确认。
- 使用 npm 与现有 package-lock.json；新增行为先写 Vitest 回归。

## Review Focus

- 非 DMD 管理角色修改全局审核开关时必须得到 403（Task 2）。
- 关闭审核后 ATL 自动开通、SCC 保持 pending 的分支必须不互相倒置（Task 2）。
- DMD 开关审核后，已有 pending 教练申请仍须通过项目/队伍范围校验才能批准（Task 2）。
- 默认提交配置不得回退为 `127.0.0.1` 或启用网络追踪（Task 1）。
- `api-check` 加载小程序作用域时必须显式允许 `project-label`，而非放宽任意依赖（Task 3）。

---

### Task 1: 锁定生产小程序配置

**Files:**
- Modify: `WeChat Mini Program/config.js:1-6`
- Modify: `WeChat Mini Program/config.test.js:1-23`

**Interfaces:**
- Consumes: `resolveApiBaseUrl(environment, productionBaseUrl?)`。
- Produces: 默认 `API_ENVIRONMENT === 'production'` 且 `getApiBaseUrl()` 返回 HTTPS 地址。

- [ ] **Step 1: 写入失败测试**

在 `config.test.js` 增加/调整断言：默认环境为 production、网络追踪为 false，且 `getApiBaseUrl()` 以 `https://` 开头。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- "WeChat Mini Program/config.test.js"`

Expected: 默认环境断言失败，实际为 development。

- [ ] **Step 3: 修改 `config.js` 默认发布环境**

将 `API_ENVIRONMENT` 设为 `production`；保留既有 HTTPS 地址校验和 `NETWORK_DEBUG=false`。

- [ ] **Step 4: 运行配置测试确认通过**

Run: `npm test -- "WeChat Mini Program/config.test.js"`

Expected: PASS。

### Task 2: 收紧注册审核与自动激活

**Files:**
- Modify: `server/access/access-routes.ts:106-135`
- Modify: `server/access/auth-routes.ts:182-304`
- Create or modify: `server/__tests__/registration-approval.test.ts`

**Interfaces:**
- Consumes: `registrationApprovalEnabled()`、`activateRegistrationRequest(requestId, reviewer)`、`requireRole()`。
- Produces: 审核开关仅 DMD 可写；关闭审核时 ATL 返回 `approved`，SCC 返回 `pending`。

- [ ] **Step 1: 写入失败的路由回归测试**

新增测试，断言 SCC 请求 `PUT /api/admin/registrations/approval` 得到 403；DMD 可更新；审核关闭的匿名 ATL 注册得到 `status: approved`，同条件 SCC 注册得到 `status: pending` 且不能登录。

- [ ] **Step 2: 运行注册回归测试确认失败**

Run: `npm test -- "server/__tests__/registration-approval.test.ts"`

Expected: SCC 能改开关、SCC 自动激活的断言失败。

- [ ] **Step 3: 修改审核开关角色与注册自动激活分支**

将审核开关接口改为 `requireRole('DMD')`；在 `/api/auth/register` 中仅当审核关闭且申请角色是 ATL 时调用自动激活，其他成功申请统一返回 pending 文案和状态。

- [ ] **Step 4: 运行注册回归测试确认通过**

Run: `npm test -- "server/__tests__/registration-approval.test.ts"`

Expected: PASS。

### Task 3: 恢复 API 回归门禁

**Files:**
- Modify: `scripts/coach-daily-todos-mini-check.mjs:80-108`
- Test: `scripts/api-check.mjs`

**Interfaces:**
- Consumes: 小程序 `utils/page-scope.js` 的直接依赖集合。
- Produces: 受限 mock loader 显式加载 `./project-label`，其他未预期依赖仍抛错。

- [ ] **Step 1: 运行 API 检查确认失败**

Run: `npm run api-check`

Expected: FAIL，错误为 `未预期依赖：./project-label`。

- [ ] **Step 2: 更新精确 mock 依赖映射**

为 `./project-label` 增加最小 mock，保留未知依赖的拒绝逻辑。

- [ ] **Step 3: 运行 API 检查确认通过**

Run: `npm run api-check`

Expected: PASS。

### Task 4: 全量验证与上线交接

**Files:**
- Verify only: `WeChat Mini Program/`, `server/`, `scripts/`

**Interfaces:**
- Consumes: Tasks 1–3 的配置和授权行为。
- Produces: 可发布的代码门禁结果，以及需由运营完成的外部验收清单。

- [ ] **Step 1: 运行静态和测试检查**

Run: `npm run mini:typecheck && npm test -- "WeChat Mini Program" && npm run api-check && npm run check && npm run lint`

Expected: 全部 PASS。

- [ ] **Step 2: 审阅差异与外部上线项**

确认没有变更密钥、生产数据库或无关文件；列出服务器 TLS、正式 AppID、request/uploadFile/downloadFile 合法域名、隐私主体资料和 Wi-Fi/移动网络真机测试，标记为人工必验。

## Self-review

- Spec coverage: Task 1 覆盖生产配置；Task 2 覆盖审核越权和兼容响应；Task 3 覆盖失效门禁；Task 4 覆盖验证与外部边界。
- Step scan: 每项均含可观察的 RED/GREEN 或验证结果，无未决定的实现步骤。
- Type consistency: 只复用现有路由、中间件和 activation 服务，未引入新接口类型。
- Review focus: 五个高风险分支均由 Task 1–3 的明确测试覆盖。
- Proportion: 计划只记录接口与测试决策，不复制实现代码。
