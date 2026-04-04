# Sidebar UX/UI Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the AppSidebar from generic shadcn styling to a polished, Phoenix-branded component with themed scrollbar, ember accents, and improved visual hierarchy.

**Architecture:** All visual changes are split between `theme.css` (CSS overrides targeting shadcn data attributes) and `AppSidebar.tsx` (structure/layout changes). The shadcn `sidebar.tsx` primitive is NOT modified — all styling overrides use CSS specificity against its `data-sidebar` attributes.

**Tech Stack:** React 19, Tailwind CSS v4, shadcn/ui sidebar primitive, Lucide icons, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-17-sidebar-ux-polish-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/styles/theme.css` | Modify | Scrollbar, background gradient, active/hover overrides, group label tint, separator gradient, avatar hover glow |
| `src/app/components/AppSidebar.tsx` | Modify | Icon sizing, active state accent bar, header restructure (trigger relocation), footer cleanup, avatar ring |

---

## Task 1: CSS Foundation — Scrollbar, Background, Overrides

All theme.css additions. No component changes yet — pure CSS layered on top of existing shadcn data attributes.

**Files:**
- Modify: `src/styles/theme.css` (Steps 1-4 go inside the existing `@layer base` block, after the `[data-slot="card"]` rule. Steps 5-6 go inside `@layer utilities`.)

- [ ] **Step 1: Add sidebar scrollbar theming**

Add after the `[data-slot="card"]` rule (around line 186) inside `@layer base`:

```css
/* Phoenix sidebar scrollbar */
[data-sidebar="content"] {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 107, 53, 0.15) transparent;
}
[data-sidebar="content"]::-webkit-scrollbar {
  width: 6px;
}
[data-sidebar="content"]::-webkit-scrollbar-track {
  background: transparent;
}
[data-sidebar="content"]::-webkit-scrollbar-thumb {
  background: rgba(255, 107, 53, 0.15);
  border-radius: 3px;
}
[data-sidebar="content"]::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 107, 53, 0.3);
}
```

- [ ] **Step 2: Add sidebar background gradient and ember border glow**

Add immediately after the scrollbar rules (still inside `@layer base`):

```css
/* Phoenix sidebar background — warm gradient + ember border glow */
[data-sidebar="sidebar"] {
  background: linear-gradient(to bottom, var(--surface-1), var(--surface-0)) !important;
  box-shadow: 1px 0 8px rgba(255, 107, 53, 0.06);
}
```

- [ ] **Step 3: Add active state and hover overrides**

Add immediately after the background rules (still inside `@layer base`). Note: the hover rule uses `:not([data-active="true"])` to avoid overriding the active state's ember color, and the base transition is on the base selector so it animates both entering AND leaving hover:

```css
/* Phoenix sidebar active state — ember gradient */
[data-sidebar="menu-button"][data-active="true"] {
  background: linear-gradient(to right, rgba(255, 107, 53, 0.12), transparent) !important;
  color: var(--primary) !important;
}
[data-sidebar="menu-button"][data-active="true"] svg {
  color: var(--primary);
}

/* Phoenix sidebar hover — soft ember glow (non-active items only) */
[data-sidebar="menu-button"] {
  transition: background 150ms ease, color 150ms ease;
}
[data-sidebar="menu-button"]:not([data-active="true"]):hover {
  background: rgba(255, 107, 53, 0.06);
  color: #fff;
}
[data-sidebar="menu-button"]:not([data-active="true"]):hover svg {
  color: #fff;
}
```

- [ ] **Step 4: Add group label warm tint**

Add immediately after the hover rules (still inside `@layer base`):

```css
/* Phoenix sidebar group labels — warm grey */
[data-sidebar="group-label"] {
  color: #B08968;
}
```

- [ ] **Step 5: Add separator gradient utility**

Add inside `@layer utilities` (after the existing card tier utilities):

```css
/* Phoenix sidebar separator — ember gradient fade */
.sidebar-separator-phoenix {
  background: linear-gradient(90deg, transparent, rgba(255, 107, 53, 0.15), transparent) !important;
  border: none;
  height: 1px;
}
```

- [ ] **Step 6: Add avatar hover glow utility**

Add inside `@layer utilities`:

```css
/* Phoenix sidebar avatar hover glow */
.sidebar-avatar-hover {
  transition: box-shadow 150ms ease;
}
.sidebar-avatar-hover:hover {
  box-shadow: 0 0 8px rgba(255, 107, 53, 0.2);
}
```

- [ ] **Step 7: Run typecheck to verify no breakage**

Run: `npm run typecheck`
Expected: PASS (CSS-only changes, no TS impact)

- [ ] **Step 8: Commit CSS foundation**

```bash
git add src/styles/theme.css
git commit -m "feat: add Phoenix-branded sidebar CSS — scrollbar, background, active/hover, labels, separators"
```

---

## Task 2: Icon Sizing

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:219` (icon render line)

- [ ] **Step 1: Add explicit size={20} to nav item icons**

In `AppSidebar.tsx`, change line 219 from:

```tsx
<item.icon className="shrink-0" />
```

to:

```tsx
<item.icon className="shrink-0" size={20} />
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/components/AppSidebar.tsx
git commit -m "style: set sidebar nav icons to explicit 20px for better proportions"
```

---

