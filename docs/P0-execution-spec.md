# 竞迹｜P0 执行 Spec：注册身份绑定加固 + 教练队伍授权

## 1. 需求目标

修复审查确认的两项 P0 问题：

1. **注册按姓名静默绑定既有运动员档案**，存在冒名接管历史数据风险。
2. **队伍教练被行政区域过度过滤**，看不到本队大部分运动员。

本轮允许改代码与测试；**不改生产数据、不做破坏性重构**。

## 2. P0-1 注册身份绑定加固

### 2.1 现状（已证实）

`server/access/registration-service.ts` 中 `activateRegistrationRequest`：

```sql
SELECT a.id, a.project, COALESCE(pt.name, '') AS team
FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
WHERE a.name = ?
```

- 仅用 `display_name` 匹配，不校验出生日期、性别。
- 命中同项目同队且无账号的档案后直接 `athleteId = athlete.id` 关联。
- 审核关闭时（`auth-routes.ts` 中 `!registrationApprovalEnabled() && role==='ATL'`）立即自动开通，可被直接利用。
- 查询未限定 project/team，同名跨队时 `.get()` 结果不确定。

### 2.2 目标行为

| 场景 | 预期 |
|---|---|
| 姓名 + 项目 + 队伍 + 性别 + 出生日期 与既有档案一致，且无登录账号 | 允许关联该档案（唯一允许的静默关联路径） |
| 姓名命中但性别或出生日期不一致 | **拒绝关联**，按「新建档案」处理或返回需管理员核对的错误（见 2.3） |
| 姓名命中但项目/队伍不一致 | 明确报错（保持现有文案方向），不得绑到错误档案 |
| 姓名未命中 | 新建 `athletes` 行为保持不变 |
| 该档案已有 ATL 账号 | 拒绝（保持现有） |
| **系统自动开通（无审核人）** | **禁止绑定任何既有档案**，一律新建；若 `(name, project, team)` 唯一索引冲突则失败并提示 |
| 人工审核通过 | 仅在 2.2 第一行条件满足时才可关联既有档案 |

### 2.3 详细改动

**文件：`server/access/registration-service.ts`**

1. 匹配查询改为按 `(name, project, team)` 精确匹配（用 `project_teams` 解析 `team_id` 后按 `team_id` 或 `project+team` 过滤），消除跨队同名误匹配。
2. 匹配到候选档案后，增加身份一致性判定：
   - `request.gender` 与 `athletes.gender`：两边均非空时必须全等；档案侧为空则允许补写。
   - `request.birth_date` 与 `athletes.birth_date`：两边均非空时必须全等；档案侧为空则允许补写。
   - 任一不一致 → 不关联。自动开通路径：抛出/返回可理解错误（如「姓名与既有档案身份信息不一致，已暂停自动开通，请联系管理员」），**不得**新建同名同队行（会撞 `idx_athletes_identity`），也不得绑到旧档案。人工审核路径：同上，要求管理员先更正档案或申请信息。
3. `reviewer === null`（系统自动开通）时跳过既有档案分支，只走新建；若新建撞唯一索引则 `ROLLBACK` 并返回明确错误。
4. 补写 `birth_date`/`gender` 的 `COALESCE` 逻辑保持「不覆盖档案已有非空值」。

**文件：`server/access/auth-routes.ts`**

5. 自动开通失败时不要静默降级为 `pending` 却无提示——当前 `activation.ok === false` 会返回 pending 文案。改为：自动开通因身份冲突失败时返回 `409/400` + 明确 message（或 `status:'pending'` + 明确「需人工核对」文案，二选一，以「用户可知原因」为准，推荐直接错误码更清晰）。

**不改：** 表结构、`users` 创建、`initializeAccountScope`、审核开关语义（SCC 始终 pending）。

### 2.4 测试场景

| 用例 | 预期 |
|---|---|
| 同名+同队+同性别+同生日，档案无账号，人工审核 | 关联成功，不新建档案 |
| 同名+同队，生日不同 | 不关联；自动开通报错/不通过；不产生错误绑定 |
| 同名+同队，性别不同 | 同上 |
| 同名，项目或队伍不同 | 报错指向档案所在项目队伍（或不关联并新建失败），不绑错 |
| 自动开通 + 既有同名同队档案 | 不静默绑定；用户收到需核对提示 |
| 自动开通 + 无同名 | 新建成功，流程与现网一致 |
| 同名已有 ATL 账号 | 拒绝（回归） |
| 同名跨两队各一档案 | 按申请的 project+team 精确命中，不受另一条影响 |

### 2.5 验收标准

- 单测覆盖上表；`npm run check` 通过。
- 代码中不再出现仅 `WHERE a.name = ?` 的绑定查询。
- 自动开通路径无法把新密码账号挂到既有运动员历史数据上。

## 3. P0-2 教练授权改为队伍优先

