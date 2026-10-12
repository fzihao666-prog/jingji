# 教练责任范围按队伍自动确定

## Why

业务规则是“教练负责队伍，即负责该队全部运动员”。当前服务端按账号区域、项目、队伍授权访问运动员，但教练管理、运动员名册和档案通过 `coach_athletes` 维护另一套逐人关系，导致可访问名单与负责名单不一致，并要求重复调配。

## What Changes

- 以教练有效项目与队伍授权、运动员当前队伍归属为唯一责任关系来源，取消逐人分配。
- 统一教练人数、名单、运动员教练信息和 API 返回口径；入队、离队、转队后自动生效。
- 移除教练“调配”及运动员逐人选教练入口，保留独立的行政归属编辑能力。
- **权限行为变化**：SCC 对已授权队伍全员负责，不再按队内运动员生源行政区二次过滤；上级管理角色的区域限制、授权委派校验、ATL 本人限制保持原有规则。此项必须作为权限变更单独审查。
- 保留旧关系表和历史记录，停止在线业务读写，禁止将旧逐人关系自动扩成整队授权。

## Capabilities

### New Capabilities

- `coach-team-responsibility`：队伍派生责任关系、统一展示、旧接口兼容和权限隔离。

### Modified Capabilities

- 无现有主规格可直接修改，本次新增 delta 规格；相关运行说明与架构文档在实施时更新。

## Impact

- 服务端：`server/core/permissions.ts`、`server/access/`、`server/athlete/`、`server/data-import/data-import.ts`、`server/core/db-initialize.ts`。
- 浏览器端：`src/pages/CoachManagementPage.tsx`、`RosterPage.tsx`、`AthleteManagementPage.tsx`、`src/api.ts`、`src/types.ts`，以及引用教练字段的消费者。
- 文档：`README.md`、`docs/architecture.md`；必要的定向 API 与单元回归。
- 不增加依赖，不修改正式训练事实，不删除旧表、不重建数据库。本次交付仅为规格，不实施代码。
