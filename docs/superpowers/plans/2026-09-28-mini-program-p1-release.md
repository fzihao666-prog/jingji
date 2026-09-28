# 微信小程序 P1 上线加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变既有业务权限模型的前提下，完成照片、会话、弱网恢复和教练范围筛选的 P1 上线加固。

**Architecture:** 后端将证件照移出公开静态目录，通过逐次鉴权接口读取；Web 与小程序分别用带 Authorization 的 Blob/downloadFile 取得可显示的临时地址。用户表新增单调递增的 `session_version`，JWT 核验当前版本。小程序复用既有页面加载护栏和项目范围接口，补充明确重试、删除锁、授权队伍筛选与本地关键词筛选。

**Tech Stack:** Express、SQLite、TypeScript、微信小程序、React、Vitest、`sharp@0.35.4`。

**Spec:** `docs/superpowers/specs/2026-09-28-mini-program-p1-release-design.md`

## Global Constraints

- 只新增服务端精确锁定依赖 `sharp@0.35.4`；生产部署必须为真实 Linux 平台执行 `npm ci --include=optional` 和 JPEG/PNG 转码冒烟验证。
- 图片只接受不超过 4 MiB 的真实 JPEG/PNG，解码后重编码；原文件名、MIME 和路径都不可信。
- Token、身份证件照路径和用户个人信息不得进入 URL、日志或客户端错误详情。
- 认证、资源访问范围与 `teamId` 必须由服务端校验；前端筛选不构成授权。
- 旧 JWT 没有 `sessionVersion` 时必须失效；认证失败统一回登录。

## Review Focus

- 旧数据库升级后，所有用户均有 `session_version`，不会因空值锁死。
- 并发改密、注销或停用时，旧 Token 不能再被接受。
- 受保护图片的缺失文件、跨运动员访问和下载失败都不能泄露或白屏。
- 小程序断网重试不会自动重复提交写操作。
- 队伍与关键词组合只能缩小登录用户已授权的运动员集合。

## 文件职责

- `server/core/db.ts`：幂等迁移 `users.session_version`。
- `server/core/auth.ts`、`server/access/auth-routes.ts`、`server/athlete/athlete-routes.ts`、`server/access/access-routes.ts`：会话版本签发、核验和失效。
- `server/core/uploads.ts`、`server/athlete/athlete-routes.ts`、`server/index.ts`：图片安全转码、按访问范围读取和移除公开静态托管。
- `src/api.ts`、`src/components/ProtectedAthletePhoto.tsx`、照片消费页面：Web 鉴权图片下载与释放 Blob URL。
- `WeChat Mini Program/utils/request.js`、`services/api.js`、`pages/profile/**`、`pages/profile-edit/**`：小程序鉴权下载头像与失败回退。
- `WeChat Mini Program/pages/*`、`components/scope-filter/**`：重试、删除锁、队伍/关键词筛选。
- `scripts/api-check.mjs` 与相邻小程序测试：安全回归和可用性回归。

## Task 1: 安全图片上传与受保护读取

**Interfaces:** 产生 `GET /api/athletes/:id/photo`；`POST /api/athletes/:id/photo` 继续返回 `{ photoUrl }`，但值为受保护 API 路径。

- [ ] 写入 API 回归：无 Token 为 401、跨运动员为 403、授权用户可读；伪造 MIME、非图片和超限文件为 400；成功上传后的响应内容为服务器重编码的图片。
- [ ] 运行定向回归并确认当前实现至少会暴露公开读取或伪造 MIME 问题。
- [ ] 在 `package.json` 和 `package-lock.json` 精确加入 `sharp@0.35.4`；在 `server/core/uploads.ts` 导出只接受 Buffer 的 JPEG/PNG 转码函数。
- [ ] 在 `server/athlete/athlete-routes.ts` 用 `hasAthleteAccess` 实现读取路由、受控文件名解析、`no-store` 和缺失文件 404；上传仅写转码产物并保存受保护 API 路径。
- [ ] 从 `server/index.ts` 移除 `/uploads/athlete-photos` 公开静态路由。
- [ ] 运行 `npm run api-check` 和图片相关定向检查。
- [ ] 提交 `feat: protect athlete photos`。

