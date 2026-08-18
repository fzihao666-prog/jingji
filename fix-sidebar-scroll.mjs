import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cssPath = path.join(root, 'src/styles.css');

if (!fs.existsSync(cssPath)) {
  console.error('找不到 src/styles.css，请在项目根目录运行。');
  process.exit(1);
}

const patch = `

/* Sidebar scroll fix */
.app-shell,
.shell,
.dashboard-shell,
.app-layout {
  min-height: 100vh;
}

.sidebar,
.app-sidebar,
.side-nav,
.navigation-sidebar,
aside {
  max-height: 100vh;
  overflow: hidden;
}

.sidebar nav,
.app-sidebar nav,
.side-nav nav,
.navigation-sidebar nav,
.sidebar-menu,
.nav-menu,
.app-nav,
.main-nav,
.sidebar-scroll,
aside nav {
  min-height: 0;
  max-height: calc(100vh - 250px);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(126, 232, 220, .55) transparent;
}

.sidebar nav::-webkit-scrollbar,
.app-sidebar nav::-webkit-scrollbar,
.side-nav nav::-webkit-scrollbar,
.navigation-sidebar nav::-webkit-scrollbar,
.sidebar-menu::-webkit-scrollbar,
.nav-menu::-webkit-scrollbar,
.app-nav::-webkit-scrollbar,
.main-nav::-webkit-scrollbar,
.sidebar-scroll::-webkit-scrollbar,
aside nav::-webkit-scrollbar {
  width: 6px;
}

.sidebar nav::-webkit-scrollbar-thumb,
.app-sidebar nav::-webkit-scrollbar-thumb,
.side-nav nav::-webkit-scrollbar-thumb,
.navigation-sidebar nav::-webkit-scrollbar-thumb,
.sidebar-menu::-webkit-scrollbar-thumb,
.nav-menu::-webkit-scrollbar-thumb,
.app-nav::-webkit-scrollbar-thumb,
.main-nav::-webkit-scrollbar-thumb,
.sidebar-scroll::-webkit-scrollbar-thumb,
aside nav::-webkit-scrollbar-thumb {
  background: rgba(126, 232, 220, .5);
  border-radius: 999px;
}

@media (max-height: 820px) {
  .sidebar nav,
  .app-sidebar nav,
  .side-nav nav,
  .navigation-sidebar nav,
  .sidebar-menu,
  .nav-menu,
  .app-nav,
  .main-nav,
  .sidebar-scroll,
  aside nav {
    max-height: calc(100vh - 190px);
  }
}
`;

const source = fs.readFileSync(cssPath, 'utf8');

if (source.includes('Sidebar scroll fix')) {
  console.log('侧边栏滚动修复已经存在，无需重复添加。');
} else {
  fs.writeFileSync(cssPath, `${source.trimEnd()}\n${patch}\n`);
  console.log('已添加侧边栏滚动修复到 src/styles.css');
}

console.log('\n请继续运行：');
console.log('npm run check');
console.log('npm run build');
console.log('/home/fanzh/deploy/restart-jingji.sh');
