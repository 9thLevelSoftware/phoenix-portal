import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	RefreshCw,
	WifiOff,
} from "lucide-react";
import type { FreshnessState, FreshnessStatus } from "@/lib/freshness";

interface DataFreshnessStripProps {
	state: FreshnessState;
	className?: string;
}

const STATUS_STYLES: Record<
	FreshnessStatus,
	{ className: string; icon: typeof CheckCircle2 }
> = {
	live: {
		className: "border-success/30 bg-success/5 text-success",
		icon: CheckCircle2,
	},
	refreshing: {
		className: "border-primary/30 bg-primary/5 text-primary",
		icon: RefreshCw,
	},
	stale: {
		className: "border-warning/30 bg-warning/5 text-warning",
		icon: Clock,
	},
	reconnecting: {
		className: "border-warning/30 bg-warning/5 text-warning",
		icon: WifiOff,
	},
	partial: {
		className: "border-warning/30 bg-warning/5 text-warning",
		icon: AlertTriangle,
	},
	unavailable: {
		className: "border-secondary bg-muted/10 text-muted-foreground",
		icon: Clock,
	},
};

export function DataFreshnessStrip({
	state,
	className,
}: DataFreshnessStripProps) {
	const status = STATUS_STYLES[state.status];
	const Icon = status.icon;

	return (
		<div
			className={[
				"flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between",
				status.className,
				className ?? "",
			].join(" ")}
			role={state.status === "live" ? "status" : "alert"}
		>
			<div className="flex min-w-0 items-start gap-2 sm:items-center">
				<Icon className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden="true" />
				<div className="min-w-0">
					<div className="font-semibold">{state.label}</div>
					<div className="text-muted-foreground">{state.description}</div>
				</div>
			</div>
			{state.flags.length > 0 && (
				<div className="flex flex-wrap gap-1 sm:justify-end">
					{state.flags.map((flag) => (
						<span
							key={flag}
							className="rounded-full border border-current/20 px-2 py-0.5 text-[11px]"
						>
							{flag}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
