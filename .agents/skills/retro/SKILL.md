---
name: retro
description: "Turn session friction, repeated mistakes, and human corrections into minimal rule or skill improvements for approval. 日本語の依頼例:「振り返り」「レトロ」「学びをルール化」「同じミスを防ぎたい」。"
---

# Retro — turn friction into rules

The rules improve only if what went wrong feeds back into them. This skill is that loop. Output is a PROPOSAL — `.agents/**` and `.codex/**` edits need human sign-off (Codex `PreToolUse` cannot prompt; obtain sign-off before the tool call), so never apply silently.

## Gather (in this order)

1. **This session**: moments where the human corrected you, rejected an approach, re-asked something a rule should have answered, or a gate caught something late that a rule should have caught early.
2. **Recent history**: `git log --oneline -20` + PR review comments if accessible — repeated fix-up commits (`fix:` after `feat:` on the same files) are rule-gap evidence.
3. **Subagent evidence**: inspect handoffs from this task/thread and, only when the current surface exposes it, relevant durable agent memory. Machine-local notes do not reach the team until a reviewed rule or skill change promotes them.

## Filter — what deserves a rule

- Happened twice, or cost real time once, AND is generalizable beyond today's file. One-off trivia stays out.
- Not already covered: grep the relevant skill first. If covered but didn't fire, the fix is the skill's `description` (trigger), not a new rule — say which.
- Decidable: the rule must be checkable by a reader ("prefer X" is not a rule; "X unless Y, because Z" is).
- Security/a11y candidates go to `frontend-security`/`a11y` and need human security review per `governance`.

## Propose

For each candidate, output:

- **Target file** (one skill/rule — never AGENTS.md unless it's a floor-level invariant).
- **The 1-3 line addition**, written in the target file's existing voice, with the why in-line.
- **Evidence**: the concrete moment(s) that motivated it.
- **Enforcement**: can ESLint/Stylelint/Semgrep catch it instead (see `tooling`)? A machine check beats a prose rule — propose the config change if so.

Also propose DELETIONS: a rule nobody has hit in months is a pruning candidate (security/a11y rules are exempt — see `governance`).

End with the proposals as ready-to-apply diffs and wait for sign-off. After applying any, add a `CHANGELOG.md` entry.
