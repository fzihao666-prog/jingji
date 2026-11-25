import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'athlete-profile-check.db');
const port = 8796;
const base = `http://127.0.0.1:${port}`;
for (const target of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`])
  if (existsSync(target)) rmSync(target);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverError = '';
server.stderr.on('data', (chunk) => {
  serverError += chunk.toString();
});
const assert = (value, message) => {
  if (!value) throw new Error(message);
};

async function waitForServer() {
  for (let index = 0; index < 250; index += 1) {
    try {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin01', password: 'demo123' }),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  throw new Error(`server failed: ${serverError}`);
}

async function json(path, token) {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

try {
  await waitForServer();
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin01', password: 'demo123' }),
  });
  const { token } = await login.json();
  const athletes = (await json('/api/athletes', token)).payload.athletes;
  const athlete = athletes.find((item) => item.project && item.team) || athletes[0];
  assert(athlete, 'seed athlete missing');
  const params = new URLSearchParams({
    from: '2026-07-01',
    to: '2026-07-31',
    project: athlete.project,
  });
  const wellness = await json(`/api/athletes/${athlete.id}/wellness-trends?${params}`, token);
  assert(wellness.status === 200, `wellness trends request failed: ${wellness.status}`);
  assert(Array.isArray(wellness.payload.trends), 'wellness trends must be an array');
  assert(
    wellness.payload.trends.every((trend) =>
      trend.points.every((point) => point.personalValue !== 0 || point.hasPersonalValue)
    ),
    'missing wellness was coerced to zero'
  );
  const comparison = await json(`/api/athletes/${athlete.id}/profile-comparison?${params}`, token);
  assert(comparison.status === 200, `profile comparison request failed: ${comparison.status}`);
  assert(
    comparison.payload.comparison.scope.project === athlete.project,
    'comparison project scope mismatch'
  );
  assert(
    comparison.payload.comparison.items.every(
      (item) => item.teamSampleCount === null || item.teamSampleCount >= 2
    ),
    'single-athlete team comparison leaked'
  );
  const special = await json(
    `/api/special-tests?${new URLSearchParams({ ...Object.fromEntries(params), athleteId: String(athlete.id) })}`,
    token
  );
  assert(special.status === 200, `athlete special tests request failed: ${special.status}`);
  assert(
    special.payload.events.every((event) =>
      event.results.every((result) => result.memberAthleteIds.includes(athlete.id))
    ),
    'special test filter leaked unrelated crews'
  );
  console.log(
    JSON.stringify({
      athleteId: athlete.id,
      trendCount: wellness.payload.trends.length,
      comparisonCount: comparison.payload.comparison.items.length,
      status: 'ok',
    })
  );
} finally {
  server.kill();
  await new Promise((resolveExit) => server.once('exit', resolveExit));
  for (const target of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`])
    if (existsSync(target)) rmSync(target);
}
