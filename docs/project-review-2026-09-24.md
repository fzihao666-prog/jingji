# 竞迹项目整体复核与小程序专项分析

> 复核基准：2026-09-24，分支 `dev`，工作区含**未提交改动**。以源码为准；与 `README.md`、`docs/mini-program-analysis.md`、`docs/mini-program-optimization-plan.md` 不一致处已在文中标注。

---

## 0. 结论先行

| 维度 | 判断 |
| --- | --- |
| 产品定位 | 清晰。竞迹＝赛艇/皮划艇训练监控平台，Web 端做重分析与批量处理，小程序做现场查看与填报，两端共用一套 API 与数据库，未建第二套事实源。设计正确。 |
| 服务端与权限 | 扎实。角色 × 行政区域 × 项目 × 队伍的过滤在服务端完成，`hasAthleteAccess` 覆盖写接口，页面隐藏不作为授权依据。 |
| 小程序工程质量 | 高于同类原生小程序平均水平：单一 API 门面、单一请求层、过期响应防护、网络失败分类、边界校验 + 44 个单测全绿。 |
| **当前最大风险** | **工作区服务端重构中断，项目跑不起来**（见 §1），且**小程序训练填报接口在服务端不存在**（见 §4.3）。二者都不是小程序自身代码问题，但直接阻断联调与发版。 |

---

## 1. 项目全景

### 1.1 形态

```text
React 网页端（Vite + React 19 + TS strict）  ─┐
                                              ├─ Express /api ─ better-sqlite3（data/training-monitor.db）
微信小程序（原生 WXML/WXSS/JS，无框架无构建）─┘
```

### 1.2 规模（不含 node_modules、dist）

| 部分 | 规模 | 说明 |
| --- | --- | --- |
| `server/` | 20,327 行 TS | `index.ts` 8,218 行（路由与业务高度集中）、`db.ts` 5,785 行（建表与幂等迁移）、`data-import.ts` 2,657 行 |
| `shared/` | 2,597 行 | 前后端共用领域定义、项目/区域/权限模型、冠军模型参数 |
| `src/`（Web） | 26,044 行 TSX/TS | 16 个页面 + 30 个组件，ECharts 图表，AI 方案生成，PDF/Excel 导出 |
| `WeChat Mini Program/` | 4,669 行（含 656 行字典）+ 444 行测试 | 10 页面 + 1 组件 + 1 服务层 + 8 工具，资源 1.3 MB |
| `scripts/` | 42 个脚本 | 类型/API/权限/计划/专项/体能定向检查 + 可视化回归 |

### 1.3 领域模型要点

- 五级六角色：ATL 运动员、SCC 队伍体能教练、PRJ 项目负责人、REG 区域负责人、TD 训练总监、DMD 数据监控总监。
- 账号同时绑定上级、行政区域（国/省/市/区县）、项目（赛艇/皮划艇/激流回旋）与队伍；权限判定统一走 `server/permissions.ts` 的 `accountPermissions → permissionsAllowAthlete` 与 `hasAthleteAccess`。
- 训练事实只写入 `training_sessions`、`daily_wellness`、`strength_result_sets`；演示数据以 `is_demo` / `quality` / `source` 标记隔离，正式统计排除。

### 1.4 ⚠️ 当前工作区状态（阻断级，优先于一切优化）

`git status`：`server/index.ts` 已修改，新增未跟踪的 `server/auth.ts`、`permissions.ts`、`shared-server.ts`、`utils.ts` —— 正在把 `index.ts` 中的鉴权、权限、类型与工具函数拆出去，**拆分未完成**：

1. `server/utils.ts:10` 与 `:44` 重复声明 `validatePersonName`，且 `:55 userById`、`:67 numberOrNull` 等未 `export`；
2. `npm run check` 报数十个 `TS2304 Cannot find name`：
   `STRENGTH_METRICS`、`canManageRole`、`accountCodeFor`、`trainingSessionBreakdown`、`formatServerNumber`、`SpecialTestImportRow`、`ROLE_META`、`ROLES`、`ROLE_HIERARCHY`、`AREA_LEVEL_META`；
3. 实测启动：`npx tsx server/index.ts` 直接抛
   `TransformError: server/utils.ts:44:9: The symbol "validatePersonName" has already been declared`，
   服务进程退出，8787 端口无监听。

**影响**：网页端、API、小程序联调目前全部不可用。建议先把 `index.ts` 的缺失 import 补齐（`utils.ts` 增加导出、`index.ts` 引入 `./utils.ts`、`./permissions.ts`、`./auth.ts`、`./shared-server.ts`），或 `git stash` 回到 HEAD 的可运行基线后再继续拆分。