## Task 3: Active State Accent Bar

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:221-223` (active indicator span)

- [ ] **Step 1: Update the active indicator bar**

In `AppSidebar.tsx`, change the active indicator span (lines 221-223) from:

```tsx
{isActive && (
  <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-full group-data-[collapsible=icon]:hidden" />
)}
```

to:

```tsx
{isActive && (
  <span className="absolute left-0 top-1 bottom-1 w-[3px] bg-primary rounded-full group-data-[collapsible=icon]:hidden" />
)}
```

- [ ] **Step 2: Add collapsed active ring to SidebarMenuButton**

In the `SidebarMenuButton` usage (lines 209-214), add a conditional className for the collapsed active ember ring. Change:

```tsx
<SidebarMenuButton
  asChild
  isActive={isActive}
  tooltip={item.label}
  size="lg"
>
```

to:

```tsx
<SidebarMenuButton
  asChild
  isActive={isActive}
  tooltip={item.label}
  size="lg"
  className={isActive ? "group-data-[collapsible=icon]:ring-1 group-data-[collapsible=icon]:ring-primary/20" : undefined}
>
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/components/AppSidebar.tsx
git commit -m "feat: enhance sidebar active state — thicker accent bar + collapsed ember ring"
```

---

## Task 4: Separators — Apply Phoenix Gradient

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:196` (SidebarSeparator usage)

- [ ] **Step 1: Add phoenix class to nav group separators**

In `AppSidebar.tsx`, change line 196 from:

```tsx
{groupIndex > 0 && <SidebarSeparator />}
```

to:

```tsx
{groupIndex > 0 && <SidebarSeparator className="sidebar-separator-phoenix" />}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/components/AppSidebar.tsx
git commit -m "feat: apply ember gradient to sidebar separators"
```

---

## Task 5: Header Restructure — Relocate Collapse Toggle

This is the most structural change. The `SidebarTrigger` moves from footer to header, and the header layout changes to accommodate it in both expanded and collapsed states.

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:178-188` (SidebarHeader), `src/app/components/AppSidebar.tsx:308-311` (SidebarFooter trigger)

- [ ] **Step 1: Restructure SidebarHeader**

Replace the current `SidebarHeader` block (lines 178-188):

```tsx
<SidebarHeader className="px-3 py-4">
  <NavLink
    to="/dashboard"
    className="flex items-center gap-3 cursor-pointer"
  >
    <PhoenixLogo size="sm" animated={false} />
    <span className="text-base font-semibold text-primary group-data-[collapsible=icon]:hidden whitespace-nowrap">
      Phoenix Portal
    </span>
  </NavLink>
</SidebarHeader>
```

with:

```tsx
<SidebarHeader className="px-3 py-4">
  <div className="flex items-center gap-3">
    <NavLink
      to="/dashboard"
      className="flex items-center gap-3 cursor-pointer"
    >
      <PhoenixLogo size="sm" animated={false} />
      <span className="text-base font-semibold text-primary group-data-[collapsible=icon]:hidden whitespace-nowrap">
        Phoenix Portal
      </span>
    </NavLink>
    <SidebarTrigger className="ml-auto text-muted-foreground hover:text-primary transition-colors group-data-[collapsible=icon]:hidden" />
  </div>
  <div className="hidden group-data-[collapsible=icon]:flex justify-center mt-1">
    <SidebarTrigger className="text-muted-foreground hover:text-primary transition-colors" />
  </div>
</SidebarHeader>
```

- [ ] **Step 2: Remove trigger from SidebarFooter**

Remove the collapse toggle section from SidebarFooter (lines 308-311):

```tsx
{/* Collapse toggle */}
<div className="flex justify-center">
  <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
</div>
```

Delete these 4 lines entirely.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All existing tests pass (no sidebar-specific tests exist, but verify nothing else breaks)

- [ ] **Step 5: Commit**

```bash
git add src/app/components/AppSidebar.tsx
git commit -m "refactor: relocate sidebar collapse toggle from footer to header"
```

---

## Task 6: Footer Polish — Avatar & Separator

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:238-250` (SidebarFooter section)

- [ ] **Step 1: Add gradient separator above footer user section**

In `AppSidebar.tsx`, change the SidebarFooter opening (line 238):

```tsx
<SidebarFooter className="gap-1 pb-3">
```

to:

```tsx
<SidebarFooter className="gap-1 pb-3">
  <SidebarSeparator className="sidebar-separator-phoenix" />
```

- [ ] **Step 2: Upgrade avatar ring and add hover glow**

Change the avatar button wrapper (line 243) from:

```tsx
<button
  type="button"
  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors outline-none"
>
```

to:

```tsx
<button
  type="button"
  className="sidebar-avatar-hover flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors outline-none"
>
```

- [ ] **Step 3: Upgrade avatar ring styling**

Change the Avatar (line 245) from:

```tsx
<Avatar className="h-8 w-8 shrink-0 ring-1 ring-primary/30">
```

to:

```tsx
<Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/40">
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: Both PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/components/AppSidebar.tsx
git commit -m "feat: polish sidebar footer — gradient separator, avatar ring + ember hover glow"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Visual verification checklist**

Start dev server (`npm run dev`) and verify:
1. Expanded sidebar: gradient background visible, ember border glow subtle
2. Scrollbar: themed ember when content overflows (may need to resize window)
3. Active nav item: 3px ember accent bar, gradient background, primary-colored text/icon
4. Hover on non-active items: soft ember background, white text
5. Group labels: warm tan color (#B08968)
6. Separators: gradient fade (not solid lines)
7. Header: collapse trigger on the right side of "Phoenix Portal"
8. Collapsed state: trigger centered below logo, active icon has ember ring
9. Footer: gradient separator above user section, avatar ring is stronger, avatar glows on hover
10. Dropdown menu still opens from avatar click

- [ ] **Step 5: Commit any remaining adjustments if needed**
