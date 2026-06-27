# UI Primitives (shadcn/Radix) Review

Task: `t_37f35dec`
Scope: 48 files under `src/app/components/ui/`

Verification performed:
- Read all 48 assigned files.
- `npm run typecheck -- --pretty false` passed.
- `npx biome check <48 assigned files>` passed.
- No TODO/FIXME/HACK stubs were found in the assigned files.

Severity breakdown:
- Critical: 0
- High: 2
- Medium: 11
- Low: 8
- Total findings: 21

## src/app/components/ui/accordion.tsx

No findings.

## src/app/components/ui/alert-dialog.tsx

No findings.

## src/app/components/ui/alert.tsx

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 28-32
- Description: `Alert` always renders `role="alert"`, even for the default/non-destructive variant. Static informational content rendered with `role="alert"` can be announced assertively by assistive technology and interrupt users even when no urgent status change occurred.
- Suggested fix direction: Make the live-region role opt-in, use `role="status"` for non-urgent messages, or expose a prop for callers to choose the appropriate role.

## src/app/components/ui/avatar.tsx

No findings.

## src/app/components/ui/badge.tsx

No findings.

## src/app/components/ui/breadcrumb.tsx

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 52-63
- Description: `BreadcrumbPage` renders a non-interactive `<span>` with `role="link"`, `aria-disabled="true"`, and `aria-current="page"`. This can cause the current page to be announced as a disabled link even though it is not focusable or interactive.
- Suggested fix direction: Prefer a plain text element with `aria-current="page"` and no `role="link"`, or render an actual disabled/non-clickable link only when a link semantic is intentionally required.

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 90-99
- Description: `BreadcrumbEllipsis` sets `aria-hidden="true"` on the wrapper while also including an `sr-only` label (`More`). Because the parent is hidden from the accessibility tree, the screen-reader label is also hidden.
- Suggested fix direction: If the ellipsis should be announced, remove `aria-hidden` from the wrapper and hide only the icon. If it should be decorative, remove the unreachable `sr-only` text to avoid a misleading implementation.

## src/app/components/ui/button.tsx

### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 39-56
- Description: `Button` renders a native `<button>` by default but does not set `type="button"`. When used inside a form without an explicit `type`, it will submit the form unintentionally.
- Suggested fix direction: Default native buttons to `type="button"` when `asChild` is false, while still allowing callers to pass `type="submit"` explicitly.

## src/app/components/ui/calendar.tsx

No findings.

## src/app/components/ui/carousel.tsx

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 95-103
- Description: The effect registers both `reInit` and `select` listeners on the Embla API, but cleanup removes only the `select` listener. Repeated API changes/remounts can leave stale `reInit` callbacks registered and update state after the component path has changed.
- Suggested fix direction: In the cleanup callback, call both `api.off("select", onSelect)` and `api.off("reInit", onSelect)`.

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 77-85
- Description: Keyboard handling only responds to `ArrowLeft` and `ArrowRight`. When `orientation="vertical"`, users would expect `ArrowUp`/`ArrowDown`; vertical carousels therefore have incomplete keyboard support.
- Suggested fix direction: Branch on `orientation` and map horizontal carousels to left/right and vertical carousels to up/down, or support both key pairs safely.

### Finding 7
- Category: bug
- Severity: medium
- Line numbers: 195-197, 225-227
- Description: `CarouselPrevious` and `CarouselNext` set internal `disabled` and `onClick` props before spreading caller props. A caller-supplied `onClick` can replace the scroll handler, and a caller-supplied `disabled` can re-enable controls when Embla says scrolling is unavailable.
- Suggested fix direction: Spread caller props before invariant props, or explicitly compose `onClick` handlers while preserving the internal disabled state, for example `disabled={props.disabled ?? !canScrollPrev}` depending on the intended API.

## src/app/components/ui/checkbox.tsx

No findings.

## src/app/components/ui/collapsible.tsx

No findings.

## src/app/components/ui/context-menu.tsx

No findings.

## src/app/components/ui/dialog.tsx

No findings.

## src/app/components/ui/disabled-with-reason.tsx

