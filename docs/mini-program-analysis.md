# 竞迹微信小程序：功能、框架与代码分析

> 分析基准日期：2026-09-23。以 `WeChat Mini Program/` 当前源码为准；与主 README、`docs/architecture.md` 不一致时以代码为准并应回写文档。

## 1. 定位与边界

竞迹小程序是训练监控平台的**原生微信客户端**，与 React 网页端共用同一套 Express API、账号权限和 SQLite，**不新建第二套数据库，也不复制训练/测试/档案业务事实**。

```text
React 网页端 ─┐
              ├─ Express /api ─ SQLite
微信小程序 ───┘
```

| 边界内（当前一期） | 边界外（刻意不做） |
| --- | --- |
| 账号密码登录、运动员注册申请 | 微信 OpenID / 手机号一键登录 |
| 训练总览、专项、体能、档案只读视图 | 账号权限配置、区域授权 |
| 本人档案编辑、身体成分、证件照 | 批量 Excel 导入/导出、字典维护 |
| 运动员本人训练课次增删改 | AI 草案生成、原始数据删除 |
| 改密、隐私说明、退出登录 | 复杂训练计划编辑（网页端） |

生产约束：`config.js` 必须用**同一 HTTPS 域名**覆盖 request / uploadFile / downloadFile；开发环境才允许 `127.0.0.1:8787`。

## 2. 技术栈与框架形态

| 维度 | 现状 |
| --- | --- |
| 运行时 | 原生微信小程序，**无 npm、无 Taro/uni-app、无 TS 编译** |
| 模块 | CommonJS（`require` / `module.exports`） |
| 视图 | WXML + WXSS；`app.json` `style: v2`，`lazyCodeLoading: requiredComponents` |
| 组件 | 仅 1 个自定义组件 `scope-filter`；页面用 `Page()`，组件用 `Component()` |
| 状态 | `App.globalData` + `wx.storage`（Token / 用户 / 当前项目） |
| 网络 | 自研 `utils/request.js` 封装 `wx.request` / `wx.uploadFile` |
| 样式 | 全局 `app.wxss` 色板与卡片；页面局部 WXSS |
| 图表 | **无图表库**，用 `view` 柱状条 + 内联 `style` 百分比高度/宽度 |
| 字典 | 注册页 `data/register-data.js` 与 `shared/` 逻辑对齐（测试断言），运行时**不 import** `shared/` |
| 测试 | 根仓库 Vitest 对小程序做**静态/单元**回归（约 7 个 `*.test.js`） |
| 图标 | TabBar PNG、登录奥运 GIF（部分走服务器 `assetUrl`）、SVG 若干 |

规模（不含测试）：约 **10 页面 + 1 组件 + 1 服务层 + 6 工具**；源码约 **4.5k 行** JS/WXML/WXSS；资源约 **64** 个文件（含 50 张奥运项目图）。

## 3. 页面与导航

### 3.1 路由（`app.json`）

| 顺序 | 路径 | 入口 |
| --- | --- | --- |
| 1 | `pages/login/login` | 启动/未登录 `reLaunch` |
| 2 | `pages/register/register` | 登录页「立即注册」`navigateTo` |
| 3–7, 9 | TabBar：`index` / `special` / `strength` / `profile` / `mine` | 底部 5 Tab |
| 8 | `pages/profile-edit/profile-edit` | 档案页「编辑」 |
| 8 | `pages/training-entry/training-entry` | 首页「记录训练」（ATL） |
| 10 | `pages/privacy/privacy` | 登录/我的「隐私说明」 |

全局组件：`usingComponents.scope-filter` → `/components/scope-filter/index`（项目/运动员/日周月筛选）。

### 3.2 功能一览

#### 认证与准入

