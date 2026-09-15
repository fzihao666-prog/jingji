---
name: new-component
description: "Scaffold a new UI component with the active styling approach, Storybook play coverage, tokens, and accessibility. Not for small edits to existing components. 日本語の依頼例:「新しいコンポーネント」「コンポーネント追加」「Figmaから実装」。"
---

# New component pipeline

Produce the full set in one pass — a component without its story is not done. This skill is the orchestrator; do not load every adjacent rulebook by default. Consult `react-patterns` only when the component owns state/hooks or a non-trivial React API, the active styling skill for non-trivial visual work, `design-system` for shared/public primitives, and `a11y` for custom widgets or focus/keyboard behavior. In the minimal profile, follow the repository's existing styling approach consistently.

## Steps

1. **Locate & name** — follow the repo's existing component directory convention (check siblings first — repo convention beats this file). One directory: `Component.tsx`, `Component.stories.tsx`, plus the styling file the active styling skill prescribes (e.g. `Component.module.css` under CSS Modules; none under Tailwind).
2. **Contract first** — write the props type: required props minimal, variants as unions (not booleans that multiply), events named `onX`. No `any`; state stays out unless the component owns it.
3. **Markup** — semantic element first (`button`, not `div onClick`). Custom widget? Full keyboard contract + roles/states per `a11y` before any styling.
4. **Styles** — per the active styling skill: consume design tokens (never raw values), variants via `data-*`/`aria-*` attributes, responsive per that skill's rules. No inline styles.
5. **Story** — CSF3, one story per meaningful state (default, each variant, error/disabled, loading, empty). Interactive behavior gets a play function — that IS the component test. Include a keyboard-path assertion for interactive components.
6. **Unit tests** — only for pure logic extracted out of the component (formatting, reducers). Do not duplicate what the play function covers.
7. **Verify** — typecheck, lint, run the story tests. Check the story renders every state without console errors.

## Definition of done

Component + the active profile's styling artifact (if any) + stories with play function all exist, all gates in step 7 pass, tokens used where the project defines them, and the keyboard path is covered. If asked for "just the component, quickly" — still deliver the story; drop only the optional extras and say so.
