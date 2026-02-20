import type { ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";

interface FeatureHintProps {
	/** Unique identifier for this hint (persisted in dismissed_hints JSONB) */
	hintId: string;
	/** Tooltip content text */
	content: string;
	/** The element to wrap with the hint tooltip */
	children: ReactNode;
	/** Which side of the trigger to show the tooltip */
	side?: "top" | "right" | "bottom" | "left";
}

/**
 * Reusable feature discovery hint component.
 * Wraps children with a Radix Tooltip that shows once, with a "Got it" dismiss button.
 * Only shows after onboarding is complete and for hints not yet dismissed.
 *
 * Usage by feature plans:
 * ```tsx
 * <FeatureHint hintId="analytics-charts" content="View detailed training analytics here" side="bottom">
 *   <AnalyticsButton />
 * </FeatureHint>
 * ```
 */
export function FeatureHint({
	hintId,
	content,
	children,
	side = "bottom",
}: FeatureHintProps) {
	const { showHints, onboarding, dismissHint } = useOnboarding();

	// Don't show hints if onboarding isn't complete or this hint was already dismissed
	const isDismissed = onboarding?.dismissed_hints?.[hintId] === true;
	const shouldShow = showHints && !isDismissed;

	if (!shouldShow) {
		return <>{children}</>;
	}

	return (
		<Tooltip defaultOpen>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side={side}
				sideOffset={8}
				className="max-w-[240px] bg-[#1A1A1A] border border-[#FF6B35]/30 text-white p-3"
			>
				<p className="text-xs text-[#9CA3AF] mb-2">{content}</p>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-xs text-[#FF6B35] hover:text-[#FF6B35]/80 hover:bg-white/5"
					onClick={() => dismissHint.mutate({ hintId })}
				>
					Got it
				</Button>
			</TooltipContent>
		</Tooltip>
	);
}
