# Sidebar UX/UI Polish — "Branded but Restrained"

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Visual polish of the AppSidebar component to elevate it from generic shadcn to Phoenix-branded

## Goal

Make the sidebar feel distinctly "Phoenix" — warm, polished, intentional — without competing with page content or becoming gimmicky. Fix concrete issues (icon scaling, unthemed scrollbar) and layer in subtle brand personality (ember glows, gradient accents, warm tinting).

## Files to Modify

- `src/app/components/AppSidebar.tsx` — structure, icon sizing, layout changes
- `src/styles/theme.css` — scrollbar theme, sidebar CSS utilities, hover/active effects

**Not modified:** `src/app/components/ui/sidebar.tsx` (shadcn primitive stays untouched)

## Design Sections

### 1. Icon Sizing & Consistency

**Problem:** Icons use the default `[&>svg]:size-4` (16px) from the shadcn primitive, which feels small in the `size="lg"` (h-12) menu buttons and cramped in collapsed mode.

**Changes (AppSidebar.tsx):**
- Set all Lucide icons to explicit `size={20}` prop
- This proportions well with h-12 buttons in expanded state and the 32px icon-only container in collapsed state

### 2. Themed Scrollbar

**Problem:** Browser-default grey scrollbar clashes with dark Phoenix theme.

**Changes (theme.css):**
- Target `[data-sidebar="content"]` with custom scrollbar rules
- Track: transparent
- Thumb: `rgba(255, 107, 53, 0.15)`, rounded
- Thumb hover: `rgba(255, 107, 53, 0.3)`
- Width: 6px
- Firefox fallback: `scrollbar-color` and `scrollbar-width: thin`

### 3. Sidebar Background & Border

**Problem:** Flat dark background with plain border feels like a slab.

**Changes (theme.css + AppSidebar.tsx):**
- Background: vertical gradient from `var(--surface-1)` (#141414) at top to `var(--surface-0)` (#0D0D0D) at bottom
- Right border: keep existing 1px border, add soft `box-shadow: 1px 0 8px rgba(255,107,53,0.06)` for faint ember glow
- **Implementation:** The shadcn primitive applies `bg-sidebar` on the inner `[data-sidebar="sidebar"]` div. Since we're not modifying the primitive, override this in theme.css with a higher-specificity rule: `[data-sidebar="sidebar"] { background: linear-gradient(to bottom, var(--surface-1), var(--surface-0)); box-shadow: 1px 0 8px rgba(255,107,53,0.06); }`

### 4. Active State & Hover Effects

**Problem:** Active state (flat 10% ember bg + thin 2px left bar) barely registers. Hover is similarly plain.

**Active item changes (AppSidebar.tsx + theme.css):**
- Left accent bar: `w-[3px]` solid `bg-primary` (#FF6B35), rounded
- Background: horizontal gradient `rgba(255,107,53,0.12)` left → transparent right
- Text and icon: `text-primary` (#FF6B35)
- **Implementation:** The shadcn primitive applies `data-[active=true]:bg-sidebar-accent` on menu buttons. Override this via CSS in theme.css: `[data-sidebar="menu-button"][data-active="true"] { background: linear-gradient(to right, rgba(255,107,53,0.12), transparent) !important; color: var(--primary); }`. The `!important` is needed to beat the CVA variant specificity.

**Hover changes (theme.css):**
- Background: `rgba(255,107,53,0.06)`
- Text/icon shift to slightly warmer white
- Transition: `150ms ease`

**Collapsed state (AppSidebar.tsx):**
- Active icon button: `ring-1 ring-primary/20` ember ring. This is applied via a conditional className in AppSidebar, not on the primitive. On `focus-visible`, the shadcn `ring-2` focus ring replaces the active ring (higher specificity via `focus-visible:` prefix).
- Hover: same soft background glow

### 5. Group Labels & Separators

**Problem:** Pure grey labels and flat border separators feel disconnected from Phoenix palette.

**Group label changes (theme.css):**
- Tint to warm grey. Exact value: `#B08968` — a desaturated warm tan that reads as "warm grey" against the dark sidebar. Applied via CSS on `[data-sidebar="group-label"]`.
- Keep existing `eyebrow` treatment (11px, uppercase, letter-spacing)

**Separator changes (theme.css):**
- Replace solid line with horizontal gradient: `transparent → rgba(255,107,53,0.15) → transparent`
- Applied via utility class `.sidebar-separator-phoenix`

### 6. Footer Polish

**Problem:** Footer area is functional but plain. Collapse toggle is an afterthought.

**User section changes (AppSidebar.tsx + theme.css):**
- Gradient separator above the user section (same style as nav separators)
- Avatar ring: `ring-2 ring-primary/40` (up from `ring-1 ring-primary/30`)
- Avatar hover: `shadow-[0_0_8px_rgba(255,107,53,0.2)]` ember glow

**Collapse toggle changes (AppSidebar.tsx):**
- Move `<SidebarTrigger>` from `<SidebarFooter>` into `<SidebarHeader>`
- **Expanded layout:** The header becomes a flex row: `[PhoenixLogo + "Phoenix Portal" text]` on the left, `<SidebarTrigger>` on the right (using `ml-auto`). The trigger sits outside the `<NavLink>` wrapper.
- **Collapsed layout:** The text is hidden via existing `group-data-[collapsible=icon]:hidden`. The trigger renders below the logo in a stacked flex column. The trigger is `size-7` (28px) which fits comfortably in the `3rem` (48px) icon-width sidebar.
- Hover: warm tint matching nav items

**Collapsed footer:**
- Avatar only — clean and tight
- Dropdown menu behavior unchanged

## Out of Scope

- shadcn `sidebar.tsx` primitive modifications
- Nav group structure / route paths
- Mobile behavior (`MobileBottomNav`)
- Dropdown menu content or behavior
- Animations beyond CSS transitions (no Framer Motion additions)

## Reduced Motion

New hover transitions (150ms ease) are short and functional — no suppression needed. The avatar ember glow `box-shadow` on hover is interactive feedback, not decorative animation, so it also does not need `prefers-reduced-motion` suppression. No new entries in the reduced-motion section of theme.css are required.

## Testing

- Visual verification in both expanded and collapsed states
- Verify scrollbar theming in Chrome and Firefox
- Confirm collapse toggle still works after relocation
- Confirm dropdown menu still opens from footer avatar
- Check hover/active states across all nav items
- Verify no layout shift when transitioning between states
- Run existing unit tests (`npm test`)
- Run typecheck (`npm run typecheck`)
