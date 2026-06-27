# App Entry & Routing Review

Scope reviewed:
- `src/main.tsx`
- `src/app/App.tsx`
- `src/app/routes/index.tsx`
- `src/app/routes/AppLayout.tsx`
- `src/app/routes/ProtectedRoute.tsx`
- `src/app/routes/SubscribedRoute.tsx`
- `src/app/components/AuthCallback.tsx`
- `src/providers/AuthProvider.tsx`
- `src/providers/QueryProvider.tsx`

Summary: 11 findings (critical: 0, high: 1, medium: 6, low: 4). No TODO/FIXME/HACK stubs were found in the assigned files.

Verification notes:
- `npm run typecheck -- --pretty false` passed.
- `npm run lint -- <assigned files>` exited 0, though the script runs `biome check .` and reported one unrelated warning in `src/lib/recovery.ts`.
- `npm test -- AuthCallback AuthProvider` could not run because `node_modules/vitest/vitest.mjs` is missing in this checkout.

## `src/main.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 12-20
- Description: React 19 root error hooks forward to `sentryHandler`, but that handler is only assigned during startup when consent was already accepted. If a first-time user accepts cookies after the app has mounted, `CookieConsentBanner` initializes Sentry but never updates this module-level handler, so `onUncaughtError`, `onCaughtError`, and `onRecoverableError` continue to no-op until the page is reloaded.
- Suggested fix direction: Move Sentry consent handling behind a shared module/API that both `main.tsx` and the banner use, or have the consent-accept path import both `initSentry` and `sentryErrorHandler` and update the root error proxy handler.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 13
- Description: `getConsentStatus()` reads `localStorage` during module initialization before React renders. In browsers or privacy modes where storage access throws `SecurityError`, the entire app can fail before the root is created.
- Suggested fix direction: Make consent reads/writes defensive with `try/catch` and default to `null` or rejected consent when storage is unavailable, so rendering is not blocked.

## `src/app/App.tsx`

No findings.

## `src/app/routes/index.tsx`

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 25-31
- Description: The chunk-load recovery path uses `sessionStorage.getItem` and `sessionStorage.setItem` inside the `catch` handler without guarding storage errors. If session storage is unavailable or throws, the recovery handler throws before `window.location.reload()` and the intended stale-asset recovery does not happen.
- Suggested fix direction: Wrap the session-storage throttle in `try/catch`; if storage is unavailable, fall back to a best-effort reload or an in-memory flag.

### Finding 4
- Category: error
- Severity: medium
- Line numbers: 157-220
- Description: The top-level route tree has a `Suspense` fallback but no error boundary around public routes. `AppLayout` adds an `ErrorBoundary` only for authenticated outlet content, so errors in public pages such as landing, privacy, terms, FAQ, auth callback, reset password, or lazy import failures after the reload throttle can unmount the whole React tree and leave users with a blank screen.
- Suggested fix direction: Add a route-level or app-level `ErrorBoundary` around the whole `Routes` tree, or wrap public routes with the same `PageErrorFallback` pattern used by `AppLayout`.

## `src/app/routes/AppLayout.tsx`

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 71-83
- Description: The page `ErrorBoundary` does not reset on route changes. Once a protected page throws, `react-error-boundary` remains in fallback state, and navigation to another protected route can keep showing the previous error instead of rendering the new outlet.
- Suggested fix direction: Pass `resetKeys={[location.pathname]}` (or include search params if needed) to the boundary, or key the boundary by the current location so page-level errors are cleared on navigation.

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 74-77
- Description: `SkipToContent` links to `#main-content`, but the target `<motion.main>` is not programmatically focusable. Some keyboard/screen-reader users may jump the scroll position without moving focus to the main region, reducing the usefulness of the skip link.
- Suggested fix direction: Add `tabIndex={-1}` to the main landmark and ensure focus styles remain accessible when the skip link is activated.

## `src/app/routes/ProtectedRoute.tsx`

### Finding 7
- Category: failure-point
- Severity: low
- Line numbers: 12-13
- Description: Unauthenticated users are redirected to `/` without preserving the protected URL they originally requested. After sign-in, the auth flow sends users to `/dashboard`, so deep links such as `/history/:sessionId` or `/replay/:sessionId` are lost.
- Suggested fix direction: Use `useLocation()` and pass redirect state such as `{ from: location }`, then have the sign-in/auth-callback flow return authenticated users to that safe internal path when present.

## `src/app/routes/SubscribedRoute.tsx`

No findings.

## `src/app/components/AuthCallback.tsx`

### Finding 8
- Category: error
- Severity: medium
- Line numbers: 65-96
- Description: `resolveSession()` awaits `supabase.auth.getSession()` inside a loop, but the async function has no `try/catch`. If `getSession()` throws instead of returning an `{ error }` result, the promise rejection is only discarded by `void resolveSession()`, leaving the user on the loading screen indefinitely.
- Suggested fix direction: Wrap the polling loop in `try/catch`, check `isActive` before setting state, and surface a recoverable error message with a retry/back-to-sign-in option.

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 66-92
- Description: The callback gives Supabase only eight 250ms polling attempts (about two seconds) to make a session visible. On slow devices, delayed storage, or slower OAuth callback processing, this can show “Authentication did not complete” even though the auth state may arrive moments later.
- Suggested fix direction: Prefer `onAuthStateChange`/`SIGNED_IN` for the callback, or extend the timeout with backoff and keep listening for a late session before declaring failure.

## `src/providers/AuthProvider.tsx`

### Finding 10
- Category: bug
- Severity: high
- Line numbers: 40-58
- Description: Initial session loading and auth-state subscription can race. `getSession()` is started, then `onAuthStateChange()` is registered; if an auth event such as `SIGNED_OUT` or a fresh `SIGNED_IN` is applied before the initial `getSession()` promise resolves, the later `getSession()` result can overwrite the newer auth state with stale data.
- Suggested fix direction: Rely on Supabase's `INITIAL_SESSION` event instead of a separate `getSession()` call, or track a monotonically increasing auth-state version and ignore the initial session result after any auth event has fired.

### Finding 11
- Category: error
- Severity: medium
- Line numbers: 66-69
- Description: `handleSignOut()` ignores the `{ error }` returned by `supabase.auth.signOut()` and still clears the React Query cache. If sign-out fails, callers get a resolved `Promise<void>` and cannot show an error, while cached app data may already be cleared and UI state may be inconsistent.
- Suggested fix direction: Inspect the sign-out result, throw or return a typed error when sign-out fails, and only clear the query cache once local auth state is actually cleared or the failure has been handled deliberately.

## `src/providers/QueryProvider.tsx`

No findings.
