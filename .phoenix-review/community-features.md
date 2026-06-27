# Community Features Review

Scope reviewed:
- `src/app/components/Community.tsx`
- `src/app/components/CommunityRankings.tsx`
- `src/app/components/community/CommunityContentPreview.tsx`
- `src/app/components/community/CommunityDetailDrawer.tsx`
- `src/app/components/community/CommunityFilterPanel.tsx`
- `src/app/components/community/CommunitySearch.tsx`
- `src/app/components/community/ContentActionMenu.tsx`
- `src/app/components/community/CreatorProfile.tsx`
- `src/app/components/community/FeaturedCreators.tsx`
- `src/app/components/community/ReportDialog.tsx`
- `src/app/components/community/ShareContentDialog.tsx`
- `src/app/components/community/VoteButton.tsx`

Verification performed:
- Read all 12 assigned files in full.
- Ran `npm run typecheck -- --pretty false` successfully.

Summary:
- Findings: 14
- Severity breakdown: critical 0, high 4, medium 7, low 3

## `src/app/components/Community.tsx`

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 82-96, 249-250, 392-394
- Description: The same `sentinelRef` is attached to both the mobile and desktop infinite-scroll sentinels while both layouts remain mounted and are only hidden with CSS. React will ultimately assign the ref to one DOM node, so the observer can watch the hidden desktop sentinel on mobile instead of the visible mobile sentinel. This can prevent mobile users from loading pages beyond the first feed page.
- Suggested fix direction: Use separate refs/observers for mobile and desktop, or render only the active layout so the observed sentinel is always the visible one.

### Finding 2
- Category: bug
- Severity: high
- Line numbers: 108-117, 151-158, 293-299
- Description: Creator-profile interactions pass only an item id back to `Community`, while `Community` resolves the selected item only from the main feed's `allItems` and infers vote `itemType` from the current global tab. `CreatorProfile` displays both routines and cycles, so selecting an item not present in the main feed can open no drawer, and voting a creator cycle while the main tab is `routines` can submit the vote as a routine vote.
- Suggested fix direction: Pass the full feed item, or at least both `{ id, itemType }`, from `CreatorProfile`; resolve selected detail against the creator-profile item source instead of only the main feed; make vote handlers accept an explicit item type.

### Finding 3
- Category: bug
- Severity: high
- Line numbers: 378-387
- Description: Desktop feed cards do not pass `contentType` to `CommunityFeedCard`, so `CommunityFeedCard` defaults action-menu operations to `routine`. Cycle cards on desktop can therefore report/delete/use action metadata as routines, while the mobile branch correctly passes `contentType`.
- Suggested fix direction: Pass `contentType={activeTab === "routines" ? "routine" : "cycle"}` in the desktop `CommunityFeedCard` mapping as well.

## `src/app/components/CommunityRankings.tsx`

No findings.

## `src/app/components/community/CommunityContentPreview.tsx`

### Finding 4
- Category: failure-point
- Severity: low
- Line numbers: 23-25, 401-405
- Description: Missing or null embedded routine durations are formatted as `0 min`. For older or partial shared cycle snapshots this presents unknown data as a real zero-minute workout, which can mislead users reviewing imported/community content.
- Suggested fix direction: Distinguish unknown from zero by returning a placeholder such as `Duration unavailable` when the stored duration is null/undefined, and only display `0 min` for an explicit numeric zero if that is valid.

## `src/app/components/community/CommunityDetailDrawer.tsx`

### Finding 5
- Category: failure-point
- Severity: medium
- Line numbers: 207-244
- Description: Vote and save actions are rendered regardless of authentication state. The action menu is gated by `user`, but the vote/save buttons can still call mutations while logged out; `useVote` throws without a local toast, and `useSaveItem` surfaces a generic failure. This creates a confusing failure path for anonymous users.
- Suggested fix direction: Gate vote/save buttons behind auth, show a sign-in prompt, or add explicit unauthenticated handling before invoking the mutations.

## `src/app/components/community/CommunityFilterPanel.tsx`

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 109-117, 131-142
- Description: The labels use `htmlFor="muscle-group-filter"` and `htmlFor="difficulty-filter"`, but those ids are not applied to the corresponding select triggers. Screen readers will not reliably associate the labels with the controls.
- Suggested fix direction: Add matching ids to the `SelectTrigger` elements, or use the project/Radix-supported labeling pattern such as wrapping with a label or applying `aria-labelledby`.