### Finding 8
- Category: failure-point
- Severity: medium
- Line numbers: 39-46
- Description: The tooltip trigger wrapper is a plain `<span>` with no `tabIndex`, despite the comment saying it intercepts hover/focus. Disabled controls are not focusable and the wrapper is not focusable either, so keyboard users cannot discover the disabled reason.
- Suggested fix direction: Make the wrapper keyboard-focusable (`tabIndex={0}`) and provide an accessible name/description, or use an enabled button-like wrapper with `aria-disabled="true"` and explicit click prevention.

## src/app/components/ui/drawer.tsx

No findings.

## src/app/components/ui/dropdown-menu.tsx

No findings.

## src/app/components/ui/empty-state.tsx

### Finding 9
- Category: failure-point
- Severity: low
- Line numbers: 27, 33-39
- Description: The title and action styling hard-code white text (`text-white`) and CTA colors instead of relying fully on semantic tokens. In non-dark themes or high-contrast themes, this can produce insufficient contrast or inconsistent theming.
- Suggested fix direction: Use semantic foreground/action tokens (`text-foreground`, `text-primary-foreground`, etc.) instead of fixed white text classes.

## src/app/components/ui/form-error-summary.tsx

### Finding 10
- Category: bug
- Severity: medium
- Line numbers: 30-37
- Description: `scrollToFirstError` searches the entire document for the first `[aria-invalid="true"]`. On pages with multiple forms or unrelated invalid widgets, the summary can scroll/focus a control outside the form that owns this summary.
- Suggested fix direction: Scope the query to the nearest form/summary container via a ref, or accept a form ref/id prop and query within that root.

## src/app/components/ui/form.tsx

### Finding 11
- Category: bug
- Severity: medium
- Line numbers: 27-29, 44-55, 71-73
- Description: `FormFieldContext` and `FormItemContext` are initialized with cast empty objects, so the guard `if (!fieldContext)` is unreachable. `useFormField` also calls `useFormContext`, `useFormState`, and `getFieldState` before validating that it is inside a `FormField`. If `FormLabel`, `FormControl`, or `FormMessage` is used outside the expected wrappers, the code can produce `undefined-form-item` ids or fail with a less useful provider error.
- Suggested fix direction: Initialize both contexts as `null`, check for missing `FormField` and `FormItem` before calling field-state helpers or building ids, and throw targeted errors for each missing wrapper.

## src/app/components/ui/input-otp.tsx

No findings.

## src/app/components/ui/input.tsx

No findings.

## src/app/components/ui/label.tsx

No findings.

## src/app/components/ui/menubar.tsx

No findings.

## src/app/components/ui/navigation-menu.tsx

No findings.

## src/app/components/ui/pagination.tsx

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 105-113
- Description: `PaginationEllipsis` sets `aria-hidden` on the wrapper while including an `sr-only` label (`More pages`). The label is hidden from assistive technologies because the parent is hidden.
- Suggested fix direction: Either remove `aria-hidden` and mark only the icon decorative, or remove the unreachable `sr-only` text if the ellipsis is intended to be purely decorative.

## src/app/components/ui/popover.tsx

No findings.

## src/app/components/ui/progress.tsx

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 24-25
- Description: The progress indicator transform uses `value || 0` directly and does not clamp or validate the value. Values outside 0-100, `NaN`, or values based on a non-100 max can produce invalid or misleading transforms.
- Suggested fix direction: Normalize against the root `max` value when applicable and clamp to `[0, 100]` before computing the translate percentage.

## src/app/components/ui/radio-group.tsx

No findings.

## src/app/components/ui/resizable.tsx

No findings.

## src/app/components/ui/scroll-area.tsx

No findings.

## src/app/components/ui/select.tsx

No findings.

## src/app/components/ui/separator.tsx

No findings.

## src/app/components/ui/sheet.tsx

No findings.

## src/app/components/ui/sidebar.tsx

### Finding 14
- Category: failure-point
- Severity: medium
- Line numbers: 264-278, 286-303, 417-436, 515-522, 560-576
- Description: Several sidebar controls render native buttons without a default `type="button"` (`SidebarTrigger` through `Button`, `SidebarRail`, `SidebarGroupAction`, `SidebarMenuButton`, and `SidebarMenuAction`). If these components are placed inside a form, clicking them can submit the form unexpectedly.
- Suggested fix direction: Default native sidebar buttons to `type="button"` while preserving explicit caller-provided `type` values and `asChild` behavior.

