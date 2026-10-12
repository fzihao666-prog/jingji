# 竞迹｜P2 执行 Spec：体验一致性与安全加固

## 1. 需求目标

处理 P2 结构/体验问题与低危安全加固；**不改变核心权限模型**。可在 P0/P1 后并行小步提交。

## 2. 问题清单与改动

### 2.1 Web 注册前端校验对齐小程序

**文件：`src/pages/LoginPage.tsx`、`src/api.ts`**

| 项 | 现状 | 目标 |
|---|---|---|
| 账号格式 | 仅 required | `/^[a-z0-9_]{4,24}$/`，错误文案与小程序一致 |
| 姓名长度 | 仅 required | 2–20 |
| 密码 | 仅 required | 8–72，含字母+数字 |
| 确认密码 | 有 | 保持 |
| `api.register` 类型 | 仅 `{message}` | `{ message: string; status?: 'pending' \| 'approved' }` |

**测试：** 组件层或纯校验函数测试（若校验抽到 `shared/` 优先共享）。

### 2.2 队伍列表按项目过滤

**文件：`server/access/auth-routes.ts` `GET /api/registration/teams`**

- 支持可选 `?project=`；无效项目返回 400 或忽略并返回全部（推荐校验后过滤）。
- 响应结构不变（仍含 `project` 字段），兼容旧客户端。
- 小程序/Web 可改为带参请求（可选，非必须）。

### 2.3 accessibleAthleteIds 性能

**文件：`server/core/permissions.ts`**

- 将全表加载改为按权限下推 SQL：
  - ATL：直接 `[athleteId]`（已短路）；
  - SCC：`team_id IN (...)` / `(project, team)` 元组匹配 + `active=1`；
  - 其他：area/project/team 条件进 WHERE 或先算权限再 `IN`。
- 保持导出 API 不变；行为与过滤器版本单测对齐。
- 基准：运动员 ≥1k 时列表接口无回归（可用简单脚本或跳过，标注性能非阻断）。

### 2.4 文档统一角色表述

**文件：`README.md`、`docs/architecture.md`（如有）**

- 统一为：**五级五类**（ATL/SCC/REG/TD/DMD）；注明旧 PRJ 已合并为 REG。
- 与 `shared/access.ts` 一致，不写「六类」。

### 2.5 冠军模型接口鉴权

**文件：`server/analysis/analysis-routes.ts`**

| 接口 | 改动 |
|---|---|
| `GET /api/special-champion-models/ergometer` | 加 `requireAuth`（若需匿名展示只读标准，改为公开白名单并文档说明；默认加鉴权） |
| `GET /api/analysis/model` | 增加项目授权：`selectableProjects(user)` 包含所查 project，否则 403 |

**测试：** 匿名 401；非授权项目 403；授权角色 200。

### 2.6 教练待办 followups DELETE 范围过滤

**文件：`server/index.ts`**

- `DELETE /api/coach/daily-todos/followups` 对 `athleteIds` 与 PUT 对齐：`accessibleAthleteIds` 过滤或逐个 `hasAthleteAccess`。
- 越权 id 静默丢弃或返回 403（与 PUT 一致即可）。

### 2.7 （可选）注册错误码语义

**文件：`server/access/auth-routes.ts`**

- 自动开通身份冲突时返回明确 `code`（如 `IDENTITY_MISMATCH`），便于小程序展示；依赖 P0-1 完成。

## 3. 测试场景

| 场景 | 预期 |
|---|---|
| Web 空账号/弱密码提交 | 前端拦截，文案与小程序一致 |
| `/api/registration/teams?project=ROWING` | 仅赛艇队伍 |
| 匿名访问 ergometer 冠军模型 | 401（若采用加鉴权方案） |
| 无项目权限用户查 analysis/model | 403 |
| followups DELETE 含他队运动员 id | 不删除他队数据；自有标记行为正确 |
| `npm run check` / lint | 通过 |

## 4. 实施顺序建议

1. 2.5 + 2.6（安全小补丁，独立可回滚）  
2. 2.1 + 2.2（体验）  
3. 2.4（纯文档）  
4. 2.3（性能，行为对齐测试必须先绿）  
5. 2.7（可选）

## 5. 验收标准

- 每条独立可提交；无 Schema 破坏性变更（2.2 仅 query）。
- 不引入新依赖；前端校验尽量复用 `shared/`（账号/密码规则若仅服务端有，可抽到 `shared/account-credentials.ts` 已有模块）。
- 交付列表：改动文件 + 测试结果 + 未做项说明。

## 6. 明确不改动

- 不重做注册 UI 视觉；不引入新组件库。
- 不改 JWT 结构、不改审核产品流程。
- 不强制本轮做邀请码/多因素认证（若 P1-1 已做标记方案则足够）。
