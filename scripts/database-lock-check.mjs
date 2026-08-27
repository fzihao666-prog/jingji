import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'database-lock-check.db');
const ports = [8795, 8796];
const cleanupTargets = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
for (const target of cleanupTargets) {
  if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
}

function startServer(port) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, port, output: () => output };
}
const processes = ports.map(startServer);

async function stopServer(target) {
  if (target.child.exitCode !== null) return;
  target.child.kill('SIGTERM');
  await new Promise((done) => target.child.once('exit', done));
}

async function waitForServer(target) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (target.child.exitCode !== null) throw new Error(`端口 ${target.port} 的进程提前退出：\n${target.output()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin01', password: 'demo123' })
      });
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  throw new Error(`端口 ${target.port} 启动超时：\n${target.output()}`);
}

try {
  try {
    await Promise.all(processes.map(waitForServer));
    if (processes.some((target) => /database is locked/i.test(target.output()))) throw new Error('并发初始化仍出现数据库锁错误');
  } finally {
    for (const target of processes) await stopServer(target);
  }

  const verifier = startServer(8797);
  try {
    const login = await waitForServer(verifier);
    const response = await fetch('http://127.0.0.1:8797/api/records?from=2020-01-01&to=2100-12-31&project=%E8%B5%9B%E8%89%87', {
      headers: { authorization: `Bearer ${login.token}` }
    });
    const payload = await response.json();
    if (!response.ok || !payload.records?.length) throw new Error(`并发初始化后的数据库校验失败：${response.status} ${JSON.stringify(payload)}`);
    console.log(JSON.stringify({ concurrentInitializers: processes.length, verifiedRecords: payload.records.length, databaseLock: 'resolved' }, null, 2));
  } finally {
    await stopServer(verifier);
  }
} finally {
  for (const target of cleanupTargets) {
    if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
  }
}
