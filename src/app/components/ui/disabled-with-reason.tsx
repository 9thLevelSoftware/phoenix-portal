import type * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/**
 * Wraps a disabled button/element with a tooltip that explains WHY it's disabled.
 *
 * Interaction design reference: "disabled elements must explain why they're disabled.
 * A grayed-out button with no context leaves users guessing."
 *
 * The challenge: disabled elements don't fire mouse events, so tooltips can't
 * attach directly. This wrapper adds a focusable span that intercepts hover/focus
 * while blocking click-through to the disabled child.
 *
 * Usage:
 *   <DisabledWithReason reason="Subscribe to EMBER to unlock analytics">
 *     <Button disabled>View Analytics</Button>
 *   </DisabledWithReason>
 *
 *   // Conditional: only wrap when actually disabled
 *   {canAccess ? (
 *     <Button onClick={handleClick}>View Analytics</Button>
 *   ) : (
 *     <DisabledWithReason reason="Subscribe to EMBER to unlock">
 *       <Button disabled>View Analytics</Button>
 *     </DisabledWithReason>
 *   )}
 */
export function DisabledWithReason({
	reason,
	children,
	side = "top",
}: {
	reason: string;
	children: React.ReactNode;
	side?: "top" | "bottom" | "left" | "right";
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* Focusable wrapper: intercepts hover/focus that disabled children swallow.
				    tabIndex={0} makes it keyboard-discoverable.
				    cursor-not-allowed signals non-interactivity. */}
				<span
					className="inline-flex cursor-not-allowed"
					tabIndex={0}
					role="note"
					aria-label={reason}
				>
					{/* pointer-events-none prevents clicks from reaching the disabled child,
					    avoiding confusing "nothing happened" on click. */}
					<span className="pointer-events-none">{children}</span>
				</span>
			</TooltipTrigger>
			<TooltipContent side={side} className="max-w-[240px]">
				{reason}
			</TooltipContent>
		</Tooltip>
	);
}
