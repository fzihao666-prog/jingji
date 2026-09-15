---
name: vite-react
description: "Standalone Vite + React SPA structure, env vars, splitting, and vite.config. Not for Astro/Next.js or merely because Vitest/Storybook use Vite internally. 日本語の依頼例:「Vite + React SPA」「素のViteプロジェクト」「vite.config」。"
---

# Vite + React SPA

## Structure

```
src/
  app/          # app shell: router, providers, global error boundary
  features/<name>/   # feature code: components, hooks, api, tests colocated
  components/   # shared presentational components
  lib/          # framework-agnostic utilities
  styles/       # tokens.css, reset.css, globals.css
```

- Feature code imports shared code; features do not import other features' internals (export via the feature's `index.ts` if sharing is needed).
- Path alias `@/` → `src/` — define it once and mirror it in `vite.config.ts`, `tsconfig.json` (`paths`), and Vitest config. Use `vite-tsconfig-paths` only when it is already installed or after dependency vetting and approval.

## Env vars

- Only `VITE_`-prefixed vars reach client code, via `import.meta.env.VITE_X`. Everything in a Vite SPA bundle is public — never put secrets in any env var a SPA reads; secrets belong on a backend.
- Type them in `src/vite-env.d.ts` (`ImportMetaEnv`). Validate required vars at startup with a small zod schema so misconfiguration fails fast, not deep in runtime.

## Routing & splitting

- Code-split at route level: `React.lazy` + `Suspense` per route. Don't micro-split small components.
- Handle stale-chunk errors after deploys: lazy import rejection → full reload, guarded by a sessionStorage flag so it reloads at most once (otherwise you ship an infinite reload loop).

## Data

- For non-trivial server state, prefer the repository's installed query/cache library over `useEffect` + `useState` fetching. If none exists, justify the need and run dependency vetting before proposing one; do not add TanStack Query by default. Keep server cache state out of global client stores.

## Config hygiene

- Keep `vite.config.ts` minimal; resist plugin accumulation. Every plugin must justify itself.
- `build.sourcemap: true` for production debugging only if maps are not publicly served (or use `hidden`).
- Check bundle size with the repository's existing build report or an already-installed analyzer. Never use unpinned `npx` to fetch and execute an analyzer; if no analyzer exists, report the evidence gap and vet a pinned dev dependency before adding it.

## Tests

- Vitest shares the Vite pipeline — use a single `vite.config.ts` with a `test` block (or `vitest.config.ts` that merges it) so aliases/plugins never diverge between app and tests.
