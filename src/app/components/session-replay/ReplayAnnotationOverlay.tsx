import type { ReplayIntelligence } from "@/lib/replay-intelligence";

interface ReplayAnnotationOverlayProps {
	intelligence: ReplayIntelligence;
	currentRepIndex: number;
	width: number;
	height: number;
}

const MARGIN = { top: 20, right: 20, bottom: 40, left: 50 };

function xForTime(
	timestampMs: number,
	durationMs: number,
	width: number,
): number {
	if (durationMs <= 0) return MARGIN.left;
	const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
	const clampedTime = Math.max(0, Math.min(timestampMs, durationMs));
	return MARGIN.left + (clampedTime / durationMs) * plotWidth;
}

export function ReplayAnnotationOverlay({
	intelligence,
	currentRepIndex,
	width,
	height,
}: ReplayAnnotationOverlayProps) {
	if (intelligence.status === "empty" || intelligence.durationMs <= 0) {
		return null;
	}

	const selectedRep = intelligence.repInsights[currentRepIndex];
	const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);

	return (
		<svg
			className="pointer-events-none absolute inset-0 rounded-lg"
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label="Replay annotations for selected reps and sticking points"
		>
			{selectedRep && (
				<rect
					x={xForTime(selectedRep.startMs, intelligence.durationMs, width)}
					y={MARGIN.top}
					width={Math.max(
						2,
						xForTime(selectedRep.endMs, intelligence.durationMs, width) -
							xForTime(selectedRep.startMs, intelligence.durationMs, width),
					)}
					height={plotHeight}
					fill="rgba(245, 158, 11, 0.08)"
					stroke="rgba(245, 158, 11, 0.65)"
					strokeDasharray="4 4"
				/>
			)}

			{intelligence.stickingPoints.map((point) => {
				const x = xForTime(point.timestampMs, intelligence.durationMs, width);
				return (
					<g key={`${point.repNumber}-${point.timestampMs}`}>
						<line
							x1={x}
							x2={x}
							y1={MARGIN.top}
							y2={MARGIN.top + plotHeight}
							stroke="rgba(245, 158, 11, 0.8)"
							strokeWidth="1.5"
						/>
						<circle cx={x} cy={MARGIN.top + 12} r="4" fill="#F59E0B" />
						<text
							x={Math.min(width - 44, x + 6)}
							y={MARGIN.top + 16}
							fill="#F59E0B"
							fontSize="10"
							fontWeight="700"
						>
							Rep {point.repNumber}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