## `src/app/components/community/CommunitySearch.tsx`

### Finding 7
- Category: bug
- Severity: medium
- Line numbers: 11-16
- Description: `CommunitySearch` owns its own `localValue` and only writes the debounced value to the shared community store; it never reads the current store value back. Because `Community` mounts separate mobile and desktop search boxes, the hidden instance can diverge from the visible query state, and responsive layout changes can show an empty input while the feed is still filtered by the previous search.
- Suggested fix direction: Initialize/synchronize `localValue` from `useCommunityStore((s) => s.search)`, or make the input controlled directly by the store with debounced query usage handled at the feed-query layer.

## `src/app/components/community/ContentActionMenu.tsx`

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 25-31, 80-95
- Description: The component's public props allow `contentType="comment"`, but the own-content delete path always casts `contentType` to `"routine" | "cycle"` and labels anything other than routine as `Cycle`. If this menu is used for an owned comment or an edit/delete-enabled comment flow, it will attempt to delete a shared cycle with the comment id instead of deleting the comment.
- Suggested fix direction: Split comment actions from routine/cycle actions, or branch explicitly for `contentType === "comment"` and call a comment-specific delete mutation. Avoid casting away the union member.

## `src/app/components/community/CreatorProfile.tsx`

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 72-86, 255-265
- Description: The loading state only tracks the routines query (`feedLoading`). The cycles query can still be loading or can fail, but the UI may already render an empty or partial shared-content list with no cycle loading/error indication.
- Suggested fix direction: Track `cycleLoading` and `cycleError` alongside `feedLoading`, and render loading/error/partial states based on both queries.

### Finding 10
- Category: failure-point
- Severity: medium
- Line numbers: 72-86, 104-106, 270-279
- Description: `CreatorProfile` uses infinite queries for routines and cycles but never calls `fetchNextPage` or renders a sentinel/load-more control. Creators with more than the first page of shared routines or cycles are silently truncated.
- Suggested fix direction: Add pagination controls or an intersection sentinel for both creator feed queries, or use a non-infinite query that intentionally fetches the full creator profile content needed by this view.

### Finding 11
- Category: bug
- Severity: high
- Line numbers: 49, 104-107, 271-278
- Description: `CreatorProfile` combines routine and cycle items into `allItems`, but card vote/select callbacks only receive an id. The parent `Community` vote handler uses the active global tab to decide item type, so votes on mixed creator-profile results can target the wrong table/type. This is the child-side contributor to the high-severity mixed-content bug also noted in `Community.tsx`.
- Suggested fix direction: Include item type in `CreatorProfile` callbacks, e.g. `onVote(item.id, isRoutine(item) ? "routine" : "cycle")` and `onSelectItem(item)`, and update callers accordingly.

## `src/app/components/community/FeaturedCreators.tsx`

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 34-47, 99-134
- Description: Scroll-button state is computed only when the scroll container first mounts and on scroll events. When loading skeletons are replaced by real creators, or when blocked-user filtering changes the creator list, `canScrollLeft`/`canScrollRight` may remain stale until the user manually scrolls.
- Suggested fix direction: Re-run `updateScrollState` when `isLoading`, `creators?.length`, or blocked-user data changes; consider a `ResizeObserver` for robust width changes.

## `src/app/components/community/ReportDialog.tsx`

No findings.

## `src/app/components/community/ShareContentDialog.tsx`

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 111-118, 147-158
- Description: Manual dialog closes pass `setOpen` directly and do not call `resetForm`. If the user closes the share dialog with the overlay/escape/close button and later reopens it, stale source selection, name, description, tags, difficulty, or success state can remain.
- Suggested fix direction: Wrap `onOpenChange` in a handler that resets form state whenever the dialog closes, and ensure controlled and uncontrolled modes both use that close handler.

## `src/app/components/community/VoteButton.tsx`

### Finding 14
- Category: failure-point
- Severity: medium
- Line numbers: 24-40
- Description: The button invokes `useVote` directly without explicit unauthenticated handling or local error feedback, and it does not stop propagation. If this component is embedded inside a clickable card or drawer trigger, a vote click can also trigger the parent click handler, and logged-out vote attempts fail through the mutation path rather than presenting a sign-in prompt.
- Suggested fix direction: Add an auth-aware guard/error callback, and call `event.stopPropagation()` inside the click handler when the component is intended for use inside clickable containers.
