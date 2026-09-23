# 小程序与 Express 发布前部署改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让微信小程序在本地与生产环境安全地选择同一 HTTPS 服务域名，并提供 Express 的 HTTPS 反向代理与发布说明。

**Architecture:** 小程序配置模块负责唯一的基础地址解析，网络工具继续只消费该模块，所以普通请求、文件上传和相对资源 URL 共享同一地址。Nginx 示例在 TLS 终止后将 `/api/`、`/uploads/` 和 SPA 流量代理到仅监听环回地址的 Express 实例；文档说明部署人员填入真实配置的位置。

**Tech Stack:** 原生微信小程序 CommonJS、Express、Nginx、Vitest、TypeScript/Vite。

**Spec:** `docs/superpowers/specs/2026-09-22-mini-program-production-deployment-design.md`

## Global Constraints

- 不改变或提交真实域名、AppID、密码、证书或密钥。
- 生产 API 必须是 HTTPS，开发 API 仅用于开发者工具本地预览。
- 小程序 API、上传与相对静态资源必须经同一基础地址解析。
- Express 内部端口不得作为公网入口；Nginx 示例只使用占位域名和证书路径。
- 不添加依赖；使用仓库现有 npm 脚本完成验证。

## Review Focus

- 开发者误把带尾部斜杠的本地地址写入配置时，拼接请求 URL 不产生双斜杠。
- 生产地址若不是 HTTPS，配置在启动请求前明确拒绝，避免真机静默失败。
- 上传照片与 JSON 请求使用完全相同的基础地址，避免仅上传接口跨域名。
- Nginx 未代理 `/uploads/` 时，已保存照片在小程序中不可访问。
- 反向代理错误信任任意转发头时，基于 IP 的登录限流可能被绕过。

### Task 1: 小程序基础地址解析与回归测试

**Files:**
- Modify: `vite.config.ts`
- Modify: `WeChat Mini Program/config.js`
- Create: `WeChat Mini Program/config.test.js`

**Interfaces:**
- Produces: `resolveApiBaseUrl(environment)`，返回无尾部斜杠的基础地址；`getApiBaseUrl()` 供请求工具调用。
- Consumes: 现有 `API_BASE_URL` 生产地址，不修改其真实值。

- [ ] **Step 1: 写入失败测试**

```js
import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './config.js';

it('为开发环境返回本地 Express 地址', () => {
  expect(resolveApiBaseUrl('development')).toBe('http://127.0.0.1:8787');
});

it('拒绝非 HTTPS 的生产 API 地址', () => {
  expect(() => resolveApiBaseUrl('production', 'http://api.example.com')).toThrow(/HTTPS/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- "WeChat Mini Program/config.test.js"`

Expected: FAIL，原因是 `resolveApiBaseUrl` 尚未导出且 Vitest 尚未包含该目录。

- [ ] **Step 3: 实现最小地址选择逻辑**

```js
const API_ENVIRONMENT = 'production';
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8787';

function resolveApiBaseUrl(environment, productionBaseUrl = API_BASE_URL) {
  const baseUrl = environment === 'development' ? LOCAL_API_BASE_URL : productionBaseUrl;
  const normalized = String(baseUrl).replace(/\/$/, '');
  if (environment === 'production' && !/^https:\/\//i.test(normalized)) {
    throw new Error('生产 API 地址必须使用 HTTPS。');
  }
  return normalized;
}
```

在 `vite.config.ts` 的 `test.include` 中加入 `WeChat Mini Program/**/*.test.js`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- "WeChat Mini Program/config.test.js"`

Expected: PASS，开发地址、生产 HTTPS 约束和尾部斜杠归一化均通过。

### Task 2: 统一请求/上传基础地址并锁定代理信任边界

**Files:**
- Modify: `WeChat Mini Program/utils/request.js`
- Create: `WeChat Mini Program/utils/request.test.js`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `getApiBaseUrl()`。
- Produces: `request()` 与 `uploadFile()` 在一次调用中各读取一次同一规范化基础地址；Express 仅信任一个本地反向代理跳数。

- [ ] **Step 1: 写入失败测试**

```js
it('让上传和普通请求使用同一基础地址', async () => {
  await request('/api/me', { auth: false });
  await uploadFile('/api/athletes/1/photo', '/tmp/photo.jpg');
  expect(requestCall.url).toMatch(/^https:\/\//);
  expect(uploadCall.url).toMatch(/^https:\/\//);
  expect(new URL(requestCall.url).origin).toBe(new URL(uploadCall.url).origin);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- "WeChat Mini Program/utils/request.test.js"`

Expected: FAIL，测试要求的单次基础地址解析和断言尚未覆盖。

- [ ] **Step 3: 实现最小网络边界调整**

```js
const baseUrl = getApiBaseUrl();
const url = `${baseUrl}${path}`;
```

`request` 与 `uploadFile` 都只使用各自调用时解析出的 `url`。在 Express 创建应用后设置 `app.set('trust proxy', 1)`，并由 Nginx 示例保证唯一的受信任反向代理。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- "WeChat Mini Program/utils/request.test.js"`

Expected: PASS，普通请求和上传请求为同一 HTTPS origin。

### Task 3: 增加 Nginx 示例并更新发布文档

**Files:**
- Create: `deploy/nginx/jingji.conf.example`
- Modify: `WeChat Mini Program/README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: Express 的 `/api/`、`/uploads/athlete-photos/` 与 SPA 回退路径。
- Produces: 使用 `api.example.com` 和证书占位符的反向代理模板，以及可执行的真机联调/微信公众平台检查清单。

- [ ] **Step 1: 写入失败的静态约束测试**

```js
it('Nginx 示例同时代理 API 和上传资源，且不含真实域名', () => {
  const config = readFileSync('deploy/nginx/jingji.conf.example', 'utf8');
  expect(config).toContain('location /api/');
  expect(config).toContain('location /uploads/');
  expect(config).toContain('127.0.0.1:8787');
  expect(config).toContain('api.example.com');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- "server/deployment-config.test.ts"`

Expected: FAIL，Nginx 示例文件尚不存在。

- [ ] **Step 3: 实现 Nginx 模板与发布说明**

模板包含 HTTP 到 HTTPS 重定向、TLS 占位符、`/api/`、`/uploads/`、SPA 代理、`X-Forwarded-*` 头和上传上限。README 明确同一域名的 request/uploadFile/downloadFile 合法域名、真机 HTTPS 要求及上传前环境切换；架构文档记录部署目录与安全边界。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- "server/deployment-config.test.ts"`

Expected: PASS，示例路径、上游和占位域名约束均满足。

### Task 4: 发布前完整验证

**Files:**
- Verify: 全部改动

- [ ] **Step 1: 执行类型检查**

Run: `npm run check`

Expected: exit 0。

- [ ] **Step 2: 执行静态检查**

Run: `npm run lint`

Expected: exit 0。

- [ ] **Step 3: 执行完整测试集**

Run: `npm test`

Expected: exit 0。

- [ ] **Step 4: 执行生产构建**

Run: `npm run build`

Expected: exit 0。
