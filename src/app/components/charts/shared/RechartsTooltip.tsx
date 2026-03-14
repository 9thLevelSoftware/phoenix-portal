import type { TooltipProps } from "recharts";

interface RechartsTooltipProps extends TooltipProps<number, string> {
	/** Optional unit suffix for values (e.g., "kg", "lbs", "%") */
	unit?: string;
	/** Optional value formatter */
	formatValue?: (value: number) => string;
}

export function RechartsTooltip({
	active,
	payload,
	label,
	unit,
	formatValue,
}: RechartsTooltipProps) {
	if (!active || !payload?.length) return null;

	return (
		<div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2 shadow-lg">
			<p className="mb-1 text-xs text-muted-foreground font-medium">{label}</p>
			{payload.map((entry) => (
				<div key={entry.name} className="flex items-center gap-2 text-sm">
					<span
						className="h-2 w-2 rounded-full shrink-0"
						style={{ backgroundColor: entry.color }}
					/>
					<span className="text-muted-foreground">{entry.name}:</span>
					<span className="font-medium text-foreground">
						{formatValue ? formatValue(entry.value as number) : entry.value}
						{unit && ` ${unit}`}
					</span>
				</div>
			))}
		</div>
	);
}
