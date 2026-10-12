# 竞迹｜P1 执行 Spec：人员关系可信化与同步

## 1. 需求目标

修复审查确认的 P1 关系/流程问题，提升队伍归属可信度，消除双轨绑定与上下级不同步。

**在 P0 完成后实施。** 允许改代码与测试；不做破坏性重构。

## 2. 问题与目标一览

| 编号 | 问题 | 目标 |
|---|---|---|
| P1-1 | 注册自报队伍无归属核验；审核关闭时运动员立即入队 | 入队可核验、可拒绝 |
| P1-2 | 注册开通不写 `athlete_origins`，行政归属空洞 | 开通即有可追溯归属或明确「待完善」状态 |
| P1-3 | 同名跨队匹配不确定 | 精确按项目+队伍匹配（若 P0-1 已做则本项合并验收） |
| P1-4 | 转队后 `parentUserId` 不重算 | 转队后上下级仍合法 |
| P1-5 | `coach_athletes` 与 `user_team_permissions` 可漂移 | 分配/改权/转队时同步或降级为纯展示 |
| P1-6 | 注册审核路径无区域 containment，父子绑定与可见性可不一致 | 父级绑定与授权范围一致 |
| P1-7 | 分配接口不要求教练队伍与运动员队伍一致 | 分配时校验队伍/可见性 |

## 3. 详细改动

### 3.1 P1-1 注册入队可信化（最小方案）

**原则：** 不做邀请码体系也可先落地「可拒绝、可追踪」。

**文件：`server/access/registration-service.ts` / `auth-routes.ts` / 可选字段**

1. `registration_requests` 增加可选列（幂等迁移）：`team_verified INTEGER NOT NULL DEFAULT 0` 或状态扩展。若避免加列，则用 `status='pending'` + 管理员确认即可。
2. **审核关闭自动通过（ATL）时：**
   - 创建运动员与账号可保留；
   - **不**将该运动员视为「已核实入队」——在审核列表/运动员列表标记 `profile_status` 或新字段 `team_source='self_registered'`；
   - **或**更严：自动通过仅创建 `pending` 账号能力受限（只读本人），入队待确认。为控制范围，**推荐最小方案**：自动通过 + 队伍来源标记 `self_registered`，管理端可筛选，正式统计可按需过滤。
3. **SCC 保持始终人工审核**（不改）。
4. 审核人 `approve` 时写 `team_verified=1`（或等价审计），并允许在审核 UI 更正队伍后再开通。

**文件：`server/core/db-initialize.ts`**

5. 迁移必须幂等、不删数据。

### 3.2 P1-2 开通补写行政归属

**文件：`server/access/registration-service.ts`**

1. ATL 开通创建/关联档案后：
   - 若 `native_place` 解析出省/市，写入 `athlete_origins`（`source='registration'`, `quality='estimated'`），区县可空；
   - 不覆盖已有 `quality='valid'` 归属；
   - 同步 `athletes.region/city/county` 与 origins 保持一致（或依赖现有 trigger/repair，避免双写不一致）。
2. 无籍贯（SCC 或未填）时行为：SCC 仍不建运动员档案；ATL 必填籍贯（现有），应有值。

**验收：** 新注册运动员 `athlete_origins` 行数 +1 或被明确标记为 estimated；P0-2 修复后 SC 可见性不再依赖该字段，但管理报表仍需要。

### 3.3 P1-3 同名精确匹配

若 P0-1 已改为 `(name, project, team)`，本项仅补测试；否则与 P0-1 同改。

### 3.4 P1-4 转队同步 parentUserId

**文件：`server/athlete/athlete-routes.ts`（PUT `/api/admin/athletes/:id`）**

1. 事务内更新队伍后：
   - 读取当前 `account_profiles.parent_user_id`；
   - 若 parent 仍为 SCC/管理岗且 `permissionsAllowProjectTeam`（及 SCC 时队伍权限）覆盖新队伍 → 保留；
   - 否则 `parentUserId` 改为 `currentUser.id` 或同队可管理教练，写审计 `UPDATE_ATHLETE_PARENT`。
2. `replaceAccountScope` 传入的 `parentUserId` 使用校验后的值。

