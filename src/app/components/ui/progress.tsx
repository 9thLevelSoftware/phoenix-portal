"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import type * as React from "react";

import { cn } from "./utils";

function Progress({
	className,
	value,
	max = 100,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	// Normalize against max and clamp to [0, 100] so out-of-range, NaN, or
	// non-100 max values never produce an invalid/misleading transform.
	const numericValue = Number(value);
	const numericMax = Number(max) > 0 ? Number(max) : 100;
	const percent = Number.isFinite(numericValue)
		? Math.min(100, Math.max(0, (numericValue / numericMax) * 100))
		: 0;

	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			value={value}
			max={max}
			className={cn(
				"bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
				className,
			)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className="bg-primary h-full w-full flex-1 transition-all"
				style={{ transform: `translateX(-${100 - percent}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
