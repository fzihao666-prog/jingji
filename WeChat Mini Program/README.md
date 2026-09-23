# 竞迹微信小程序

本目录是竞迹训练监控平台的原生微信小程序客户端。小程序复用项目现有 Express API、账号权限和 SQLite 数据库，不创建第二套数据库，也不复制训练、测试或运动员档案。

## 已迁移页面

- 登录：沿用网页端品牌、口号和账号密码登录；
- 训练总览：项目、运动员和日/周/月筛选，四项核心指标、疲劳与伤病提醒、训练量和强度；
- 专项训练：冠军模型、专项数据、训练量、强度、训练课占比和运动员概览；
- 体能训练：个人体能指标、教练目标、训练计划、训练量和训练记录；
- 运动员档案：基础资料、训练数据、制胜要素、力量测试和伤病恢复；运动员可编辑本人完整档案、身体数据和证件照；
- 本人训练填报：运动员可新增、修改、删除本人在小程序填写的训练课次，训练时长、距离、强度、RPE 和可选设备指标直接进入网页版统计；
- 我的：账号信息、按需展开修改密码、隐私说明和退出登录。

五个主页面使用同一套紧凑筛选和卡片样式。训练趋势显示单位并支持点击查看具体数值；首页伤病记录和专项运动员列表可直接进入已有运动员档案，不增加新的业务数据或详情接口。

小程序刻意不提供账号权限配置、批量 Excel 导入、数据字典维护、批量导出、AI 草案生成和原始数据删除。这些高复杂度或高风险操作继续在网页端完成。

## 与网页端共用数据

```text
React 网页端 ─┐
              ├─ Express /api ─ SQLite
微信小程序 ───┘
```

小程序调用的接口全部由同一 Express 服务提供：

- `/api/auth/login`、`/api/me`；
- `/api/preferences/current-project`、`/api/athletes`；
- `/api/overview`、`/api/overview/teams`；
- `/api/special-training/overview`、`/api/special-champion-models`；
- `/api/strength-tests`、`/api/training-plans`、`/api/strength-training/results`；
- `/api/athletes/:id/overview`、`/api/athletes/:id/injuries`、`/api/athletes/:id/champion-model`。
- `/api/me/athlete-profile`、`/api/me/training-sessions`；
- `/api/athletes/:id/body-composition`、`/api/athletes/:id/photo`。

运动员范围、角色、区域、项目和队伍权限仍由服务端判断，小程序页面隐藏不作为授权依据。本人训练接口不接受客户端传入运动员编号，服务端直接使用登录账号绑定的运动员；修改和删除仅限该账号本人创建的手工记录。

## 本地预览

1. 在项目根目录运行网页与 API：

   ```powershell
   npm install
   npm run dev
   ```

2. 打开微信开发者工具，选择“导入项目”，目录指向本文件所在的 `WeChat Mini Program`。
3. 首次本地预览可以使用项目中的测试 AppID。正式开发时，将 `project.config.json` 中的 `appid` 替换为已注册的小程序 AppID。
4. 将 `config.js` 的 `API_ENVIRONMENT` 临时改为 `development`；开发者工具模拟器会访问 `http://127.0.0.1:8787`。
5. 使用演示账号登录，例如 `athlete01 / demo123` 或 `coach01 / demo123`。本地预览完成后不要上传该环境设置。

## 真机和生产服务器

真机中的 `127.0.0.1` 指向手机本身，不能连接电脑。真机联调与发布统一使用生产 HTTPS 域名，按以下步骤执行：

