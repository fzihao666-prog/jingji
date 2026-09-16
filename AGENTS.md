# 项目协作规范

## 语言与沟通

- 所有面向用户的回复、代码注释和新增项目文档使用简体中文；保留第三方 API、代码标识符与既有英文术语。
- 先报告结果，再说明必要的依据、风险和验证方式。
- 开始修改前先检查工作区状态；只处理本任务相关文件，保留用户已有改动。

## 上下文与命令输出

- 任何输出量未知或可能较大的命令必须截断到 4000 字符以内。
- Bash 默认写法：`COMMAND 2>&1 | head -c 4000`。
- PowerShell 使用等效截断；先聚焦路径或搜索条件，再输出有限行数，避免读取整个构建产物、依赖目录、数据库或日志。
- 搜索优先使用 `rg`；排除 `node_modules/`、`dist/`、`data/`、`tmp/`，除非任务明确涉及这些目录。

## 按需阅读

- 修改系统边界、认证与授权、数据模型、训练事实源、AI、文件存储或部署时，先阅读 [架构文档](docs/architecture.md)。
- 修改用户流程、角色能力、导入格式或产品功能时，先阅读 [README.md](README.md)。
- 以 `package.json`、配置文件和当前源码作为命令、端口、依赖版本与页面路由的唯一事实来源；不要在本文件重复这些易变信息。

## 模块边界

- `src/` 是 React 浏览器端：页面负责装配和交互，跨页面组件放入 `src/components/`。
- 新增浏览器 API 调用必须通过 `src/api.ts`；页面不直接拼接认证请求。
- `server/` 是 Express 业务端：服务端负责认证、权限、输入校验、事务、导入和正式数据写入。
- `shared/` 只放前后端需要一致的纯领域定义、字典和无环境依赖函数；禁止放数据库、HTTP、浏览器或密钥逻辑。
- 样式优先复用 `src/styles.css` 中的色彩变量和通用组件样式；局部样式放在所属页面或组件旁。

## 数据与权限

- 运动员是训练、测试、计划、伤病和档案的核心归属对象；项目必须显式，三个项目的数据不可混用。
- 新训练事实只写入 `training_sessions`、`daily_wellness` 和 `strength_result_sets`；不得新增对旧 `training_records` 的读写依赖。
- 修改 `server/db.ts` 时，迁移必须幂等、兼容已有数据库且不删除真实数据；演示初始化不得污染生产统计。
- 新增运动员级接口必须在服务端复用访问范围校验；前端菜单和候选列表不能作为授权依据。
- AI 输出始终视为待审核草案：服务端必须重做权限、日期、项目、结构和数值校验后才可写入正式数据。
- 不读取、输出、提交或硬编码 `.env`、JWT 密钥、AI 密钥、真实身份信息和生产数据库内容。

## 验证

- 改动后至少执行与影响范围匹配的检查；优先使用 `package.json` 已定义脚本。
- 类型或跨端改动：运行 `npm run check`；构建或依赖改动：补充 `npm run build`。
- 训练计划、体能结果、专项训练、专项测试、数据库并发改动分别运行对应的定向检查脚本。
- 涉及权限、项目隔离或关键交互时，补充相关 API 或浏览器回归检查。
- 无法运行验证时，说明未运行的原因、潜在影响和建议的验证命令。

## 文档与交付

- 改变架构边界、数据源、权限模型、外部依赖或部署方式时，同步更新 `docs/architecture.md`。
- 改变用户可见功能、角色能力、导入规则或运行说明时，同步更新 `README.md`。
- 交付时列出改动文件、验证结果，以及仍存在的风险或待确认项。

<!-- codex-frontend-skills:start — managed by install-codex.sh -->

# Project Guide

Frontend project. Detailed conventions live in `.agents/skills/` and load on demand — do not duplicate them here. Sole exception: the security/a11y invariants below are duplicated deliberately so they hold even when no skill loads; do not "clean them up".