### Finding 15
- Category: failure-point
- Severity: medium
- Line numbers: 286-303
- Description: `SidebarRail` is a clickable `<button>` but is forced out of the tab order with `tabIndex={-1}`. It has an `aria-label`, but keyboard users cannot reach it to toggle the sidebar.
- Suggested fix direction: Keep the rail focusable or provide an equivalent keyboard-focusable toggle adjacent to it. If it must remain pointer-only, mark it appropriately and ensure another visible keyboard path exists.

### Finding 16
- Category: failure-point
- Severity: low
- Line numbers: 609-612
- Description: `SidebarMenuSkeleton` computes a random width during render. In SSR/hydration scenarios this can cause server/client markup drift; during remounts it can also create unnecessary layout variation.
- Suggested fix direction: Use deterministic skeleton widths, a CSS variable set by the caller, or a stable seeded value generated outside the render path.

## src/app/components/ui/skeleton.tsx

### Finding 17
- Category: failure-point
- Severity: low
- Line numbers: 113-122
- Description: `ChartSkeleton` computes bar heights with `Math.random()` during render. This makes the skeleton non-deterministic, can cause SSR hydration mismatches, and can visually jump on remount.
- Suggested fix direction: Replace runtime randomness with fixed placeholder heights or a stable seeded pattern.

## src/app/components/ui/slider.tsx

### Finding 18
- Category: bug
- Severity: high
- Line numbers: 16-23, 52-59
- Description: When neither `value` nor `defaultValue` is supplied, `_values` falls back to `[min, max]`, so the wrapper renders two thumbs by default. A consumer expecting the Radix/default single-value slider can get a range-style slider with two thumbs and ambiguous initial state.
- Suggested fix direction: Default to a single thumb (for example `[min]` or Radix's own default) unless the caller explicitly supplies a multi-value `value`/`defaultValue`, or document and rename the component as a range slider if two thumbs are intended.

## src/app/components/ui/sonner.tsx

No findings.

## src/app/components/ui/switch.tsx

No findings.

## src/app/components/ui/table.tsx

No findings.

## src/app/components/ui/tabs.tsx

No findings.

## src/app/components/ui/textarea.tsx

No findings.

## src/app/components/ui/toggle-group.tsx

No findings.

## src/app/components/ui/toggle.tsx

No findings.

## src/app/components/ui/tooltip.tsx

### Finding 19
- Category: failure-point
- Severity: low
- Line numbers: 21-28
- Description: The `Tooltip` convenience component wraps every tooltip in a new `TooltipProvider` with the local default `delayDuration=0`. This prevents an app-level `TooltipProvider` from consistently controlling tooltip delay/skip behavior and can lead to unexpected timing differences across tooltips.
- Suggested fix direction: Export `TooltipPrimitive.Root` directly for `Tooltip`, or only provide `TooltipProvider` at the application/layout level so provider configuration is centralized.

## src/app/components/ui/unsaved-changes-dialog.tsx

### Finding 20
- Category: bug
- Severity: high
- Line numbers: 26, 37-54
- Description: `onOpenChange={(o) => !o && onCancel()}` calls `onCancel` whenever the alert dialog closes. `AlertDialogAction` normally closes the dialog after Save or Discard, so `onSave`/`onDiscard` can be followed by `onCancel`. Clicking Cancel can also invoke `onCancel` from both the button `onClick` and `onOpenChange`.
- Suggested fix direction: Track the action that initiated close, or avoid mapping every close event to cancel. Invoke `onCancel` only from the explicit Cancel path and let Save/Discard close without firing the cancel callback.

## src/app/components/ui/use-mobile.ts

No findings.

## src/app/components/ui/utils.ts

No findings.

## src/app/components/ui/ZoneBadge.tsx

### Finding 21
- Category: failure-point
- Severity: medium
- Line numbers: 68-75
- Description: If `ZoneBadge` is rendered with `showLabel={false}`, the visual output can be only a color dot with no accessible text. The `title` attribute on the non-focusable wrapper is not a reliable accessible name for screen-reader or keyboard users.
- Suggested fix direction: Add an `aria-label` based on `zone.label` and `systemLabel`, or keep a visually hidden label whenever the visible label is suppressed.
