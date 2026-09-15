---
name: pre-ship
description: "Pre-merge verification covering scope, typecheck, lint, affected tests, security, accessibility, and a single pass or fail report. 日本語の依頼例:「出荷前チェック」「マージ前確認」「完成か確認」「PR前チェック」。"
---

# Pre-ship pipeline

Run the gates below in order against the current change set (`git diff` + untracked files). If Git metadata is unavailable, use the files named or touched in the task and mark scope confidence DEGRADED. Report command summaries faithfully, but always redact secrets, credentials, tokens, PII, and exploit payloads. A failing gate is reported, never worked around, and the change is not "done" until all applicable gates pass or the human explicitly accepts a documented exception.

If `pre-ship.evidence.json` exists, read [references/evidence-manifest.md](references/evidence-manifest.md) before running gates. Ingest only checks whose recorded scope and revision still match the current change; stale evidence is rerun or reported as stale, never carried forward as PASS. Create or refresh the manifest when the user asks for durable evidence, when a repository policy requires it, or when handing the result to another reviewer.

## Gates

1. **Scope** — `git status` + `git diff --stat`: list changed files; classify what they touch (boundary code? UI? styles? tests? sensitive paths?). This decides which later gates apply.
2. **Prior authorization** — if scope includes a sensitive path from `governance`, confirm explicit human sign-off existed before the write. Missing approval is a blocking FAIL; do not backdate approval and call the original change compliant.
3. **Typecheck** — run the repository's `typecheck` script. For an application where it is missing, report NOT CONFIGURED (blocking); for a non-TypeScript or documentation/rules repository, mark NOT APPLICABLE with evidence. Do not invent an ad-hoc substitute.
4. **Lint** — run the repository's `lint` script with the same NOT CONFIGURED versus NOT APPLICABLE distinction.
5. **Affected tests** — tests colocated with changed files plus anything importing them; the full suite when shared config, tokens, or shared utilities changed. Storybook play-function tests run via the Vitest addon; touched E2E specs via `test:e2e`. A required but absent test layer is NOT CONFIGURED, not silently replaced.
6. **Security pass** (only if gate 1 found boundary code) — use the `security-reviewer` custom agent when available. If that role is unavailable, use a separately scoped read-only subagent with the same checklist; if no independent read-only pass is possible, run the checklist in the parent, mark assurance DEGRADED, and require explicit human acceptance before READY.
7. **A11y pass** (only if gate 1 found UI changes) — use the same custom-agent → read-only subagent → DEGRADED parent fallback order with the `a11y-auditor` checklist. Blocking findings gate the pipeline.
8. **Local scanners, if installed** — run `gitleaks protect --staged --redact` and `semgrep --config .semgrep/` when available. Report only exit status, count, and redacted file locations; never reproduce a detected secret or sensitive payload. When a scanner is absent, mark SKIPPED (tool not installed). These duplicate CI gates early, they don't replace them.

## Report format

One table: gate → command run → result (redacted exit/summary line) → PASS / FAIL / NOT CONFIGURED / NOT APPLICABLE / SKIPPED / DEGRADED. Then the verdict: **READY TO SHIP** or **NOT READY** with blocking items first. DEGRADED assurance needs an explicit human acceptance to become READY. Never summarize a failure as "minor".

When a durable manifest is produced, the human-readable table and `pre-ship.evidence.json` must agree. Browser journeys, visual baselines, audits, reviewer passes, and unresolved human checks belong in the same manifest as separate check kinds; a successful build cannot overwrite or imply them.
