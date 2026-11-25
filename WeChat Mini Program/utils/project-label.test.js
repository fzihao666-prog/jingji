import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadProjectLabel() {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./project-label.js', import.meta.url), 'utf8'), {
    module,
    require(path) {
      if (path === '../data/register-data') {
        return {
          projects: [
            { code: 'ROWING', label: '赛艇' },
            { code: 'CANOE_SPRINT', label: '皮划艇' },
          ],
        };
      }
      throw new Error(`未预期的依赖：${path}`);
    },
  });
  return module.exports;
}

describe('项目中文标签', () => {
  it('使用共享字典将项目代码映射为中文标签，并保留未知值作为回退', () => {
    const { projectLabel, projectOptions } = loadProjectLabel();

    expect(projectLabel('ROWING')).toBe('赛艇');
    expect(projectLabel('CANOE_SPRINT')).toBe('皮划艇');
    expect(projectLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(projectLabel('')).toBe('未设置');
    expect(projectOptions(['ROWING'])).toEqual([{ code: 'ROWING', label: '赛艇' }]);
  });
});
