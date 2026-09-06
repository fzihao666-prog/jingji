import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function patchFile(relativePath, transform) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    console.log(`MISS ${relativePath}`);
    return;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`OK   ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`FIX  ${relativePath}`);
}

patchFile('src/pages/BluetoothConnectPage.tsx', (source) => {
  return source
    .replace(/user\?\.name\s*\|\|\s*/g, '')
    .replace(/\{user\?\.name \|\| user\?\.username \|\| '当前用户'\}/g, "{user?.username || '当前用户'}");
});

patchFile('src/App.tsx', (source) => {
  let next = source;
  if (!/import\s+\{\s*BluetoothConnectPage\s*\}\s+from\s+['"]\.\/pages\/BluetoothConnectPage['"]/.test(next)) {
    const importPatterns = [
      /import \{ AccountAuditPage \} from ['"]\.\/pages\/AccountAuditPage['"];?/,
      /import \{ WeeklyTrainingPlanPage \} from ['"]\.\/pages\/WeeklyTrainingPlanPage['"];?/,
      /import \{ TrainingPlanPage \} from ['"]\.\/pages\/TrainingPlanPage['"];?/
    ];
    let inserted = false;
    for (const pattern of importPatterns) {
      if (pattern.test(next)) {
        next = next.replace(pattern, (match) => `${match}\nimport { BluetoothConnectPage } from './pages/BluetoothConnectPage';`);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      next = `import { BluetoothConnectPage } from './pages/BluetoothConnectPage';\n${next}`;
    }
  }

  if (!next.includes("page === 'bluetooth'")) {
    const renderPatterns = [
      /(\s*\{page === ['"]accountAudit['"] && <AccountAuditPage[^\n]+\/>\})/,
      /(\s*\{page === ['"]weeklyPlan['"] && <WeeklyTrainingPlanPage[^\n]+\/>\})/,
      /(\s*\{page === ['"]plans['"] && <TrainingPlanPage[^\n]+\/>\})/
    ];
    for (const pattern of renderPatterns) {
      if (pattern.test(next)) {
        next = next.replace(pattern, `$1\n        {page === 'bluetooth' && <BluetoothConnectPage user={user} />}`);
        break;
      }
    }
  }
  return next;
});

console.log('\nTypeScript 报错修复完成。请继续运行：');
console.log('npm run check');
console.log('npm run build');
console.log('/home/fanzh/deploy/restart-jingji.sh');
