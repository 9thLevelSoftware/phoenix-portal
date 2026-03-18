import { useMemo } from "react";
import { EChartsWrapper } from "./shared/EChartsWrapper";

export interface CommunityDistributionProps {
	percentiles: Record<string, number>;
	userValue: number;
	color: string;
	label: string;
}

/**
 * Generates smooth bell curve points from percentile data.
 * Maps percentile keys (p10, p25, p50, p75, p90) to x-axis positions (10..90)
 * and fits a curve through known value points.
 */
function generateBellCurvePoints(
	percentiles: Record<string, number>,
): [number, number][] {
	// Extract known percentile values sorted by percentile rank
	const knownPcts: Array<[number, number]> = Object.entries(percentiles)
		.map(([key, val]): [number, number] | null => {
			const match = key.match(/^p(\d+)$/);
			if (!match) return null;
			return [Number(match[1]), val];
		})
		.filter((x): x is [number, number] => x !== null)
		.sort((a, b) => a[0] - b[0]);

	if (knownPcts.length < 2) return [];

	const minVal = knownPcts[0][1];
	const maxVal = knownPcts[knownPcts.length - 1][1];
	const range = maxVal - minVal || 1;

	// Generate a smooth bell-curve shape using normal distribution approximation
	// Map value domain to percentile domain via linear interpolation
	const valueToPercentile = (v: number): number => {
		for (let i = 0; i < knownPcts.length - 1; i++) {
			const [pct0, val0] = knownPcts[i];
			const [pct1, val1] = knownPcts[i + 1];
			if (v >= val0 && v <= val1) {
				const t = (v - val0) / (val1 - val0);
				return pct0 + t * (pct1 - pct0);
			}
		}
		if (v <= minVal) return knownPcts[0][0];
		return knownPcts[knownPcts.length - 1][0];
	};

	// Compute bell density at each percentile rank using standard normal approximation
	// pct -> z-score via probit approximation, density = standard normal PDF
	const percentileToDensity = (pct: number): number => {
		// Rational approximation to inverse CDF (probit)
		const p = pct / 100;
		const clamped = Math.max(0.001, Math.min(0.999, p));
		// Simple symmetric bell: peak at 50th percentile
		const z = (clamped - 0.5) * 6; // map [0,1] to roughly [-3,3]
		return Math.exp(-0.5 * z * z);
	};

	// Sample N points across the value domain
	const numPoints = 40;
	const points: [number, number][] = [];
	for (let i = 0; i <= numPoints; i++) {
		const val = minVal + (i / numPoints) * range;
		const pct = valueToPercentile(val);
		const density = percentileToDensity(pct);
		points.push([val, density]);
	}

	return points;
}

export function CommunityDistribution({
	percentiles,
	userValue,
	color,
	label,
}: CommunityDistributionProps) {
	const option = useMemo(() => {
		const points = generateBellCurvePoints(percentiles);
		if (points.length === 0) return {};

		const minX = points[0][0];
		const maxX = points[points.length - 1][0];

		// Split into left (below user) and right (at/above user) for colored fill
		const leftPoints = points.filter(([x]) => x <= userValue);
		const rightPoints = points.filter(([x]) => x >= userValue);

		// Ensure continuity at the boundary
		const lastLeft = leftPoints[leftPoints.length - 1];
		const firstRight = rightPoints[0];
		if (lastLeft && firstRight && lastLeft[0] !== firstRight[0]) {
			// Interpolate y at userValue
			const prevPt = [...points].reverse().find(([x]: [number, number]) => x < userValue);
			const nextPt = points.find(([x]) => x > userValue);
			if (prevPt && nextPt) {
				const t = (userValue - prevPt[0]) / (nextPt[0] - prevPt[0]);
				const y = prevPt[1] + t * (nextPt[1] - prevPt[1]);
				leftPoints.push([userValue, y]);
				rightPoints.unshift([userValue, y]);
			}
		}

		return {
			grid: {
				top: 2,
				bottom: 2,
				left: 2,
				right: 2,
			},
			xAxis: {
				type: "value",
				show: false,
				min: minX,
				max: maxX,
			},
			yAxis: {
				type: "value",
				show: false,
				min: 0,
			},
			tooltip: { show: false },
			series: [
				// Gray area — below user
				{
					type: "line",
					data: leftPoints,
					smooth: true,
					symbol: "none",
					lineStyle: { color: "#4B5563", width: 1.5 },
					areaStyle: { color: "#4B556322" },
					silent: true,
					z: 1,
				},
				// Colored area — above user (right of "YOU" line)
				{
					type: "line",
					data: rightPoints,
					smooth: true,
					symbol: "none",
					lineStyle: { color, width: 1.5 },
					areaStyle: { color: `${color}33` },
					silent: true,
					z: 2,
					markLine: {
						silent: true,
						symbol: "none",
						animation: false,
						lineStyle: {
							color,
							type: "solid",
							width: 2,
						},
						label: {
							formatter: "YOU",
							position: "insideEndTop",
							color,
							fontSize: 8,
							fontWeight: 700,
						},
						data: [{ xAxis: userValue }],
					},
				},
			],
		};
	}, [percentiles, userValue, color]);

	return (
		<div
			role="img"
			aria-label={`${label} community distribution. Your value: ${userValue}`}
		>
			<EChartsWrapper option={option} height={60} />
		</div>
	);
}
