# Localized schema errors

Schemas decide validity; message catalogs decide user-facing language. Never render Zod's `issue.message` or `error.flatten().fieldErrors` directly in a localized UI because library defaults and dependency upgrades can expose English implementation text.

## Typed mapping example

```ts
import { z } from 'zod';

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  message: z.string().trim().min(1).max(2_000),
});

type Field = keyof z.infer<typeof contactSchema>;
type MessageKey =
  | 'validation.name.required'
  | 'validation.name.invalid'
  | 'validation.email.invalid'
  | 'validation.message.required'
  | 'validation.message.invalid'
  | 'validation.form.invalid';

const keyForIssue = (issue: z.core.$ZodIssue): MessageKey => {
  const field = issue.path[0];
  if (field === 'email') return 'validation.email.invalid';
  if (field === 'name' && issue.code === 'too_small') return 'validation.name.required';
  if (field === 'message' && issue.code === 'too_small') return 'validation.message.required';
  if (field === 'name') return 'validation.name.invalid';
  if (field === 'message') return 'validation.message.invalid';
  return 'validation.form.invalid';
};

export type LocalizedErrors = Partial<Record<Field | 'form', string[]>>;

export function localizeIssues(
  issues: readonly z.core.$ZodIssue[],
  translate: (key: MessageKey) => string,
): LocalizedErrors {
  const errors: LocalizedErrors = {};
  for (const issue of issues) {
    const candidate = issue.path[0];
    const field: Field | 'form' =
      candidate === 'name' || candidate === 'email' || candidate === 'message'
        ? candidate
        : 'form';
    (errors[field] ??= []).push(translate(keyForIssue(issue)));
  }
  return errors;
}
```

If the installed Zod major exposes a different public issue type, adapt the type import to that version; do not cast to `any`. Keep catalogs server-available so the server returns localized stable keys or localized safe text, never raw validator messages.

## Executable test shape

```ts
import { describe, expect, it } from 'vitest';
import { contactSchema, localizeIssues } from './contact-schema';

const catalogs = {
  ja: { 'validation.name.required': '名前を入力してください' },
  ar: { 'validation.name.required': 'يرجى إدخال الاسم' },
} as const;

describe.each(['ja', 'ar'] as const)('%s validation', (locale) => {
  it('localizes whitespace-only input without leaking Zod text', () => {
    const result = contactSchema.safeParse({ name: ' ', email: 'person@example.com', message: 'Hello' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = localizeIssues(result.error.issues, (key) =>
      key === 'validation.name.required' ? catalogs[locale][key] : `missing:${key}`,
    );
    expect(errors.name).toEqual([catalogs[locale]['validation.name.required']]);
    expect(JSON.stringify(errors)).not.toMatch(/too_small|invalid_type|zod/i);
  });
});
```

Also test missing fields, malformed values, maximum lengths, unknown keys, and the locale fallback. Treat a missing catalog key as a test failure; do not silently fall back to `issue.message`.
