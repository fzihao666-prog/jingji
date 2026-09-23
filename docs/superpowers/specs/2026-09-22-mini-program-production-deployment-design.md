# 小程序与 Express 发布前部署改造设计

## 目标

在不提交真实域名、AppID、密码、证书或密钥的前提下，使竞迹的微信小程序能够明确地区分本地开发和生产 API 地址，并让 API、上传和照片资源均通过同一个 HTTPS 域名访问。

## 范围与约束

- 不改变现有真实生产域名、AppID、账户密码或任何密钥值。
- 小程序仍复用现有 Express API、Bearer Token 与照片上传接口；不引入新的认证或数据通道。
- 生产环境不对公网直接暴露 Express 内部端口；Nginx 负责 TLS 终止并反向代理到环回地址。
- 示例与文档只使用 `api.example.com`、证书路径占位符和环境变量名。

## 小程序地址策略

`WeChat Mini Program/config.js` 保留当前生产地址的既有值，并增加显式的 `development` / `production` 选择。开发地址固定为本机 Express 地址，生产地址必须为 HTTPS。移除通过 `wx` 本地存储覆盖基础地址的通道，避免真机或发布包意外请求未经审核的地址。

所有请求继续通过 `getApiBaseUrl()`：`wx.request`、`wx.uploadFile` 与相对静态资源 URL 使用同一个已解析地址，因此 `/api/*`、`/uploads/*` 和网页资源不会跨域名分流。

## 服务端发布拓扑

新增 Nginx 模板，将单个 HTTPS 虚拟主机的 `/api/`、`/uploads/` 和其余页面请求代理到 `127.0.0.1:8787`。模板设置必要的 `Host` 与 `X-Forwarded-*` 请求头、上传大小上限及 TLS/HSTS 示例；真实域名和证书路径由部署人员在服务器配置中填写，不进入仓库。

Express 维持 API、上传目录和 SPA 静态资源的既有路径。为使位于受信任反向代理后的限流/日志能识别客户端地址，入口使用受限的代理信任配置，而不是向任意上游信任转发头。

## 发布说明

小程序 README 将区分：

1. 开发者工具中的本地预览与临时关闭域名校验；
2. 真机联调必须使用可公开访问、证书有效的 HTTPS 域名；
3. 微信公众平台中将同一 HTTPS 域名分别配置为 request、uploadFile 和 downloadFile 合法域名；
4. 上传前切回生产环境、核对 AppID、检查 Nginx 代理与服务器备案/域名配置。

架构文档同步描述上述生产边界和示例位置。

## 验证

先为小程序地址选择和统一 URL 拼接添加 Vitest 测试，覆盖本地地址、生产 HTTPS 地址、普通请求与上传使用同一基础地址。之后运行 `npm run check`、`npm run lint`、`npm test` 和 `npm run build`。Nginx 模板通过语法审查说明与人工变量替换检查交付；仓库不包含可运行的 Nginx 二进制或真实证书，无法在本地完成 TLS 握手测试。
