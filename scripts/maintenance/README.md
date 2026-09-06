# 历史维护脚本

本目录保存一次性修复、恢复和验证工具，不属于常规开发、构建或部署流程。

- `fix-sidebar-scroll.mjs`：为历史样式追加侧边栏滚动修复。
- `fix-bluetooth-ts-errors.mjs`：修复旧版蓝牙模块的 TypeScript 兼容问题。
- `install-bluetooth-module.mjs`：补装缺失的历史蓝牙页面模块。
- `recover-site-from-readyai-upgrade.mjs`：恢复旧版升级前站点文件。
- `verify-fix-bluetooth-module.mjs`：检查蓝牙模块是否完整，并提示对应修复命令。

执行前应先查看脚本内容并确认目标工作区。日常开发使用 `npm run dev`、`npm run check` 与 `npm run build`，不要自动执行本目录脚本。