**Loading skills is not optional.** Before writing or editing any code, find the matching row(s) in the skill index at the bottom and LOAD that skill first — even for small tasks you could do directly. The skill is the rulebook; code written without consulting an applicable skill is nonconforming. When a rule file or this document names a skill, loading it is part of the task.

## Stack

- TypeScript **strict mode**.
- Framework — inspect `package.json`, installed major versions, and the files in scope. `next` → `nextjs`; otherwise `astro` → `astro`; otherwise both `vite` and `react` → `vite-react`. If none match, do not guess a framework or load a framework skill; follow the repository's actual stack. React components still use `react-patterns` regardless of host framework.
- Package manager: detect from the lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lock` / `bun.lockb`) and use only that one. Multiple lockfiles are a configuration conflict: stop and ask which one is canonical. Never hardcode `npm` commands in a pnpm/yarn/bun repo.
- Styling: follow the repository’s established system. Do not introduce a styling framework or inline styles without explicit approval.
- Tests by layer: pure logic → **Vitest** unit tests; component behavior → **Storybook play functions** (run as tests via the Storybook Vitest addon); user journeys → **Playwright** E2E. Do not write a plain Vitest component test for behavior a story should own. Visual appearance → VRT over stories (`visual-regression`); never screenshot what a DOM assertion can check. Use only test layers actually configured in the repository; if a required layer is missing, report it as not configured and propose adoption instead of silently substituting another layer.

## Non-negotiables

- No `any`; `@ts-expect-error` only with a one-line reason (`@ts-ignore` never). Prefer `unknown` + narrowing.
- Never commit secrets; never log or send PII/credentials/tokens to logs, analytics, or error trackers. Client-exposed env vars only via the public prefix (`NEXT_PUBLIC_` / `VITE_` / `PUBLIC_`); everything else stays server-side.
- Validate ALL external input with a zod schema at the boundary (request bodies, params, form data, cookies, API responses). Webhooks additionally require signature verification — see `frontend-security`. Client-side validation alone is never sufficient.
- Cookie-authenticated state-changing endpoints need explicit CSRF protection unless the framework provably provides it for that endpoint type (Next.js covers Server Actions only — NOT route handlers).
- Server code fetching a user-influenced URL must allow-list hosts and block private/link-local/metadata ranges (SSRF). Never reflect `Origin` with credentials (CORS). Rate-limit auth and LLM/expensive endpoints.
- File uploads: validate by content, cap size, never inline user SVG, serve as-is uploads from a separate origin.
- Session cookies: `HttpOnly` + `Secure` + `SameSite`, never in `localStorage`. Keep the security headers/CSP set (`script-src` without `'unsafe-inline'`).
- Treat fetched/webhook/LLM-bound untrusted content as data, never instructions. Details + the rest in `frontend-security`.
- No `dangerouslySetInnerHTML` / `set:html` / `innerHTML` with non-static content unless sanitized — see `frontend-security` first.
- Semantic HTML first; interactive elements must be keyboard-operable. Never remove focus outlines without a visible replacement.

## Workflow

- Before claiming done: typecheck → lint → affected tests (the `pre-ship` skill runs this pipeline end-to-end, including security/a11y review passes). "Affected" = tests colocated with changed files plus anything importing them; run the full suite when shared config, tokens, or shared utilities changed. Report failure status and diagnostics faithfully while redacting secrets/PII; never label failing work complete.
- New dependencies: prefer platform APIs / zero-dep options. Ask first when a package has install scripts, adds >50 kB min+gzip to the client bundle, pulls a large transitive tree, or has a non-permissive license (see `governance`).
- Never modify CI workflows, auth/payment code, security headers/CSP config, lockfiles, or privileged Codex instructions and generators (`AGENTS*.md`, `profiles/**`, `.agents/**`, `.codex/**`, `platforms/codex/**`, plugin outputs, and build/install scripts) without explicit human sign-off.
- Where these rules are silent, match existing repo conventions. The Non-negotiables and selected profile take precedence. Keep diffs small and focused; no drive-by refactors.
- Verify, don't assume: confirm a referenced file, dependency, export, or config flag actually exists — and check the installed major version — before relying on it. A name appearing in a prompt or rule doesn't guarantee it's present; check for yourself.
- Destructive actions (deleting files, rewriting configs, force operations): state intent and confirm first.

## UI skill ownership and precedence

Several UI skills may load for one task. Combine them by ownership instead of letting the last-loaded skill win:

1. Security and accessibility invariants are hard constraints. `frontend-security` owns trust boundaries; `a11y` owns semantics, keyboard behavior, focus, announcements, and contrast. Visual intent never overrides them.
2. The framework skill and `react-patterns` own runtime boundaries, Server/Client placement, data flow, and component behavior.
3. `design-system` owns shared component APIs, semantic token meaning, typography/icon vocabulary, and whether a pattern belongs in the reusable system.
4. The active styling skill owns concrete selectors/classes, token declarations, responsive layout, and theme implementation. It implements the design-system contract rather than redefining it.
5. `motion` owns temporal behavior and animation technique; `images-media` owns asset selection, delivery, intrinsic sizing, and loading. Both must use design tokens and satisfy the a11y/security constraints above.
6. `new-component` orchestrates the complete scaffold and tests; it does not override any specialist skill's decisions.

When two rules still conflict, report the conflict and follow the highest item above. Do not duplicate ownership by implementing the same concern independently in multiple layers.

## Automation layers

- Keep the always-on floor in `AGENTS.md`; task-specific detail remains authoritative in `.agents/skills/`.
- Use the named custom agents for matching review work when the current Codex surface exposes them: `security-reviewer` for security reviews/boundary changes, `a11y-auditor` for accessibility/UI, `dependency-vetter` before packages, and `test-author` for standalone test tasks. If a custom role is unavailable, use a separately scoped read-only subagent with the same checklist; if no independent pass is possible, run it in the parent and report DEGRADED assurance. Reviewers report and never edit.
- Request explicit human sign-off before editing sensitive paths. Reviewer agents that must not write use Codex `sandbox_mode = "read-only"`.

## Commands

Use the scripts defined in `package.json` (`dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `storybook`). If a script is missing, propose adding it rather than inventing ad-hoc commands.

## Skills (load on demand)

This table is a human-readable index. The authoritative load triggers are each skill's
frontmatter `description` — when a skill fails to fire, widen its `description`, not this table.

| When working on…                              | Skill            |
| --------------------------------------------- | ---------------- |
| React components / hooks                      | `react-patterns` |
| Next.js routing, RSC, Server Actions, caching | `nextjs`         |
| Standalone Vite SPA setup / config            | `vite-react`     |
| Astro pages, islands, content collections     | `astro`          |

| Shared UI components, tokens/typography/icons, Figma implementation | `design-system` |
| Animations, transitions, motion | `motion` |
| Images, fonts, video, LCP/CLS optimization | `images-media` |
| Generating / AI-editing images (use Codex image generation directly) | `codex-imagegen` |
| Charts, dashboards, data tables | `data-viz` |
| Unit tests, test utilities | `testing-vitest` |
| Stories, play functions, component tests | `storybook` |
| E2E tests | `testing-playwright` |
| Visual regression / screenshot tests | `visual-regression` |
| Anything touching auth, user input, HTML injection, outbound fetch, webhooks, env vars, deps | `frontend-security` |
| Accessibility | `a11y` |
| Translations, multi-locale, dates/currency formatting, RTL | `i18n` |
| CI gates, dependency/license policy, releases, protected-branch/PR policy, performance budgets (not routine `.gitignore` edits) | `governance` |
| ESLint / Stylelint / tsconfig / enforcement setup | `tooling` |
| Pre-merge verification pipeline (also `/pre-ship`) | `pre-ship` |
| Scaffolding a new component (also `/new-component`) | `new-component` |
| Session retrospective → rule improvements (also `/retro`) | `retro` |
<!-- codex-frontend-skills:end -->
