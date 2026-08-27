import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const root = process.cwd();
const node = process.execPath;
function portIsAvailable(port: number) {
  const hostIsListening = (host: string) => new Promise<boolean>((done) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const finish = (listening: boolean) => { if (settled) return; settled = true; socket.destroy(); done(listening); };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
  return Promise.all([hostIsListening('127.0.0.1'), hostIsListening('::1')]).then((results) => !results.some(Boolean));
}

const requiredPorts = [8787, 5173];
const blockedPorts = (await Promise.all(requiredPorts.map(async (port) => ({ port, available: await portIsAvailable(port) }))))
  .filter((item) => !item.available)
  .map((item) => item.port);
if (blockedPorts.length) {
  console.error(`开发服务未启动：端口 ${blockedPorts.join('、')} 已被占用。请关闭已运行的项目进程后重试。`);
  process.exit(1);
}

const children = [
  spawn(node, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'server/index.ts'], { stdio: 'inherit', cwd: root }),
  spawn(node, [resolve(root, 'node_modules/vite/bin/vite.js')], { stdio: 'inherit', cwd: root })
];

let shuttingDown = false;
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.race([
    Promise.all(children.map((child) => new Promise<void>((done) => {
      if (child.exitCode !== null) return done();
      child.once('exit', () => done());
      child.kill('SIGTERM');
    }))),
    new Promise<void>((done) => setTimeout(done, 3000))
  ]);
  process.exit(exitCode);
}

process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });
for (const child of children) child.on('exit', (code) => {
  if (typeof code === 'number' && code !== 0) void shutdown(code);
});
