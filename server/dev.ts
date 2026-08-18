import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const node = process.execPath;
const children = [
  spawn(node, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'server/index.ts'], { stdio: 'inherit', cwd: root }),
  spawn(node, [resolve(root, 'node_modules/vite/bin/vite.js')], { stdio: 'inherit', cwd: root })
];

function shutdown() {
  for (const child of children) child.kill();
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const child of children) child.on('exit', (code) => {
  if (typeof code === 'number' && code !== 0) shutdown();
});
