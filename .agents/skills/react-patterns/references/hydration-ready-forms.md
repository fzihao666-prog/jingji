# Hydration-ready forms

Use this pattern for payment, irreversible mutation, scanning, multi-step, or other high-consequence forms in an RSC-compatible runtime. A form can be clicked before React attaches handlers; client state and `onSubmit` are not a pre-hydration safety boundary.

## Choose one deliberate mode

1. **Progressive form (preferred):** a real server action/endpoint accepts named controls and remains safe without JavaScript. Server validation, authorization, idempotency, and CSRF rules still apply. Read values from `FormData`; do not require mirrored client state for correctness.
2. **Hydration-gated form:** use only when the operation cannot work safely without client state. Render its submit control as native `disabled` in SSR HTML, expose a status message, and enable it after hydration. Never rely on `aria-disabled` alone to stop native submission.

```tsx
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrationReady(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function ConfirmButton() {
  const ready = useHydrationReady();

  return (
    <>
      <button type="submit" disabled={!ready} aria-describedby="form-readiness">
        Confirm
      </button>
      <span id="form-readiness" role="status" aria-live="polite">
        {ready ? '' : 'Preparing secure submission…'}
      </span>
    </>
  );
}
```

`useSyncExternalStore` supplies the server snapshot during SSR/hydration and then updates to the client snapshot without an effect-only hydration flag. Keep input values in named native controls whenever possible so text entered before hydration is present in `FormData`.

## Verification

- With JavaScript delayed or blocked, a progressive form completes safely; a gated form cannot submit or navigate.
- Enter a value before hydration, allow hydration, then submit. The server receives the visible value.
- Double activation and reload do not duplicate the mutation; use a server-enforced idempotency key for high-impact operations.
- Keyboard and screen-reader users receive the same readiness state. Focus is not moved merely because hydration completes.
- Hydration mismatch warnings are failures, not console noise to suppress.
