# Pre-ship evidence manifest

`pre-ship.evidence.json` is a compact handoff format, not a cache that turns old results into current proof. Validate it against [evidence-manifest.schema.json](evidence-manifest.schema.json).

```json
{
  "protocol": "codex-frontend-skills-pre-ship-evidence-v1",
  "generated_at": "2026-07-15T09:00:00.000Z",
  "scope": {
    "revision": "git-sha-or-WORKTREE",
    "files": ["src/components/Checkout.tsx"]
  },
  "checks": [
    {
      "id": "typecheck",
      "kind": "command",
      "status": "PASS",
      "command": "npm run typecheck",
      "exit_code": 0,
      "duration_ms": 1240,
      "evidence": "TypeScript completed with zero diagnostics."
    },
    {
      "id": "checkout-keyboard",
      "kind": "browser_journey",
      "status": "HUMAN_VERIFICATION_REQUIRED",
      "evidence": "Automated role assertions pass; screen-reader announcement is not manually verified."
    }
  ],
  "verdict": "NOT_READY",
  "blockers": ["checkout-keyboard requires human verification"]
}
```

## Ingestion rules

- Match `scope.revision` and the complete changed-file set before reusing evidence. `WORKTREE` is deliberately non-portable: rerun after any change.
- `command` records the exact repository script invoked; `exit_code` is required for a completed command. Keep only a redacted one-line summary in `evidence`, and link large logs with `artifact` when policy permits.
- Use `browser_journey` for user flows, `visual` for deterministic baseline/diff results, `audit` for dependency/security/performance scans, `review` for independent security/a11y passes, and `human` for checks automation cannot prove.
- Statuses are literal: `NOT_CONFIGURED` is missing required infrastructure; `NOT_APPLICABLE` is justified absence; `SKIPPED` is an optional/unavailable tool; `DEGRADED` is lower assurance; `HUMAN_VERIFICATION_REQUIRED` is unfinished human work.
- `READY` requires every check to be `PASS`, `NOT_APPLICABLE`, or justified `SKIPPED`, and an empty `blockers` array. A `FAIL`, `NOT_CONFIGURED`, `DEGRADED`, or `HUMAN_VERIFICATION_REQUIRED` check makes the verdict `NOT_READY` until rerun or explicitly resolved.
- Never store secrets, credentials, tokens, PII, raw exploit payloads, full scanner findings, or unredacted production URLs in the manifest.
