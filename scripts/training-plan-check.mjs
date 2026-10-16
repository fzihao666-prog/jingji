import { spawnSync } from 'node:child_process';

// 旧个人计划写入已停用；定向验证统一队伍计划、历史兼容和执行关联，全部使用合成数据。
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'server/training-plan/team-plan.test.ts',
    'server/training-plan/team-plan-routes.test.ts',
    'server/training-plan/legacy-plan-retirement.test.ts',
    'server/training-plan/training-plan-catalog.test.ts',
    'server/__tests__/training-plan-links.test.ts',
    'server/__tests__/plan-execution.test.ts',
    'server/__tests__/plan-today.test.ts',
  ],
  { stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
