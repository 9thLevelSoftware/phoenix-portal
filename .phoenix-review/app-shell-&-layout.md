# App Shell & Layout Review

Scope: sidebar, bottom navigation, page shell, error fallback, loading states, banner, skip link, particles, delete dialog, profile filter, image fallback, and routine picker modal.

Verification performed:
- Read all 14 assigned files in full.
- `npm run typecheck -- --pretty false` passed.
- `npx biome check` on the 14 assigned files passed.

## src/app/components/AppSidebar.tsx

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 103-147
- Description: `useAutoCollapse` tries to avoid persisting viewport-driven sidebar changes by toggling `isAutoCollapsingRef` around `setOpen`, but `setOpen` updates state asynchronously. By the time the `open` persistence effect runs, the ref has already been set back to `false`, so auto-collapse below 1280px can write `phoenix-sidebar-preferred-open=false` and overwrite the user's real desktop preference.
- Suggested fix direction: Track auto-collapse state through the resulting render, or store user-initiated preference only from the sidebar trigger path instead of every `open` state change. Verify shrinking the viewport does not mutate the saved desktop preference.

## src/app/components/MobileBottomNav.tsx

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 61-69, 247-250
- Description: More-menu active state uses exact path equality. Routes such as `/routines/new`, `/routines/:routineId`, `/routines/:routineId/view`, `/cycles/new`, and `/cycles/:cycleId` exist in the app but will not mark the More tab or the matching drawer item active on mobile.
- Suggested fix direction: Use the same segment-aware prefix matching as the desktop sidebar, e.g. exact match or `pathname.startsWith(path + "/")`, and apply it both to `isMoreActive` and drawer item highlighting.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 71-83, 96, 251-254
- Description: Opening the More drawer pushes a synthetic history entry, but selecting a drawer link closes the drawer with `setMoreOpen(false)` directly. That bypasses the cleanup path in `handleDrawerChange(false)`, leaving the synthetic `moreDrawer` entry in the browser history. After navigating from the drawer, Back can land on a stale same-URL entry and require an extra press.
- Suggested fix direction: Centralize drawer closing through a helper that removes/replaces the synthetic history state before navigation, or avoid manual `pushState` and rely on the drawer's normal close behavior for link selection.

## src/app/components/BottomSheet.tsx

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 56-75, 99-100
- Description: Drag dismissal compares the absolute motion value `y` with `150`, but the open position itself is usually a positive translate value (`containerHeight - currentSnapPoint`; 320px on an 800px viewport with the default 60% snap). As a result, ending even a small drag from the default snap can satisfy `currentY > 150` and close the sheet immediately instead of snapping.
- Suggested fix direction: Compare drag offset/delta from the current snap point rather than absolute `y`, or compute the dismiss threshold relative to the open snap position. Add interaction tests for short drags at each snap point.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 27-38, 67-72, 99-100
- Description: `defaultSnap` and `snapPoints` are not validated. An out-of-range `defaultSnap` produces `NaN` for `currentSnapPoint`; an empty `snapPoints` array will also make the reduce in `handleDragEnd` fail. Either case can leave the sheet offscreen or throw during drag handling.
- Suggested fix direction: Clamp `defaultSnap` to a valid index, reject or default empty snap arrays, and normalize snap percentages to a safe range before using them.

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 80-104, 114-129
- Description: The custom sheet has no dialog semantics, focus trap, initial focus management, Escape handling, or `aria-modal`. Keyboard and screen-reader users can tab to background content while the visual overlay is open.
- Suggested fix direction: Use the existing Radix/Vaul drawer/dialog primitives or add `role="dialog"`, `aria-modal="true"`, labelled title wiring, Escape close, focus trapping, and focus restoration.

### Finding 4
- Category: failure-point
- Severity: low
- Line numbers: 43-53
- Description: Opening the sheet unconditionally sets `document.body.style.overflow = "hidden"` and cleanup resets it to an empty string. If another modal or page-level style already had a body overflow value, closing this sheet will clobber it.
- Suggested fix direction: Save the previous body overflow value and restore that exact value, or use a shared scroll-lock utility with reference counting.

## src/app/components/PageShell.tsx

No findings.

## src/app/components/PageLoading.tsx

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 6-34
- Description: The loading state is only visual text plus animation and is not exposed as a live status region. Assistive technologies may not announce that the page is loading during route-level Suspense transitions.
- Suggested fix direction: Add `role="status"` and/or `aria-live="polite"`, and mark decorative animated elements `aria-hidden`.

## src/app/components/ErrorFallback.tsx

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 31-38, 56-60
- Description: The fallback directly uses `sessionStorage` and `window.location.reload()` without guarding storage access. If session storage is unavailable or throws (private/blocked storage, embedded contexts), this error-handling UI can throw while already handling an error.
- Suggested fix direction: Wrap storage reads/writes/removes in `try/catch` and fall back to manual reload UI if storage is unavailable.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 50-53
- Description: Non-chunk errors render `error.message` directly to end users. React escapes the content, so this is not an XSS issue, but production exceptions can contain internal implementation details, table names, URLs, or other sensitive diagnostics.
- Suggested fix direction: Show a generic user-facing message in production and send the raw error to logging/observability instead.