| 页面 | 能力要点 |
| --- | --- |
| **登录** | 账号密码；记忆账号；隐私勾选必选；奥运项目装饰图与 hero（`assetUrl`）；忘记密码仅提示找管理员；注册回填账号 |
| **注册** | 运动员申请：姓名、身份证（推导性别/出生日期）、手机号、籍贯省市、项目、队伍（加载失败可重试）、账号密码；复用 `POST /api/auth/register`；成功只回填账号不回填密码 |
| **隐私** | 静态说明页，`Page({})` 空逻辑，发布前需运营主体补全 |
| **我的** | 角色文案、改密表单、隐私入口、确认后退出清会话 |

#### 训练总览（Tab：训练总览）

- `loadContext` 拉 `/api/me`（可选）、`current-project`、`athletes`。
- 管理角色：日/周/月 + 项目；运动员：固定本人 `athleteId`，隐藏运动员选择器。
- 指标卡：训练时长、负荷（SRPE）、疲劳指数、损伤人数。
- 近 14 日双序列趋势（时长/负荷）柱状 + 点击 Modal 明细。
- 强度区间占比进度条；伤病列表可 `switchTab` 进档案。
- **每日待办**（SCC/PRJ/REG/TD/DMD）：未填报/高负荷/伤病/开训时间缺失；`daily-todos.js` 在网络边界做形状校验；请求序号防串项目。
- ATL 可进入本人训练填报。

#### 专项训练（Tab：专项训练）

- 冠军模型（最多 12 条）、专项汇总 4 卡、近 14 日时长/距离趋势。
- 强度占比、训练课内容占比、队伍筛选（`/api/overview/teams`）、运动员列表前 30 人可点进档案。
- 项目与时间范围切换会 `saveCurrentProject` 并重拉。

#### 体能训练（Tab：体能训练）

- 运动员选自己（`allow-all=false`）；管理角色可选项目内运动员。
- 汇总 4 卡、最近测试指标条（目标达成率）、冠军模型对比前 4 项、最近计划摘要与练习行、近 14 日趋势、最近训练记录列表。
- 数据：`/api/strength-tests`、`/api/training-plans`、`/api/strength-training/results`。

#### 档案（Tab：档案）

- 基础格子资料（主区 + 更多）、训练概览 4 卡、制胜要素摘要、力量测试条、伤病列表。
- 身份证/手机号默认脱敏；ATL 显示「编辑」进 `profile-edit`。
- 并行请求伤病、个人 overview、冠军模型（后者失败可降级）。

#### 本人档案编辑 `profile-edit`

- 仅 ATL 且已绑定 `athleteId`。
- 个人字段经 `profile-payload.js` 规范化（姓名 2–20、日期补零与有效性）。
- 身体成成分字段可选提交（改动才 PUT）；证件照 `chooseMedia` + `uploadFile`。
- 保存顺序：档案 → 身体成分 → 照片 → 刷新上下文 → 提示「已同步到网页端」。

#### 本人训练填报 `training-entry`

- 仅 ATL；列表本人 `training_sessions`。
- 新建/编辑/删除：类型、强度区、内容、时长、距离、RPE，可选心率/功率/桨频。
- 服务端按登录账号绑定运动员，不接受客户端 athleteId。

## 4. 分层与代码结构

```text
WeChat Mini Program/
├─ app.js / app.json / app.wxss     # 全局会话、路由、全局样式
├─ config.js                        # 环境、API 基址、storage key
├─ services/api.js                  # 唯一 API 门面（页面不直接拼 URL）
├─ utils/
│  ├─ request.js                    # 请求/上传、鉴权头、401 跳转、网络诊断
│  ├─ context.js                    # 用户+项目+运动员列表装配
│  ├─ date.js / format.js           # 区间、脱敏、指标字典
│  ├─ daily-todos.js                # 待办响应显式校验与文案
│  ├─ profile-payload.js            # 档案提交规范化
│  └─ network-error.js              # 用户可读网络错误
├─ data/register-data.js            # 注册用项目/省份字典（CJS）
├─ components/scope-filter/         # 共用筛选
├─ pages/*/                         # 页面四件套 + 部分 test
└─ assets/                          # TabBar、盾牌 SVG、奥运 GIF 等
```

