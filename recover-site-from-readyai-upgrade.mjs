import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function full(relativePath) {
  return path.join(root, relativePath);
}

function patchFile(relativePath, transform) {
  const file = full(relativePath);
  if (!fs.existsSync(file)) {
    console.log(`MISS ${relativePath}`);
    return;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (before === after) {
    console.log(`OK   ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`FIX  ${relativePath}`);
}

patchFile('src/App.tsx', (source) => {
  return source
    .replace(/\n?import\s+\{\s*PublicLandingPage\s*\}\s+from\s+['"]\.\/pages\/PublicLandingPage['"];?/g, '')
    .replace(/return\s+<PublicLandingPage>(\s*<LoginPage[\s\S]*?\/>\s*)<\/PublicLandingPage>;/g, 'return $1;')
    .replace(/(<PublicLandingPage>)(\s*<LoginPage[\s\S]*?\/>\s*)(<\/PublicLandingPage>)/g, '$2');
});

patchFile('src/styles.css', (source) => {
  const marker = '/* ReadyAI-inspired public upgrade */';
  const index = source.indexOf(marker);
  if (index === -1) return source;
  return source.slice(0, index).trimEnd() + '\n';
});

const landingFile = full('src/pages/PublicLandingPage.tsx');
if (fs.existsSync(landingFile)) {
  const disabledFile = `${landingFile}.disabled-${Date.now()}`;
  fs.renameSync(landingFile, disabledFile);
  console.log(`MOVE src/pages/PublicLandingPage.tsx -> ${path.basename(disabledFile)}`);
} else {
  console.log('OK   src/pages/PublicLandingPage.tsx absent');
}

console.log('\n已撤回 ReadyAI 风格入口页升级。请继续运行：');
console.log('npm run check');
console.log('npm run build');
console.log('/home/fanzh/deploy/restart-jingji.sh');
