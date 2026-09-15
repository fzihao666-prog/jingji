---
name: codex-imagegen
description: "Generate or AI-edit raster images with Codex for banners, heroes, demo assets, photo edits, and cutouts. Not for compression or resizing. 日本語の依頼例:「画像を生成」「写真を加工」「バナー画像」「ヒーロー画像」。"
---

# Generate images directly in Codex

Use Codex's image generation capability directly. Do not start a nested `codex exec` process and do not register Codex itself as an MCP server.

## Workflow

1. Load the built-in `imagegen` skill when it is available and follow its image inclusion rules.
2. For a new image, describe the subject, composition, visual style, lighting, palette, aspect ratio, and intended placement.
3. For an edit, inspect the source image first and include every target image in the edit request. Preserve identity, labels, and composition unless the user asks to change them.
4. Generate to the requested workspace path or move the resulting asset there without altering unrelated files.
5. Inspect the result visually. Retake only the failed image, not the whole batch.

## Composition and crop safety

- Prefer native landscape, portrait, or square generation closest to the target ratio, then crop and resize with the project's normal media tooling.
- When cropping is expected, state the exact surviving region and treat the outside area as expendable background bleed.
- Keep text, faces, logos, and critical objects inside the safe central region.
- For Japanese text, inspect every character. Prefer adding production text in HTML/CSS or design tooling when exact typography matters.

## Quality gate

- Verify subject fidelity, spelling, crop safety, contrast, and absence of unintended artifacts.
- For image-to-image work, compare before and after to confirm required details survived.
- Budget two or three focused attempts for important assets; trial one image before generating a batch.
- Apply `images-media` after generation when the asset also needs format conversion, responsive variants, compression, or LCP/CLS optimization.
