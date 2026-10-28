import express from 'express';
import type { SportRules, SPORT_MODULES } from '../../shared/sport-rules.ts';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { registerSportRulesRoutes } from './sport-rules-routes.ts';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

it('项目配置需要登录和项目权限，返回规则版本且不缓存', async () => {
  const app = express();
  let referenceAvailable = false;
  registerSportRulesRoutes(app, {
    requireAuth: (req, res, next) => {
      if (!req.headers.authorization) { res.status(401).json({ message: '请先登录' }); return; }
      next();
    },
    projects: () => ['VOLLEYBALL'],
    referenceAvailable: () => referenceAvailable,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/rules`;
  expect((await fetch(`${url}?project=VOLLEYBALL`)).status).toBe(401);
  const headers = { Authorization: 'synthetic' };
  expect((await fetch(`${url}?project=ROWING`, { headers })).status).toBe(403);
  expect((await fetch(`${url}?project=toString`, { headers })).status).toBe(400);
  const response = await fetch(`${url}?project=排球`, { headers });
  expect(response.headers.get('cache-control')).toBe('no-store');
  const data = await response.json() as { rules: SportRules; modules: typeof SPORT_MODULES };
  expect(data.rules.project).toBe('VOLLEYBALL');
  expect(data.rules.version).toBe('multi-sport-v3');
  expect(data.modules.find(row => row.key === 'fitness')?.kind).toBe('common');
  expect(data.rules.capabilities.reference.status).toBe('pending_configuration');
  referenceAvailable = true;
  const configured = await (await fetch(`${url}?project=VOLLEYBALL`, { headers })).json() as { rules: SportRules };
  expect(configured.rules.capabilities.reference.status).toBe('available');
});