---

## 2. 小程序定位与边界

| 边界内（一期） | 边界外（刻意不做，留 Web 端） |
| --- | --- |
| 账号密码登录、运动员/教练注册申请 | 微信 OpenID / 手机号一键登录 |
| 训练总览、专项、体能、档案只读视图 | 账号权限配置、区域授权、注册审核 |
| 本人档案编辑、身体成分、证件照 | 批量 Excel 导入导出、指标字典维护 |
| 本人训练课次增删改 | AI 草案生成、原始数据删除、复杂计划编辑 |

小程序 README 与 `docs/mini-program-analysis.md` 对边界的描述与代码一致，未发现越界实现。

---

## 3. 小程序架构

### 3.1 分层与依赖方向

```text
pages/*  →  services/api.js  →  utils/request.js  →  config.js
pages/*  →  utils/{context,page-scope,request-guard,date,format,daily-todos,profile-payload}
components/scope-filter（只做筛选交互，不含业务规则）
```

实测依赖方向干净：页面不直接调用 `wx.request`，utils 不反向依赖 pages（`utils/context.js` 依赖 `services/api` 属可接受方向）。

### 3.2 关键模块

| 模块 | 作用 | 评价 |
| --- | --- | --- |
| `config.js` | 环境切换、基址校验（生产强制 HTTPS）、storage key | 好。唯一环境出口，`resolveApiBaseUrl` 有断言 |
| `services/api.js` | 唯一 API 门面，20+ 方法，参数统一 encode | 好。页面不拼 URL |
| `utils/request.js` | `wx.request`/`wx.uploadFile` 封装、Bearer 头、401 清会话并 `reLaunch`、traceId 网络追踪（脱敏）、失败分类（连接重置/域名校验/TLS/超时） | 好。日志脱敏做得细（URL 数字段打码、只输出字段名不打值） |
| `utils/request-guard.js` | 请求序号，只让最新请求写 `setData` | 好。解决快速切项目/切 Tab 的响应串台 |
| `utils/context.js` | 装配 user + 项目 + 运动员列表，处理 pendingProject 与角色固定 | 好。逻辑略绕（7 层项目回退），建议加注释或收敛 |
| `utils/page-scope.js` | 项目/运动员/日周月三态切换与顺序化保存 `saveProjectInOrder` | 好。已消除各页复制粘贴的筛选样板 |
| `utils/daily-todos.js` | 待办响应**显式形状校验**后才生成可导航名单 | 好。原生环境没有 zod，这个边界校验是必要替代 |
| `utils/profile-payload.js` | 姓名长度/非法字符、日期补零与真实存在性校验 | 好。与服务端 `selfAthleteProfileSchema` 双层校验 |

### 3.3 页面与导航

`app.json`：10 个页面，底部 5 Tab（训练总览 / 专项训练 / 体能训练 / 档案 / 我的），登录为启动页；`profile-edit`、`training-entry`、`privacy` 为二级页；全局注册 `scope-filter`；`lazyCodeLoading: requiredComponents`；**未使用分包**。

数据流惯例统一：`onShow → loadContext() → createInitialScope() → loadWithGuard() → build*View() 纯函数 → WXML`，项目切换走 `applyScopeChange` + `saveProjectInOrder` + 重拉。五个主 Tab 已全部接入 `request-guard`（index/special/strength/profile 确认，mine 为本地态）。

---

## 4. 小程序契约核对（重点问题区）

### 4.1 已对齐的接口

`/api/auth/login`、`/api/auth/register`、`/api/auth/change-password`、`/api/me`、`/api/teams`、`/api/preferences/current-project`(GET/PUT)、`/api/athletes`、`/api/overview`、`/api/overview/teams`、`/api/coach/daily-todos`、`/api/special-training/overview`、`/api/special-champion-models`、`/api/strength-tests`、`/api/training-plans`、`/api/strength-training/results`、`/api/athletes/:id/{overview,injuries,champion-model,body-composition,photo}`、`/api/me/athlete-profile` —— 服务端均存在且带 `requireAuth`/`hasAthleteAccess`。

### 4.2 权限校验抽查

- `PUT /api/me/athlete-profile`（index.ts:2167）：仅 ATL 且必须 `hasAthleteAccess`，组织归属字段由服务端从库里重读覆盖，**小程序无法越权改项目/队伍/区域**——设计正确。
- `PUT /api/athletes/:id/body-composition`（index.ts:2949）：`hasAthleteAccess` + ATL 只能本人 + 逐字段合理区间校验。
- `GET /api/coach/daily-todos`（index.ts:5420）：`requireRole('SCC','PRJ','REG','TD','DMD')`，与小程序 `canViewTodos` 白名单一致。

