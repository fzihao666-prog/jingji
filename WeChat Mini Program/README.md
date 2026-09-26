# 竞迹微信小程序

本目录是竞迹训练监控平台的原生微信小程序客户端。小程序复用项目现有 Express API、账号权限和 SQLite 数据库，不创建第二套数据库，也不复制训练、测试或运动员档案。

## 已迁移页面

- 登录：沿用网页端品牌、口号和账号密码登录；
- 注册：登录页提供“立即注册”入口，先选择注册身份（仅运动员 ATL / 教练 SCC），运动员填写身份证号（自动推导性别与出生日期）、性别、籍贯与手机号，教练仅填手机号，队伍列表支持加载失败重试；复用 `POST /api/auth/register`，是否需审核由后端“注册审核”开关决定——开启时返回待审核并提示“审核通过后可登录”，关闭时自动开通并提示“注册成功”；成功返回登录页并自动回填账号、不回填密码；
- 训练总览：项目和日/周/月筛选，管理账号按权限范围聚合、运动员查看本人；每日训练待办、四项核心指标、疲劳与伤病提醒、训练量和强度；
- 专项训练：冠军模型、专项数据、训练量、强度、训练课占比和运动员概览；
- 体能训练：个人体能指标、教练目标、训练计划、训练量和训练记录；
- 运动员档案：基础资料、训练数据、制胜要素、力量测试和伤病恢复；运动员可编辑本人完整档案、身体数据和证件照；
- 本人训练填报：运动员可新增、修改、删除本人在小程序填写的训练课次，训练时长、距离、强度、RPE 和可选设备指标直接进入网页版统计；
- 我的：账号信息、按需展开修改密码、隐私说明和退出登录。

五个主页面使用同一套紧凑筛选和卡片样式。训练趋势显示单位并支持点击查看具体数值；首页伤病记录和专项运动员列表可直接进入已有运动员档案，不增加新的业务数据或详情接口。

### 新页面的筛选与加载约定

`utils/page-scope.js` 负责从 `loadContext()` 初始化项目、运动员和日／周／月范围，并通过 `applyScopeChange()` 处理 `scope-filter` 的三个现有事件。ATL 的运动员 ID 固定为本人，其他角色的选择必须属于当前项目的可访问列表。项目切换使用 `saveProjectInOrder()` 按触发顺序保存。

页面只实现业务数据请求和视图转换：训练总览、专项、体能和档案 Tab 在 30 秒内、项目和北京时间日期未变且没有数据变更时复用现有内容；手动下拉、训练填报和档案保存仍触发刷新。筛选事件统一绑定 `onScopeChange`。每次异步加载使用 `utils/request-guard.js` 的 `loadWithGuard()`，只允许最新请求更新页面数据、错误和 loading。需要独立刷新的数据（如首页每日待办）使用独立的 `createRequestGuard()`。

小程序刻意不提供账号权限配置、批量 Excel 导入、数据字典维护、批量导出、AI 草案生成和原始数据删除。这些高复杂度或高风险操作继续在网页端完成。

## 与网页端共用数据

```text
React 网页端 ─┐
              ├─ Express /api ─ SQLite
微信小程序 ───┘
```

小程序调用的接口全部由同一 Express 服务提供：

- `/api/auth/login`、`/api/auth/register`、`/api/me`；
- `/api/registration/teams`（注册页公开队伍名称）；登录后的 `/api/teams` 才返回队伍统计；
- `/api/preferences/current-project`、`/api/athletes`；
- `/api/overview`、`/api/overview/teams`；
- `/api/coach/daily-todos?project=ROWING`（管理角色的当天待办）；
- `/api/special-training/overview`、`/api/special-champion-models`；
- `/api/strength-tests`、`/api/training-plans`、`/api/strength-training/results`；
- `/api/athletes/:id/overview`、`/api/athletes/:id/injuries`、`/api/athletes/:id/champion-model`。
- `/api/me/athlete-profile`、`/api/me/training-sessions`；
- `/api/athletes/:id/body-composition`、`/api/athletes/:id/photo`。

运动员范围、角色、区域、项目和队伍权限仍由服务端判断，小程序页面隐藏不作为授权依据。本人训练接口不接受客户端传入运动员编号，服务端直接使用登录账号绑定的运动员；修改和删除仅限该账号本人创建的手工记录。

照片选择前使用微信隐私授权流程，并展示平台配置的隐私保护指引。日期筛选、训练填报和身体成分测量日统一使用北京时间。注册项目、省市、角色和体能指标字典从 `shared/` 生成：修改共享字典后运行 `npm run mini:dictionary-sync`，使用 `npm run mini:dictionary-check` 校验。登录页不再请求 50 张远程 GIF；未使用的奥运 PNG 在 `project.config.json` 中排除打包。

`npm run mini:typecheck` 对配置、日期和请求竞争工具运行严格 TypeScript `checkJs`。其余原生页面仍逐步迁移，不能把该命令视为全小程序类型检查。

## 每日训练待办与场景数据

首页向 SCC、PRJ、REG、TD、DMD 展示当前项目权限范围内的待办，运动员账号不展示也不能调用该接口。待办不受总览日/周/月或历史个人选择影响；点击名单进入对应运动员档案，返回首页、下拉刷新或点击“刷新”会重新读取服务端状态。

- 当天未填报：北京时间当天没有正式有效 `training_sessions` 记录的在用运动员。至少一条有效记录即可消除待办，不表示当天训练计划全部完成。
- 高负荷：使用既有 SRPE 和训练分类，按每名运动员在滚动24小时内的课次累计，阈值为 **600 AU（含）**，不采用团队共同课次去重；这是待办关注规则。
- 伤病：沿用每名运动员最新伤病记录状态，非 `healthy` 持续关注，并标注是否在近24小时更新；最新状态恢复健康后解除伤病关注。同一人高负荷与伤病合并展示。
- 时间缺失：今日或昨日没有有效开训时间的课次不猜测发生时刻，单列“开训时间待补充”；今日有效课次仍计为已填报。
- 正式统计筛选沿用总览：排除 `is_demo=1`、`insufficient/outlier/estimated` 质量及来源包含 `demo/seed/estimated` 的记录。

生成可体验上述场景的独立数据库：

```sh
npm run daily-todos-example
DATABASE_PATH="$PWD/tmp/coach-daily-todos-YYYY-MM-DD.db" npm run dev
```

将 `YYYY-MM-DD` 替换为生成命令输出的北京时间日期。命令仅创建新库，已存在时拒绝覆盖，不改动默认运行库。库中使用现有合成运动员与账号；新增课次写入正式 `training_sessions`，`source=coach_daily_example`、`quality=valid`、`is_demo=0`，伤病写入 `injury_records`，两者按真实记录参与统计。默认示例含赛艇未填报1人、关注2人、时间待补充1人，皮划艇与激流各未填报1人、关注1人；若在零点刚过生成，前一分钟课次属于昨天，以服务端实际名单为准。样例随时间自然移出24小时窗口，不会后台自动补写。

`npm run api-check` 已包含权限、日期、跨项目、停用/移除队伍权限、填报消项、伤病恢复与缺失时间检查；原生微信小程序的读屏、项目切换及档案返回交互仍需开发者工具/真机验收。

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
