import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/app/components/ui/popover";
import type { RepQualityResult } from "@/lib/rep-quality";

interface QualityBadgeProps {
	qualityResult: RepQualityResult;
	repNumber: number;
}

/**
 * Corner overlay badge showing current rep quality score.
 * Tap/click to expand full breakdown of quality factors.
 */
export function QualityBadge({ qualityResult, repNumber }: QualityBadgeProps) {
	const { score, factors, isLowQuality } = qualityResult;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={`
            flex flex-col items-center justify-center
            w-14 h-14 rounded-lg
            text-white font-semibold
            transition-colors cursor-pointer
            ${isLowQuality ? "bg-amber-600/80 hover:bg-amber-600" : "bg-primary/90 hover:bg-primary"}
          `}
					aria-label={`Rep ${repNumber} quality: ${score}`}
				>
					<span className="text-lg leading-none">{score}</span>
					<span className="text-[10px] text-white/70 mt-0.5">
						Rep {repNumber}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-56">
				<div className="space-y-3">
					<h4 className="font-medium text-sm">Rep {repNumber} Quality</h4>
					<div className="space-y-2">
						<QualityFactorRow
							label="Velocity Consistency"
							value={factors.velocityConsistency}
							hint="Higher is better"
						/>
						<QualityFactorRow
							label="ROM Score"
							value={factors.romScore}
							hint="Higher is better"
						/>
						<QualityFactorRow
							label="Balance"
							value={factors.asymmetryPenalty}
							hint="Higher is more balanced"
						/>
						<QualityFactorRow
							label="Time Under Tension"
							value={factors.tutScore}
							hint="Higher is better"
						/>
					</div>
					<div className="pt-2 border-t border-border">
						<div className="flex justify-between items-center">
							<span className="text-sm font-medium">Overall</span>
							<span
								className={`text-lg font-bold ${isLowQuality ? "text-amber-500" : "text-primary"}`}
							>
								{score}
							</span>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

interface QualityFactorRowProps {
	label: string;
	value: number;
	hint?: string;
}

function QualityFactorRow({ label, value, hint }: QualityFactorRowProps) {
	return (
		<div className="flex justify-between items-center text-sm">
			<span className="text-muted-foreground" title={hint}>
				{label}
			</span>
			<div className="flex items-center gap-1.5">
				<span className={value < 60 ? "text-amber-500" : "text-foreground"}>
					{value}%
				</span>
				{hint && (
					<span className="text-[10px] text-muted-foreground/60">
						{value >= 80 ? "Good" : value >= 60 ? "OK" : "Low"}
					</span>
				)}
			</div>
		</div>
	);
}
