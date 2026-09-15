# Vinext, Workers/Sites, Storybook, and D1

Use this recipe only after confirming the repository actually uses Vinext and Cloudflare bindings. Check installed Vinext, Vite, Wrangler, Storybook, and D1 adapter versions before changing config; this surface evolves quickly.

## Keep the runtime graphs explicit

Vinext builds App Router code as separate RSC, SSR, and browser environments. Storybook creates another Vite graph for stories. A module being valid in the Vinext server graph does not make it valid in Storybook's Node/browser graph.

- Put D1, `cloudflare:workers`, secrets, and Worker-only packages behind server-only repository/adaptor modules. UI components and stories receive typed data or an injected mock adapter; they never import Worker bindings.
- Keep Storybook's `viteFinal` changes narrow. Merge only aliases/plugins that stories need; do not copy the full Vinext Worker/RSC plugin graph into Storybook.
- If a shared module accidentally reaches the story graph, fix the boundary. A broad alias that turns every Worker import into an empty module can hide a production bug.
- Run both the production Vinext build and the Storybook build after dependency/config changes. One passing graph is not evidence for the other.

## Dependency optimizer failures

Vite may prebundle a dependency for the wrong runtime. Typical evidence is a module that works on a clean start but disappears, changes shape, or fails after reload in a Server Action.

1. Reproduce from a cleared optimizer cache and record the exact failing import.
2. Confirm the package is Worker/server-only and is not leaking into client or story code.
3. Exclude only the affected package entry points in the repository's Vinext Vite config, for example `optimizeDeps.exclude: ['drizzle-orm', 'drizzle-orm/d1']` when those exact imports are proven to fail.
4. Restart cleanly, exercise the mutation twice across a reload, then run Vinext build and Storybook build.

Do not paste this example blindly. The exclusion list is evidence-driven and must match the installed packages. Excluding large dependency sets trades one class of optimizer bug for slower, less predictable development startup.

## Local D1 migrations and persistence

- Define one checked-in package script that applies migrations through Wrangler to the configured binding, with `--local` and a stable `--persist-to` directory. Use the repository's detected package manager to run it.
- Use the same persistence directory for migration, local development, and verification. A migration applied to one Miniflare state directory is invisible to a server using another.
- Do not run SQLite directly against Miniflare metadata and call that a D1 migration. Wrangler owns the local D1 migration target and records applied migrations.
- Keep local, preview, and remote commands distinct. Never substitute `--remote` during local verification.
- For tests, use the configured Workers test integration and apply checked-in migrations to an isolated test D1 database; do not reuse a developer's persisted state.

Minimum proof: list/apply local migrations, start Vinext against the same state directory, perform one write through the real Server Action or route handler, read it back through the application boundary, and verify the expected audit/persistence record. Redact user data and binding identifiers from shared logs.

Primary references to re-check when updating this recipe: Vinext's official repository documentation and Cloudflare's Wrangler D1 migration and Workers Vitest integration documentation.