### 4.1 依赖方向（应保持）

```text
pages → services/api → utils/request → config
pages → utils/{context,date,format,...} →（可）services/api
pages 不直接 wx.request；utils 不 import pages
```

### 4.2 数据流惯例

1. `onShow` / `onLoad` → `loadContext`（登录校验、项目、运动员）。
2. 并行业务请求 → 页面内 `build*View` 纯函数映射为 WXML 友好结构。
3. 筛选变更：本地 `setData` + 可选 `saveCurrentProject` + 重拉。
4. 并发防护：首页用 `_pageRequest` / `_todoRequest` 序号丢弃过期响应。
5. 跳转档案：写 `globalData.selectedAthleteId` 后 `switchTab` 档案页。

### 4.3 样式

- 色板与主按钮、卡片、`.ratio-*`、`.state-*`、`.metric-*` 集中在 `app.wxss`。
- 页面 WXSS 只放差异（如专项队伍选择器、体能计划头）。
- 动态宽度/高度用内联 `style="width: {{...}}%"`；开发者工具可能对 Mustache 报 CSS 误报，**运行时合法**。

## 5. 接口清单（小程序已用）

| 方法 | 路径 | 使用方 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/change-password` | 我的 |
| GET | `/api/me` | 上下文刷新 |
| GET | `/api/teams` | 注册队伍（`auth:false`） |
| GET/PUT | `/api/preferences/current-project` | 上下文/切换项目 |
| GET | `/api/athletes` | 运动员列表 |
| GET | `/api/overview`、`/api/overview/teams` | 总览/专项队伍 |
| GET | `/api/coach/daily-todos` | 首页待办（非 ATL） |
| GET | `/api/special-training/overview`、`/api/special-champion-models` | 专项 |
| GET | `/api/strength-tests`、`/api/training-plans`、`/api/strength-training/results` | 体能 |
| GET | `/api/athletes/:id/overview`、`.../injuries`、`.../champion-model` | 档案 |
| PUT | `/api/me/athlete-profile` | 档案编辑 |
| PUT | `/api/athletes/:id/body-composition` | 身体成分 |
| POST | `/api/athletes/:id/photo` | 证件照上传 |
| GET/POST/PUT/DELETE | `/api/me/training-sessions[...]` | 训练填报 |

**授权**：全部依赖服务端；页面隐藏控件**不是**授权手段。`request.js` 对 401 清会话并 `reLaunch` 登录。

## 6. 配置与环境

| 项 | 说明 |
| --- | --- |
| `API_ENVIRONMENT` | `development` → `http://127.0.0.1:8787`；`production` → 必须 HTTPS（`resolveApiBaseUrl` 校验） |
| `NETWORK_DEBUG` | 网络追踪日志开关；脱敏 URL/字段，不打 Token/密码/正文；**发布前应 false** |
| storage keys | `jingji-mini-token` / `user` / `project`；另：记住账号、注册回填账号 |
| `project.config.json` | 测试 AppID、`urlCheck:false` 仅工具本地；真机靠公众平台合法域名 |
| AppID | 仓库内为具体 AppID，发布前需与主体一致并完成备案 |

**当前仓库风险（发布相关）**：分析时 `config.js` 仍为 `API_ENVIRONMENT = 'development'` 且 `NETWORK_DEBUG = true`，与 README「发布前保持 production / 定位完改回 false」不一致，上传前必须改回。

## 7. 测试与质量

| 类型 | 位置 | 覆盖点 |
| --- | --- | --- |
| 单元/静态 | `config.test.js` | 基址解析、生产强制 HTTPS |
| 单元 | `utils/request.test.js`、`network-error.test.js`、`profile-payload.test.js`、`daily-todos.test.js` | 传输、错误文案、档案校验、待办形状 |
| 静态 | `register.test.js`、`profile-edit.test.js` | 字典与 shared 一致、接口/回填/队伍重试、编辑链路 |
| 集成 | 根 `scripts/api-check.mjs` | 含注册/审批等服务端回归（非小程序 UI） |