## src/app/components/PhoenixLogo.tsx

No findings.

## src/app/components/PortalBanner.tsx

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 5-31
- Description: Dismissal is component-local state only. If the banner is remounted by route/layout changes or the page is refreshed, the same user sees it again despite dismissing it.
- Suggested fix direction: Persist dismissal in local storage or user preferences if the intended behavior is one-time acknowledgement.

## src/app/components/SkipToContent.tsx

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 3-5
- Description: The link targets `#main-content`, but the target main element is not focusable in `AppLayout`. Activating the skip link may scroll to the main content while keyboard focus remains on the skip link, which weakens the accessibility benefit.
- Suggested fix direction: Make the target focusable with `tabIndex={-1}` and ensure activation moves focus to it, or handle focus programmatically on click.

## src/app/components/EmberParticles.tsx

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 114-119
- Description: The particle canvas is decorative but is not marked `aria-hidden`. Some assistive technologies may expose it as an unlabeled graphic/canvas.
- Suggested fix direction: Add `aria-hidden="true"` and, if needed, `role="presentation"` to the canvas.

## src/app/components/DeleteConfirmDialog.tsx

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 58-61
- Description: `AlertDialogAction` closes the controlled dialog as part of its default action. The callers start async delete mutations and only explicitly close on success, but this component will still request close immediately when Delete is clicked. If deletion fails, the confirmation dialog has already disappeared, hiding the pending/error state and forcing the user to re-open context.
- Suggested fix direction: Prevent the default close in the action click handler while starting the mutation, or use a plain button inside the footer and let callers close the dialog only after successful deletion.

## src/app/components/LocalProfileFilter.tsx

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 34-49, 56-69
- Description: If `activeProfileId` points to a profile that is no longer present in the fetched profile list, the component does not reset it. The UI can retain a stale filter value and downstream pages may show empty or incorrect filtered data even though the profile no longer exists.
- Suggested fix direction: When profiles load, verify `activeProfileId` exists in the list and reset it to `null` if it does not.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 39-51
- Description: The `label` uses `htmlFor="profile-filter-select"`, but the rendered `SelectTrigger` is not given that id. The visible label is therefore not programmatically associated with the combobox.
- Suggested fix direction: Pass `id="profile-filter-select"` to `SelectTrigger` if supported, or use the select component's labelled-by pattern.

## src/app/components/figma/ImageWithFallback.tsx

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 10, 16-40
- Description: Once `didError` is set, it is never reset when the `src` prop changes. Reusing this component for a different image after one failed load will keep showing the fallback even if the new URL is valid.
- Suggested fix direction: Add an effect that resets `didError` when `src` changes, or key the image state by `src`.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 12-14, 33-40
- Description: A caller-provided `onError` handler is overwritten by the internal `handleError` because `onError={handleError}` is applied after `{...rest}`. Consumers cannot perform logging, metrics, or custom fallback behavior on image load failures.
- Suggested fix direction: Extract `onError` from props and invoke it from `handleError` before setting fallback state.

## src/app/components/modals/RoutinePickerModal.tsx

### Finding 1
- Category: stub
- Severity: medium
- Line numbers: 58-66
- Description: The Search input is rendered but has no state, `onChange`, or filtering logic. Typing into the field does not change the recent or all routines lists.
- Suggested fix direction: Add search state and filter routines by name and relevant metadata, including an empty-results state.

### Finding 2
- Category: stub
- Severity: medium
- Line numbers: 147-154
- Description: The `+ Create New Routine` button has no `onClick`, link, or callback prop, so it is a visible dead control.
- Suggested fix direction: Accept an `onCreateRoutine` callback or render a router link to the routine creation route, and close the modal if appropriate.

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 30-46, 53-55
- Description: The custom modal has no `role="dialog"`, `aria-modal`, labelled-by wiring, focus trap, Escape handling, or focus restoration. The close icon button also has no accessible label beyond the icon. Keyboard and screen-reader users can have difficulty understanding and exiting the modal.
- Suggested fix direction: Use the app's dialog component/Radix Dialog or add complete modal accessibility behavior and an `aria-label` for the close button.

### Finding 4
- Category: bug
- Severity: low
- Line numbers: 26-27, 77-107, 117-142
- Description: `recent` is `routines.slice(0, 2)` and `all` is the full `routines` array, so the first two routines are rendered twice in the same picker. This creates duplicate controls with the same action and can be confusing for keyboard/screen-reader navigation.
- Suggested fix direction: Exclude recent items from the All section or rename the second section to make duplication intentional and accessible.