### 4.3 ❌ 断链：训练填报接口服务端不存在

小程序 `services/api.js:33-41` 声明了 4 个方法：

```js
myTrainingSessions()            → GET    /api/me/training-sessions
createMyTrainingSession(data)   → POST   /api/me/training-sessions
updateMyTrainingSession(id,..)  → PUT    /api/me/training-sessions/:id
deleteMyTrainingSession(id)     → DELETE /api/me/training-sessions/:id
```

全仓库检索（含 `git show HEAD:server/index.ts`）确认：**服务端没有任何 `training-sessions` 路由**，HEAD 版本也没有。`pages/training-entry/training-entry.js` 因此必然 404，README 中「本人训练填报」这一已声明能力实际不可用。

需核实：该接口是否在其他分支/未合入提交中。若确认缺失，需按「服务端绑定登录账号的 athleteId、不接受客户端传运动员编号、仅限本人创建的手工记录可改删」补齐，并纳入 `npm run api-check`。

### 4.4 ⚠️ 时区口径不一致

- 小程序：`utils/date.js:9 periodFor()`、`pages/training-entry/training-entry.js:4 today()`、`pages/profile-edit/profile-edit.js:16 currentDate()` 都用**设备本地时区**的 `new Date()`。
- 服务端：每日待办与统计按 `Asia/Shanghai`（`daily-todos.js:12` 还把 `timezone === 'Asia/Shanghai'` 作为响应校验项）。

在东八区设备上看不出问题；一旦用户在境外或设备时区非 +8，「今天/本周/本月」与服务端待办会错位，出现「已填报仍显示未填报」。建议由服务端下发北京时间今日日期，或客户端统一按 +8 偏移计算。

---

## 5. 问题清单（按优先级）

### P0 — 阻断发版

| # | 问题 | 证据 | 处置 |
| --- | --- | --- | --- |
| 1 | 服务端重构中断，无法编译/启动 | `server/utils.ts:10` vs `:44`；`npm run check` 大量 TS2304；tsx 启动 TransformError | 补齐 `utils.ts` 导出与 `index.ts` 的 import，或先回到 HEAD 基线 |
| 2 | 训练填报接口断链 | `api.js:33-41` 有，服务端全仓库无 | 核实分支；缺失则补齐并纳入 api-check |
| 3 | 发布配置仍是开发态 | `config.js:2 API_ENVIRONMENT='development'`、`config.js:6 NETWORK_DEBUG=true` | 上传体验版前改 `production` + `false`；与 README「发布前必须保持 production」冲突 |

### P1 — 上线前必须处理

| # | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| 4 | 时区不一致（见 §4.4） | `date.js:9`、`training-entry.js:4`、`profile-edit.js:16` | 统一北京时间 |
| 5 | Tab 页 `onShow` 全量重拉 | `index.js:113`、`special.js:78`、`strength.js:113`、`profile.js:105` 每次切 Tab 都 `loadContext`（3 个请求）+ 业务请求 + 待办 | context 加 30–60s 缓存；`onShow` 节流或改为「首次 + 下拉 + 显式刷新」 |
| 6 | 未配置微信隐私授权 | 使用 `wx.chooseMedia`（`profile-edit.js:113`），但 `app.json` 无 `__usePrivacyCheck__`、无 `onNeedPrivacyAuthorization`、无 `wx.requirePrivacyAuthorize` | 小程序后台配置《用户隐私保护指引》并声明相册/摄像头，代码侧补隐私授权处理；**需核实最新平台政策** |
| 7 | 包体含 916 KB 资源且未分包 | `assets/olympic-sports/*.png` 50 张**无任何代码引用**（登录页用的是服务器远程 `.gif`）；`app.json` 无 `subPackages` | 删除未引用 PNG；登录装饰图改远程或按需；资源超阈值后再评估分包 |
| 8 | 登录页一次性加载 50 张远程 GIF | `login.js:4-58` `OLYMPIC_ICONS` 50 项全部渲染 | 收敛到 6–8 张轮播或单张背景，弱网首屏明显受益 |

### P2 — 体验与长期维护