1. 在 `config.js` 中将 `API_ENVIRONMENT` 设为 `production`。不要替换仓库中已有的真实 `API_BASE_URL`，更不要把新域名、AppID、密码、证书或密钥写入 README、示例或提交。
2. 以 `deploy/nginx/jingji.conf.example` 为起点，在服务器本地填写真实域名与证书路径。Nginx 必须将 `/api/`、`/uploads/` 和网页入口代理到 `127.0.0.1:8787`；防火墙不得将 8787 对公网开放。
3. 为生产域名部署有效、未过期、受信任 CA 签发的 HTTPS 证书。HTTP 只用于重定向到 HTTPS；确认域名、服务器和小程序备案信息一致。
4. 登录微信公众平台，依次进入“开发管理 → 开发设置 → 服务器域名”。将**同一个不带路径的 HTTPS 域名**分别添加到 request 合法域名、uploadFile 合法域名和 downloadFile 合法域名。照片和登录背景等资源依赖 downloadFile 域名。
5. 使用真机登录，分别验证登录、任一数据查询、上传证件照和重新打开已上传照片。三项请求都应为同一 HTTPS origin，不能带 `:8787`。
6. 上传体验版前再次核对 `API_ENVIRONMENT` 为 `production`，并在服务器上配置固定的强 `JWT_SECRET`、修改全部演示账户密码及备份数据库、上传目录和密钥文件。

`project.config.json` 中的 `urlCheck: false` 只适用于开发者工具本地预览。它不能绕过真机、体验版或正式版的微信服务器域名校验，也不能代替 HTTPS 证书配置。

## 资料保存与真机网络排障

- 资料保存前会去除文本首尾空格，姓名限制为 2–20 个字符；出生日期和开始运动日期允许输入 `2006-9-3`，提交时规范为 `2006-09-03`，不存在的日期会在提交前指出。空的选填字段提交空字符串，组织归属字段不提交，服务端仍独立校验权限与数据。
- `PUT /api/me/athlete-profile` 返回 HTTP 400 表示已经收到服务端拒绝；查看响应 JSON 的 `message`，不要将 `request:ok` 当成保存成功。小程序和后端需要同步部署；只重新编译小程序不会更新线上校验规则。
- 登录报 `ERR_CONNECTION_RESET` 且未收到响应头，表示连接在取得 HTTP 响应之前中断，不能按密码错误处理。页面会展示网络、合法域名、证书或超时对应提示。
- 若模拟器可用而真机被重置，应分别验证 TLS 1.2 和 TLS 1.3。仅 TLS 1.3 可用不能视为真机兼容性验收通过。用相同域名、SNI 分别测试，避免用 IP 地址替代域名绕过证书校验：

  ```sh
  openssl s_client -connect api.example.com:443 -servername api.example.com -tls1_2 </dev/null
  openssl s_client -connect api.example.com:443 -servername api.example.com -tls1_3 </dev/null
  ```

  先在服务器本机测试 Nginx（将 `-connect` 改为 `127.0.0.1:443`，保持真实 `-servername`），再从外网测试。若本机失败，检查实际生效的 HTTPS 虚拟主机、`ssl_protocols TLSv1.2 TLSv1.3`、证书链与密码套件；若本机成功而外网失败，检查负载均衡、WAF、云接入层和备案接入状态。示例配置不会自动覆盖线上配置。修改后先执行 `nginx -t`，通过后再平滑重载并复测。
- 若 HTTP 返回云平台备案拦截页，应在对应云控制台核查备案与接入状态；该现象本身不能证明 HTTPS 重置也由备案引起。不要通过禁用证书校验、改用 HTTP 或硬编码 IP 规避。
- 验收需要关闭开发者工具的跳过校验选项，在手机 Wi-Fi 和移动网络下分别验证登录及资料保存。排障只分享错误码、状态码、字段名；不分享账号、密码、Token 或资料正文。

## 敏感信息保护

- 小程序不缓存运动员档案、伤病、体测或训练明细，只缓存登录 Token、当前用户基本资料和当前项目；
- 身份证号和手机号在档案页默认脱敏；
- 小程序不提供批量敏感数据导出；
- 所有运动员级接口继续复用服务端访问范围判断；
- 隐私说明页是产品框架，发布前需由运营主体补充单位名称、联系方式、保存期限和投诉渠道；
- 不满十四周岁运动员正式使用前需完成监护人授权流程。

## 当前一期边界

- 使用网页端账号密码登录，尚未增加 OpenID 绑定，因此无需修改数据库；
- 小程序用于查看、本人档案维护和现场训练填报，复杂训练计划仍在网页端编辑；
- 图表使用轻量原生视图复刻网页端信息层级，没有引入新的图表依赖；
- 证件照和登录背景直接读取现有服务器资源，正式环境需要将同一 HTTPS 域名同时加入 request、uploadFile 和 downloadFile 合法域名。
