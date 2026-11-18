import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('页面上下文并发', () => {
  it('项目保存尚未完成时，新页面继续使用刚选择的项目', async () => {
    const app = {
      globalData: {
        token: 'test-token', user: { role: 'SCC' }, currentProject: '皮划艇',
        pendingProject: '皮划艇', selectedAthleteId: 2
      },
      setProject(project) { this.globalData.currentProject = project; }
    };
    const api = {
      currentProject: async () => ({ project: '赛艇', projects: ['赛艇', '皮划艇'] }),
      athletes: async () => ({ athletes: [{ id: 2, project: '皮划艇' }] })
    };
    const context = { module: { exports: {} }, require: () => api, getApp: () => app, wx: { setStorageSync() {} }, Promise };
    vm.runInNewContext(readFileSync(new URL('./context.js', import.meta.url), 'utf8'), context);
    expect((await context.module.exports.loadContext()).project).toBe('皮划艇');
  });

  it('旧请求结束时保留期间更新的项目和运动员选择', async () => {
    let finishProject;
    const app = {
      globalData: {
        token: 'test-token', user: { role: 'SCC', athleteId: 0 },
        currentProject: '赛艇', selectedAthleteId: 1
      },
      setProject(project) { this.globalData.currentProject = project; }
    };
    const api = {
      currentProject: () => new Promise((resolve) => { finishProject = resolve; }),
      athletes: async () => ({ athletes: [{ id: 1, project: '赛艇' }, { id: 2, project: '皮划艇' }] })
    };
    const context = {
      module: { exports: {} }, require: () => api,
      getApp: () => app, wx: { setStorageSync() {} }, Promise
    };
    vm.runInNewContext(readFileSync(new URL('./context.js', import.meta.url), 'utf8'), context);
    const loading = context.module.exports.loadContext();
    app.setProject('皮划艇');
    app.globalData.selectedAthleteId = 2;
    finishProject({ project: '赛艇', projects: ['赛艇', '皮划艇'] });
    const result = await loading;
    expect(result.project).toBe('皮划艇');
    expect(result.selectedAthleteId).toBe(2);
    expect(app.globalData.currentProject).toBe('皮划艇');
  });
});


it('观察员复用正常页面上下文和已授权队伍数据', async () => {
  const app = { globalData: { token: 'token', user: { role: 'OBS' } }, setProject(project) { this.globalData.currentProject = project; } };
  const api = { currentProject: vi.fn(async () => ({ project: 'ROWING', projects: ['ROWING'] })), athletes: vi.fn(async () => ({ athletes: [{ id: 1, project: 'ROWING' }] })) };
  const wx = { reLaunch: vi.fn() };
  const context = { module: { exports: {} }, require: () => api, getApp: () => app, wx };
  vm.runInNewContext(readFileSync(new URL('./context.js', import.meta.url), 'utf8'), context);
  const result = await context.module.exports.loadContext();
  expect(result.user.role).toBe('OBS');
  expect(result.athletes).toHaveLength(1);
  expect(wx.reLaunch).not.toHaveBeenCalled();
});