## Task 2: 会话版本与明确注销

**Interfaces:** `AuthUser`/JWT 增加 `sessionVersion: number`；新增受认证 `POST /api/auth/logout`；`getAuthUser()` 仅接受当前激活用户的同版本 Token。

- [ ] 在 API 回归中覆盖旧 Token 缺字段、改密后旧 Token、注销后旧 Token、停用后旧 Token均返回 401，以及新登录 Token 可用。
- [ ] 运行定向回归确认旧行为仍接受这些 Token。
- [ ] 在 `server/core/db.ts` 增加幂等 `session_version INTEGER NOT NULL DEFAULT 1` 迁移，并让重建 users 表的迁移保留该列。
- [ ] 在认证读取、登录签名、改密、注销和两条账号停用路径中实现版本核验与递增；所有更新在同一数据库语句或事务内完成。
- [ ] 在 Web 与小程序 API 服务增加 logout 调用，并在现有退出入口成功后清除本地登录态。
- [ ] 运行 `npm run api-check`。
- [ ] 提交 `feat: invalidate stale sessions`。

## Task 3: Web 与小程序受保护头像显示

**Interfaces:** Web 提供可清理的 `ProtectedAthletePhoto` 组件；小程序提供 `downloadAthletePhoto(athleteId)`，解析为临时本地路径或空字符串。

- [ ] 写小程序测试：头像接口路径不再直接传给 `<image>`，下载失败时保留占位而非报错。
- [ ] 在 `src/api.ts` 增加认证 Blob 请求和 401 清理；新增组件并替换 `PersonalPage`、`AthleteManagementPage` 的直接 `<img src={photoUrl}>`。
- [ ] 在小程序 request 工具实现带既有 Authorization/401 逻辑的 `wx.downloadFile`；档案与编辑页加载头像时下载为临时路径，上传后继续使用用户本地选择的路径。
- [ ] 运行 Web 类型检查与小程序测试、类型检查。
- [ ] 提交 `feat: render protected athlete photos`。

## Task 4: 小程序核心流程可恢复与队伍范围筛选

**Interfaces:** 失败页面的 `retryLoad()` 只重发读请求；训练条目使用 `deletingId: number | 0`；范围筛选组件接收授权队伍和 `keyword`，并仅过滤既有候选运动员。

- [ ] 为档案编辑、训练填报、日报、伤病页补充失败后的明确重试测试；为训练删除写入重复点击只派发一次的测试；为队伍/关键词筛选写入仅缩小授权候选的测试。
- [ ] 在各页面重用 `loadPage()` 或只读加载函数实现按钮重试，不自动重放保存与删除。
- [ ] 在 `training-entry` 删除期间禁用目标删除按钮并忽略相同 ID 的后续请求。
- [ ] 通过既有 `overviewTeams(project)` 获取队伍，扩展现有范围筛选，向后端发送已选 `teamId`；在页面对已加载运动员按姓名/队伍关键词过滤。
- [ ] 运行小程序全套测试和 `npm run mini:typecheck`。
- [ ] 提交 `feat: harden mini program recovery flows`。

## Task 5: 全量验证与上线前证据

- [ ] 运行 `npm test`、`npm run api-check`、`npm run mini:typecheck`、`npm run check`、`npm run lint`。
- [ ] 在真实生产 Linux 执行 `npm ci --include=optional`，对 JPEG 和 PNG 分别跑一次上传、读取和重编码冒烟；记录系统、架构与结果，不记录个人数据。
- [ ] 在真机 Wi-Fi 与移动网络验证登录、注销、Token 失效、头像、断网重试、运动员自查和教练队伍筛选。
- [ ] 独立进行安全与移动端可访问性复审，修复发现的 P1 回归。
- [ ] 提交 `test: verify mini program p1 release hardening`。
