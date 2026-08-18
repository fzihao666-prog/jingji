import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function file(filePath) {
  return path.join(root, filePath);
}

function exists(filePath) {
  return fs.existsSync(file(filePath));
}

function read(filePath) {
  return fs.readFileSync(file(filePath), 'utf8');
}

function write(filePath, source) {
  fs.writeFileSync(file(filePath), source);
}

function log(status, message) {
  console.log(`${status} ${message}`);
}

function ensureImportIcon(source) {
  if (source.includes('BluetoothConnected')) return source;
  return source.replace(
    /import\s*\{([\s\S]*?)\}\s*from ['"]lucide-react['"];?/,
    (_match, body) => {
      const icons = body.split(',').map((item) => item.trim()).filter(Boolean);
      icons.push('BluetoothConnected');
      return `import {\n  ${icons.join(',\n  ')}\n} from 'lucide-react';`;
    }
  );
}

function ensurePageKey(source) {
  if (source.includes("'bluetooth'")) return source;
  return source.replace(
    /(type\s+PageKey\s*=\s*)([^;]+)(;)/,
    (_match, prefix, union, suffix) => `${prefix}${union} | 'bluetooth'${suffix}`
  );
}

function ensureNav(source) {
  if (source.includes("label: '蓝牙连接'")) return source;
  const navItem = "  { key: 'bluetooth', label: '蓝牙连接', icon: BluetoothConnected },";
  const accountAuditPattern = /(\n\s*\{\s*key:\s*['"]accountAudit['"][^}]*\},?)/;
  const weeklyPattern = /(\n\s*\{\s*key:\s*['"]weeklyPlan['"][^}]*\},?)/;
  const plansPattern = /(\n\s*\{\s*key:\s*['"]plans['"][^}]*\},?)/;
  if (accountAuditPattern.test(source)) return source.replace(accountAuditPattern, `$1\n${navItem}`);
  if (weeklyPattern.test(source)) return source.replace(weeklyPattern, `$1\n${navItem}`);
  if (plansPattern.test(source)) return source.replace(plansPattern, `$1\n${navItem}`);
  return source;
}

function ensureRouteImport(source) {
  if (/import\s+\{\s*BluetoothConnectPage\s*\}/.test(source)) return source;
  const imports = [
    /import \{ AccountAuditPage \} from ['"]\.\/pages\/AccountAuditPage['"];?/,
    /import \{ WeeklyTrainingPlanPage \} from ['"]\.\/pages\/WeeklyTrainingPlanPage['"];?/,
    /import \{ TrainingPlanPage \} from ['"]\.\/pages\/TrainingPlanPage['"];?/
  ];
  for (const pattern of imports) {
    if (pattern.test(source)) {
      return source.replace(pattern, (match) => `${match}\nimport { BluetoothConnectPage } from './pages/BluetoothConnectPage';`);
    }
  }
  return `import { BluetoothConnectPage } from './pages/BluetoothConnectPage';\n${source}`;
}

function ensureRouteRender(source) {
  if (source.includes("page === 'bluetooth'")) return source;
  const patterns = [
    /(\s*\{page === ['"]accountAudit['"] && <AccountAuditPage[^\n]+\/>\})/,
    /(\s*\{page === ['"]weeklyPlan['"] && <WeeklyTrainingPlanPage[^\n]+\/>\})/,
    /(\s*\{page === ['"]plans['"] && <TrainingPlanPage[^\n]+\/>\})/
  ];
  for (const pattern of patterns) {
    if (pattern.test(source)) {
      return source.replace(pattern, `$1\n        {page === 'bluetooth' && <BluetoothConnectPage user={user} />}`);
    }
  }
  return source;
}

function ensureCss(source) {
  if (source.includes('Bluetooth connection module')) return source;
  const css = `

/* Bluetooth connection module */
.bluetooth-page { gap: 18px; }
.bluetooth-heading { align-items: flex-start; gap: 18px; }
.bluetooth-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.bluetooth-actions button,.bluetooth-command-row button { display: inline-flex; align-items: center; gap: 7px; }
.spin { animation: bluetooth-spin 1s linear infinite; }
@keyframes bluetooth-spin { to { transform: rotate(360deg); } }
.bluetooth-status-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
.bluetooth-status-card { min-height: 112px; padding: 16px; border: 1px solid #d7e5e7; background: #fff; box-shadow: 0 12px 32px rgba(12,55,67,.05); display: flex; flex-direction: column; justify-content: space-between; }
.bluetooth-status-card span { display: flex; align-items: center; gap: 7px; color: #67818a; font-size: 12px; font-weight: 800; }
.bluetooth-status-card strong { margin-top: 10px; color: #0b3947; font: 900 24px "Bahnschrift","Microsoft YaHei UI",sans-serif; word-break: break-word; }
.bluetooth-status-card small { margin-top: 8px; color: #789098; line-height: 1.5; }
.bluetooth-warning { padding: 14px 16px; border: 1px solid #f0c9bf; background: #fff7f4; color: #8f3e2c; display: flex; gap: 10px; align-items: flex-start; }
.bluetooth-warning strong { display: block; color: #7b3022; }
.bluetooth-warning p { margin: 4px 0 0; color: #9b5a49; }
.bluetooth-panel,.bluetooth-log-panel { border: 1px solid #d7e5e7; background: #fff; box-shadow: 0 12px 32px rgba(12,55,67,.05); }
.bluetooth-chip { padding: 7px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; color: #6c8188; background: #edf4f5; font-size: 12px; font-weight: 900; }
.bluetooth-chip.connected { color: #0e665d; background: #dff4f1; }
.bluetooth-form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.bluetooth-form-grid label { display: grid; gap: 6px; color: #5e747c; font-size: 12px; font-weight: 800; }
.bluetooth-form-grid input,.bluetooth-form-grid select { width: 100%; border: 1px solid #cfdfe2; border-radius: 8px; padding: 10px 11px; color: #123845; background: #fff; font: inherit; }
.bluetooth-form-grid input:disabled { color: #70868d; background: #f3f7f8; }
.bluetooth-command-row { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px; }
.bluetooth-log-list { display: grid; gap: 8px; }
.bluetooth-log-list div { padding: 10px 12px; border: 1px solid #e0eaec; border-radius: 8px; color: #244a55; background: #f8fbfb; font-family: "SFMono-Regular","Consolas",monospace; font-size: 12px; }
.bluetooth-empty { min-height: 120px; display: grid; place-items: center; color: #7b8e95; background: #f6f9fa; border: 1px dashed #ccdadd; }
@media (max-width: 980px) {
  .bluetooth-status-grid,.bluetooth-form-grid { grid-template-columns: 1fr; }
  .bluetooth-actions { width: 100%; }
}
`;
  return `${source.trimEnd()}\n${css}\n`;
}

const required = [
  'src/pages/BluetoothConnectPage.tsx',
  'src/components/AppShell.tsx',
  'src/App.tsx',
  'src/styles.css'
];

for (const item of required) {
  log(exists(item) ? 'OK ' : 'MISS', item);
}

if (!exists('src/pages/BluetoothConnectPage.tsx')) {
  if (exists('install-bluetooth-module.mjs')) {
    log('INFO', 'Bluetooth page missing. Run: node install-bluetooth-module.mjs');
    process.exit(2);
  }
  log('ERR', 'Bluetooth page and install script are missing.');
  process.exit(2);
}

let appShell = read('src/components/AppShell.tsx');
const appShellBefore = appShell;
appShell = ensureImportIcon(appShell);
appShell = ensurePageKey(appShell);
appShell = ensureNav(appShell);
write('src/components/AppShell.tsx', appShell);
log(appShell === appShellBefore ? 'OK ' : 'FIX', 'src/components/AppShell.tsx');

let app = read('src/App.tsx');
const appBefore = app;
app = ensureRouteImport(app);
app = ensureRouteRender(app);
write('src/App.tsx', app);
log(app === appBefore ? 'OK ' : 'FIX', 'src/App.tsx');

let css = read('src/styles.css');
const cssBefore = css;
css = ensureCss(css);
write('src/styles.css', css);
log(css === cssBefore ? 'OK ' : 'FIX', 'src/styles.css');

console.log('\n检查关键词：');
for (const [name, source] of [
  ['AppShell', appShell],
  ['App', app],
  ['styles', css]
]) {
  console.log(`${name}: 蓝牙连接=${source.includes('蓝牙连接')} bluetooth=${source.includes('bluetooth')} BluetoothConnectPage=${source.includes('BluetoothConnectPage')}`);
}

console.log('\n如果上面有 FIX，请继续运行：');
console.log('npm run check');
console.log('npm run build');
console.log('/home/fanzh/deploy/restart-jingji.sh');