**文件：`server/access/access-routes.ts`（PUT accounts）**

3. 修改运动员队伍/范围时同样重算 parent（已有部分逻辑，补齐不覆盖场景）。

### 3.5 P1-5 coach_athletes 同步策略

**定位：** 保持「展示用主管教练」，**不**升级为授权依据（与文档一致）。

**文件：`access-routes.ts`、`athlete-routes.ts`、`registration-service.ts`**

1. **分配接口** `PUT /api/admin/assignments/:athleteId`：
   - 校验教练对目标运动员 `hasAthleteAccess`（P0-2 后为队伍规则）；
   - 禁止绑定无该队权限的教练。
2. **改 SCC 权限**（PUT accounts）后：
   - 删除该教练 `coach_athletes` 中「运动员不再可见」的行；或全清后按队伍自动重建（推荐：仅清理失效行，避免丢主管指定）。
3. **运动员转队** 时：
   - 非 SCC 操作者：保持现有「清空后按 payload.coachId 重建」；
   - SCC 操作者：若新队伍不包含原教练，删除原 `coach_athletes` 行。
4. 审计：`SYNC_COACH_ATHLETE_BINDINGS`。

### 3.6 P1-6 注册审核区域 containment

**文件：`registration-service.ts` `activateRegistrationRequest`**

1. `reviewer != null` 时，在现有 `permissionsAllowProjectTeam` 外：
   - ATL：目标运动员档案归属（或申请籍贯估计归属）必须落在 reviewer 的 area 范围内（`areaAllowsAthlete` 或等价），**或** reviewer 为 national；
   - 不满足则 `403`，提示超出管辖范围。
2. SCC 开通：新教练 `initializeAccountScope` 的 area 不再简单继承 reviewer.areas[0] 为唯一授权——授权以 **team** 为准（与 P0-2 一致）；area 字段仅作档案信息时可写 `national` 或 reviewer 区域供展示，**不得**限制 SCC 看队。推荐 SCC 直接写入请求队伍对应的 `user_team_permissions`，area 写 national 空行以避免误过滤（若 P0-2 已忽略 SCC area，则写啥都行，但避免误导）。

### 3.7 P1-7 分配与改权一致性

见 3.5；另：

**`access-routes.ts` 分配/取消分配**统一走 `hasAthleteAccess` + 教练必须角色 SCC 且 `canManageAccount`（若适用）。

## 4. 数据库变更（均须幂等）

| 变更 | 用途 |
|---|---|
| `registration_requests.team_verified` 或等价 | P1-1 |
| `athletes.team_source` 或复用 `source` 枚举扩展 | P1-1 标记自注册 |
| 无强制新表 | P1-5 复用 `coach_athletes` |

迁移写在 `server/core/db-initialize.ts` 或独立 migration 函数；**禁止删除真实数据**。

## 5. 测试场景

| 场景 | 预期 |
|---|---|
| 审核关闭注册运动员 | 账号可登录；入队可标记/可筛选；不伪装为已核实 |
| 审核通过（更正队伍后） | 标记已核实；范围更新 |
| 注册开通后查 `athlete_origins` | 有 estimated 归属或明确策略 |
| 运动员转队 | 新队教练可见、旧队教练不可见；parent 合法 |
| 教练改队 | 其 `coach_athletes` 无失效行 |
| 分配他队教练 | 拒绝 |
| 审核人区域不含运动员籍贯 | 拒绝开通（若采用 containment） |
| 回归：SC 看全队（P0-2） | 仍通过 |

## 6. 验收标准

- `npm run check` 通过；注册/权限/运动员路由测试通过。
- 无「前端显示绑定成功但库中关系错误」路径：分配、转队、开户均在事务内写权限表 + 绑定表。
- 文档：`README.md` / `docs/architecture.md` 若行为可见变化则同步（入队核实策略、SC 范围）。

## 7. 明确不改动

- 不引入完整邀请码/审批流产品化（可后续）。
- 不合并多队伍模型为单队伍；支持 SCC 多队（`user_team_permissions` 多行）。
- 不把 `coach_athletes` 改为授权源。