缺口：

- 无微信开发者工具自动化/E2E；`scope-filter`、主 Tab 交互靠人工/真机。
- 页面 `build*View` 未单测，依赖后续 api-check + 手测。
- 开发者工具对 WXML 内联 Mustache 的 CSS 误报需知悉，避免误改「修样式」。

## 8. 代码质量观察

**较好**

- 单一 API 门面 + 单一请求层，环境集中在 `config.js`。
- 网络失败分类、日志脱敏、401 防重入跳转较完整。
- 待办、注册字典、档案 payload 有显式边界校验与 Vitest。
- 页面视图多用纯函数组装，WXML 偏「薄」。
- 敏感信息：列表不缓存明细档案；证件/手机脱敏；不存密码回填。

**债务与风险**

1. **`config.js` 开发态残留**（见 §6），发布阻断项。
2. **筛选/加载样板重复**：index/special/strength/profile 几乎同一套 `onProjectChange`/`onAthleteChange`/`onRangeChange`，易漂移（首页有序号防护，其他页较弱）。
3. **字典双份**：`register-data.js` / `format.js` 与 `shared/*` 靠测试对齐，改 shared 必须同步。
4. **无 TS/无组件化页面**：大页 JS 200+ 行，重构成本随功能上升。
5. **图表表达力有限**：柱状条无法替代网页端 ECharts，复杂分析仍须网页。
6. **隐私页与未成年人流程**仍为框架，正式上线要产品/法务补全。
7. **开发者工具 CSS 误报**（`style` + `{{}}`）易被当成真实样式 bug。
8. 资源体积：奥运 GIF 等偏大，注意小程序包体与分包策略（当前未分包）。

## 9. 与网页端能力对照（摘要）

| 能力 | 网页 | 小程序 |
| --- | --- | --- |
| 登录/注册/改密 | ✓ | ✓ |
| 总览/专项/体能/档案查看 | ✓ | ✓（图表简化） |
| 本人档案与照片 | ✓ | ✓ |
| 本人训练填报 | ✓ | ✓（现场） |
| 训练计划编辑、导入导出、AI、权限 | ✓ | ✗ |
| 蓝牙等设备 | 试验入口 | ✗ |

## 10. 建议演进方向（按优先级）

1. **发布清单**：`API_ENVIRONMENT=production`、`NETWORK_DEBUG=false`、合法域名三件套、AppID/备案、演示密码与 `JWT_SECRET`。
2. **抽取页面加载钩子**：统一 context + range/project/athlete 切换与过期请求丢弃，减少复制粘贴。
3. **真机回归清单**：登录、总览、待办点选、训练填报、档案编辑、照片上传下载、TLS 1.2/1.3。
4. **包体**：评估奥运 GIF 是否改为按需/压缩/分包；TabBar 图标保持小图。
5. **中期**：若功能继续加，再评估 TS 或构建链；在此之前维持原生 + Vitest 静态回归即可。
6. **文档同步**：架构文档已有点状小程序章节；大改接口或权限时继续回写 `docs/architecture.md` 与小程序 README。

## 11. 关键文件索引

| 路径 | 作用 |
| --- | --- |
| `WeChat Mini Program/app.json` | 路由与 TabBar |
| `WeChat Mini Program/config.js` | 环境与密钥名 |
| `WeChat Mini Program/services/api.js` | API 门面 |
| `WeChat Mini Program/utils/request.js` | 网络层 |
| `WeChat Mini Program/utils/context.js` | 会话上下文 |
| `WeChat Mini Program/pages/*/…` | 页面逻辑 |
| `WeChat Mini Program/README.md` | 产品边界与部署说明 |
| `docs/architecture.md` | 系统架构与待办等服务端约定 |
| 根 `scripts/api-check.mjs` | 含注册/审批的服务端回归 |