| # | 问题 | 说明 |
| --- | --- | --- |
| 9 | 字典双份 | `data/register-data.js`（656 行）与 `shared/*` 靠 `register.test.js` 断言对齐；`utils/format.js` 指标字典同理。改 shared 必须同步，属结构性维护成本 |
| 10 | 无 TypeScript，大页偏大 | `register.js` 277 行、`index.js` 219 行。功能继续扩张前建议评估 TS 化 |
| 11 | 图表表达力有限 | `view` + 内联百分比柱条，无法承载 Web 端 ECharts 级分析。已在 README 声明边界，可接受，但不要向小程序追加复杂图表需求 |
| 12 | 隐私页与未成年人流程 | `pages/privacy` 为静态框架（`Page({})`），运营主体信息待补；注册收集身份证号，**不满 14 周岁需监护人授权流程**，需产品/法务确认 |
| 13 | `GET /api/teams` 无鉴权 | `index.ts:1511` 公开返回全部队伍，注册页依赖它。建议至少加限流，或评估是否收敛为「项目 + 队伍」最小化字段 |
| 14 | `redirecting` 模块级锁 | `request.js:4`，多请求并发 401 时串行重跳，行为可接受但会延迟 400ms；无需紧急处理 |

### 已做对、不需要改的

- 401 清会话 + `reLaunch` 且防重入；网络日志脱敏（不打 Token/密码/正文）。
- 待办响应做完整形状校验后才渲染，避免脏数据导致页面崩溃。
- 敏感字段脱敏（`maskIdentity` / `maskPhone`）、不缓存明细档案、不回填密码、组织归属不可从小程序修改。
- `sitemap.json` 全站 `disallow`，不会被微信索引。
- 44 个 Vitest 用例全部通过（10 个文件，covering config/request/request-guard/context/page-scope/daily-todos/profile-payload/network-error/register/profile-edit）。

---

## 6. 文档一致性

`docs/mini-program-analysis.md`（2026-09-23）与代码总体相符，但以下已过时，建议回写：

- §2 与 §8.2：写「首页用 `_pageRequest`/`_todoRequest` 序号」「筛选样板四页重复」——现已被 `utils/request-guard.js` 与 `utils/page-scope.js` 统一，不再成立。
- §3.2 页面清单未反映 `training-entry` 的接口断链。
- 建议把本次 §4.3、§4.4 与 §5 的 P0/P1 结论并入该文档，避免后续重复排查。

`docs/mini-program-optimization-plan.md`（2026-09-24）的 M0/M1/M2 分期仍然有效，但**M0「发布检查」当前无法执行**（P0-1 服务起不来），建议把「服务端可编译可启动」作为 M0 的前置条件显式写入。

---

## 7. 建议行动顺序

1. **恢复可运行**：修 `server/utils.ts` 重复声明与 `index.ts` 缺失 import → `npm run check` 绿 → `npm run start` 起得来。
2. **确认训练填报接口**：查分支历史确认是否遗漏；缺失则按既有权限约定补齐并加回归脚本。
3. **发布门禁**：`config.js` 改 `production` / `NETWORK_DEBUG=false`，核对合法域名三件套（request/uploadFile/downloadFile 同一 HTTPS 域名）、AppID 与备案、演示账户密码、`JWT_SECRET`。
4. **修 P1**：北京时间统一、Tab 刷新节流、微信隐私授权配置、清理未引用资源、登录页图片收敛。
5. **真机回归清单**：登录 → 总览 → 待办点选进档案 → 训练填报 → 档案编辑 → 照片上传与再打开；ATL/SCC/管理角色各一遍；断网、弱网、快速切项目、空数据、跨端抽样一致。
6. **回写文档**：`docs/mini-program-analysis.md` 与小程序 README。

---

## 8. 复核记录（2026-09-26）

复核方式：`git status` / `npm run check` / `npx tsx server/index.ts` 实起服务 + `curl` 探测 / `npx vitest run "WeChat Mini Program"` / `npm run api-check` / 关键文件重读。

### 8.1 状态总表

