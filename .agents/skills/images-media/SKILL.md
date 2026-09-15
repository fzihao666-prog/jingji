---
name: images-media
description: "Images, SVG, icons, fonts, video, favicons, responsive delivery, lazy loading, and LCP or CLS optimization. 日本語の依頼例:「画像最適化」「フォント読み込み」「動画埋め込み」「LCP改善」「ファビコン」。"
---

# Images & Media

## The two invariants

1. **No CLS**: every image/video/embed has intrinsic dimensions — `width`+`height` attributes or CSS `aspect-ratio` on the container. No exceptions.
2. **The LCP element is not lazy-loaded**: for `next/image`, inspect the installed Next.js major. In Next.js 16+, prefer `loading="eager"` or `fetchPriority="high"`; use `preload` only for a single unambiguous LCP candidate (`priority` is deprecated in 16). Use the API supported by older installed majors rather than copying the newest prop blindly. For plain `<img>`, use `loading="eager"` plus `fetchpriority="high"` on the actual LCP candidate. Everything below the fold: `loading="lazy"` + `decoding="async"`. Do not preload several viewport-dependent candidates. (Target: LCP ≤ 2.5 s at p75 — the budget lives in `governance`.)

## Use the framework's pipeline first

- Next.js: `next/image` (constrain `remotePatterns` tightly — SSRF surface, see `frontend-security`).
- Astro: `astro:assets` `<Image>`/`<Picture>`.
- Plain Vite SPA: hand-rolled `<img srcset sizes>`; generate AVIF/WebP variants at build time (e.g. `vite-imagetools`) — don't ship original camera-size JPEGs.

## Formats & sizing

- Raster: AVIF/WebP with the pipeline handling fallback. Vector (icons, illustrations, logos): SVG.
- `sizes` must reflect the actual rendered width per breakpoint — a `sizes="100vw"` default on a 400px card image ships 3× the bytes.
- Don't scale down in CSS what you could resize at build/request time.

## SVG

- Styled/animated/recolorable SVG: inline as a component, `fill="currentColor"` (icon system rules in `design-system`).
- Static decorative SVG: `<img src="*.svg">` is fine and cacheable.
- Run bundled SVGs through SVGO. User-supplied SVG is executable content — never inline it; see `frontend-security` uploads.
- Accessibility: decorative → `alt=""` when loaded via `<img>`, `aria-hidden="true"` when inlined; meaningful → `alt` text on `<img>`, or `role="img"` + `<title>`/`aria-label` inline (see `a11y`).

## Fonts

- Framework loader first (`next/font` — also removes layout shift via size-adjust fallbacks). Otherwise: self-hosted `woff2` only, `@font-face` with `font-display: swap` (or `optional` for non-brand-critical), `<link rel="preload">` the critical face, subset to used scripts.
- Never load fonts via CSS `@import` or third-party CSS CDNs at runtime (render-blocking + privacy). Prefer one variable font over many static weights.

## Video & animated content

- Short looping animation: prefer an appropriately encoded muted `<video autoplay muted loop playsinline>` or a supported animated image format. Compare real encoded size and browser requirements; avoid GIF when a materially smaller supported format meets the content need.
- Content video: `preload="metadata"`, a real `poster`, captions `<track>` required (see `a11y`), and never autoplay with sound.
- Heavy embeds (YouTube etc.): load a thumbnail facade, swap in the iframe on interaction.

## Favicons / app icons

- Minimum set: `favicon.ico` (legacy), one SVG icon, one 180px `apple-touch-icon`, web manifest icons. Use the framework's metadata/file conventions rather than hand-written `<link>` soup.