### 3.1 现状（已证实）

`server/core/permissions.ts`：

```ts
return areaAllowed && projectAllowed && teamAllowed;
```

`accessibleAthleteIds` 用 `athlete_origins` 作为 `region`。队伍教练（SCC）也被 area 约束。真实库验证：`coach01`（ROWING 女/男队，区域四川+浙江）在「女子双桨组」仅见约 15/50 人。

### 3.2 目标行为

| 角色 | 数据范围 |
|---|---|
| ATL | 仅本人（保持） |
| **SCC** | **本人 `user_team_permissions` 覆盖的项目+队伍内全部运动员**；**不做行政区域过滤** |
| REG / TD / DMD | 保持 area ∧ project ∧ team 三元组（管理/报表视图） |

同队两名教练均可见全队；外队教练不可见；跨项目队伍隔离保持。

### 3.3 详细改动

**文件：`server/core/permissions.ts`**

1. `accessibleAthleteIds(user)`：
   - `user.role === 'SCC'` 时，筛选条件改为 **projectAllowed ∧ teamAllowed**（跳过 area）。
   - 其他非 ATL 角色保持 `permissionsAllowAthlete`。
2. `hasAthleteAccess` 继续委托 `accessibleAthleteIds`，自动继承。
3. **不要**在 `permissionsAllowAthlete` 内写死跳过 area——该函数也被 `athlete-module.ts`（运动员档案地区校验）和 `access-routes.ts`（分配校验）使用，语义是「权限三元组是否覆盖该运动员」。新增可选参数或独立助手更安全，例如：

```ts
function permissionsAllowAthleteByTeam(permissions, athlete) {
  // projectAllowed && teamAllowed，忽略 area
}
```

   `accessibleAthleteIds` 对 SCC 用 `permissionsAllowAthleteByTeam`，其余用 `permissionsAllowAthlete`。

4. **调用点审查（改动后必须回归）**：所有 `hasAthleteAccess` / `accessibleAthleteIds` 调用方行为应随 SCC 变宽（这是预期）。`permissionsAllowAthlete` 直接调用点保持原语义：
   - `athlete-module.ts:108`：档案地区是否超出账号权限——**保持 area 校验**（运动员档案归属仍受管理范围约束）。
   - `access-routes.ts:503`：分配时目标范围是否在操作者权限内——对 SCC 分配场景改为与可见性一致（见 P1）；本 P0 可先让 SCC 在「已可见运动员」上操作范围更合理，但分配接口的 `permissionsAllowAthlete` 若仍要求 area，会挡住 SCC 对外省队员的分配。**本 P0 应用同一 `permissionsAllowAthleteByTeam` 规则到「操作者为 SCC」的分配/维护路径**，或统一改为 `hasAthleteAccess`。

**推荐实现（最小一致面）：**

- 导出 `athleteVisibleToUser(user, athlete)` 或扩展 `hasAthleteAccess`。
- 详情/列表/写接口继续用 `hasAthleteAccess`（自动对 SCC 忽略 area）。
- `athlete-module.ts` 的「地区不能超出账号权限」保留 area 语义（针对 REG+ 设档）。

**不改：** `user_area_permissions` 数据、REG/TD/DMD 行为、ATL 特例、`coach_athletes`。

### 3.4 测试场景

| 用例 | 预期 |
|---|---|
| SCC + 四川省权限 + 本队天津籍贯运动员 | **可见**（修复前不可见） |
| SCC + 本队全部运动员 | 可见人数 = 本队 active 人数 |
| SCC + 他队运动员 | 不可见 |
| SCC + 他项目同名队伍 | 不可见（项目过滤） |
| ATL | 仅本人 |
| TD/DMD + 非管辖区域运动员 | 不可见（area 仍生效） |
| REG + 跨省运动员 | 不可见（area 仍生效） |
| 列表 / 详情 / 训练计划 / 力量 / 专项 | 对 SCC 行为一致 |

### 3.5 验收标准

- 用真实库逻辑或 fixture 断言：SCC 对本队任意 `athlete_origins` 均可 `hasAthleteAccess === true`。
- `npm run check` 通过；相关既有测试不回归（若有断言「SCC 因区域看不到」的用例，按新规则更新）。

## 4. 明确不改动

- 不删 `coach_athletes`，不改 Web/小程序表单。
- 不改注册审核开关「SCC 始终 pending」。
- 不跑生产库迁移；不删数据。

## 5. 实施顺序与验证

1. 先做 P0-2（纯权限判定，影响面清晰）→ 跑 `npm run check` + 权限相关测试。
2. 再做 P0-1（注册激活）→ 补/改 `registration-service.test.ts`、`auth-routes.test.ts`。
3. 交付时列出改动文件、测试结果、剩余风险（同名真实双胞胎/同日同性别需管理员后台认领流程，属 P1）。