| # | 问题 | 上次（09-24） | 本次（09-26） | 判定证据 |
| --- | --- | --- | --- | --- |
| P0-1 | 服务端重构中断，不可编译/启动 | 阻断 | ✅ **已修复** | `server/` 拆为 `core`/`athlete`/`analysis`/`data-import`/`strength`/`training-plan`/`access`/`special` + `__tests__`；`npm run check` 无错误；`tsx server/index.ts` 正常监听；`/api/teams` 200、`/api/me` 401 |
| P0-2 | 训练填报接口断链 | 阻断 | ❌ **未修复** | 启动后实测 `GET /api/me/training-sessions` → **HTTP 404**；`server` 下 `/api/me/` 仅 `athlete-profile` 一条 |
| P0-3 | `config.js` 仍是开发态 | 阻断 | ❌ **未修复** | `config.js:2` 仍 `development`、`config.js:6` 仍 `NETWORK_DEBUG=true` |
| P1-4 | 客户端本地时区 ≠ 服务端北京时间 | 待修 | ❌ 未修复 | `utils/date.js:9` 仍用 `new Date()`；`training-entry.js:4`、`profile-edit.js:16` 同 |
| P1-5 | Tab 页 `onShow` 全量重拉 | 待修 | ❌ 未修复 | `pages/index/index.js:113` 仍 `onShow() { this.loadPage(); }`，无缓存/节流 |
| P1-6 | 未配置微信隐私授权 | 待修 | ❌ 未修复 | 全目录检索无 `__usePrivacyCheck__` / `requirePrivacyAuthorize`，但 `profile-edit.js:113` 仍用 `wx.chooseMedia` |
| P1-7 | 包体死资源、未分包 | 待修 | ❌ 未修复 | `assets` 仍 916 KB，`assets/olympic-sports/*.png` 无任何代码引用；`app.json` 无 `subPackages` |
| P1-8 | 登录页 50 张远程 GIF | 待修 | ❌ 未修复 | `login.js:4-58` `OLYMPIC_ICONS` 仍 50 项 |
| P2-9~14 | 字典双份 / 无 TS / 隐私页框架 / `/api/teams` 无鉴权 等 | 待修 | ❌ 未修复 | `data/register-data.js` 仍在；`GET /api/teams` 仍无鉴权（实测 200 无需 token） |
| 文档 | 回写 `mini-program-analysis.md` | 待办 | ❌ 未完成 | `git status` 中该文件无改动；`mini-program-optimization-plan.md` 有改动但未写入「服务端可启动」前置条件 |

### 8.2 本次新发现

**`npm run api-check` 直接崩溃（验证链断裂）**

```
TypeError: Cannot destructure property 'createInitialScope' of 'require(...)' as it is undefined.
    at checkMiniDailyTodoFlow (scripts/coach-daily-todos-mini-check.mjs:37:6)
    at scripts/api-check.mjs:101:9
```

原因：该脚本用 `vm` 加载小程序 `pages/index/index.js`，并手工构造 `modules` 桩映射（`coach-daily-todos-mini-check.mjs:17-35`），但只注册了 `format`、`daily-todos`、`services/api`、`context`、`date`；而 `index.js` 现在还 `require` 了 `../../utils/page-scope` 与 `../../utils/request-guard`，两者返回 `undefined` 导致解构失败。

影响：README「验证命令」中的 `npm run api-check` 当前跑不到任何断言，服务端重构后的接口回归实际处于**未验证**状态（本次 `# P0-1` 的"已修复"结论仅覆盖类型检查、启动与两个接口探测，不覆盖完整回归）。

修复方向（约 3 行，改动在 `scripts/coach-daily-todos-mini-check.mjs`）：补充两个桩——

```js
modules['../../utils/page-scope'] = { createInitialScope: (c) => c, applyScopeChange: () => null, saveProjectInOrder: (_p, _v, save) => save(_v) };
modules['../../utils/request-guard'] = { createRequestGuard: () => ({ next: () => 1, isLatest: () => true }), loadWithGuard: async (_page, _g, task) => { await task(() => true); } };
```

### 8.3 仍然成立的好消息

- 小程序 44 个 Vitest 用例仍然全绿（10 个文件）。
- 服务端重构未破坏小程序依赖的既有接口：`/api/teams` 200、`/api/me` 401（鉴权生效）、`/api/me/athlete-profile` 路由保留在 `server/athlete/athlete-routes.ts:46`。
- 服务端新增 `server/__tests__/` 与目录化模块，`index.ts` 从 8,218 行的巨型文件收敛为装配层，可维护性实质改善。

### 8.4 下一步建议（按阻断程度）

1. 修 `scripts/coach-daily-todos-mini-check.mjs` 的两个桩 → 让 `npm run api-check` 能跑完，确认重构无接口回归。
2. 补齐 `/api/me/training-sessions`（GET/POST/PUT/DELETE）：服务端绑定登录账号的 `athleteId`、不接受客户端传运动员编号、仅本人创建的手工记录可改删，并纳入 `api-check`。
3. 发版前 `config.js` 改 `production` + `NETWORK_DEBUG=false`，核对合法域名三件套与 AppID/备案。
4. 再处理 P1-4 ~ P1-8（时区、onShow 节流、隐私授权、资源清理、登录页图片）。
