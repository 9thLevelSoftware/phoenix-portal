import { useMemo, useState } from "react";
import { PHOENIX } from "@/lib/colors";
import { formatVolume, type WeightUnit } from "@/lib/units";

export interface MuscleHeatmapProps {
	muscleVolumes: Record<string, number>;
	unit?: WeightUnit;
}

interface MuscleRegion {
	name: string;
	paths: string[];
	dataKey: string;
	labelX: number;
	labelY: number;
	labelAnchor: "start" | "end";
}

// Simplified front-view male body SVG regions
const FRONT_MUSCLE_REGIONS: MuscleRegion[] = [
	{
		name: "Shoulders",
		dataKey: "Shoulders",
		paths: [
			// Left deltoid
			"M 58,72 Q 48,70 42,78 Q 40,84 44,90 L 58,86 Z",
			// Right deltoid
			"M 122,72 Q 132,70 138,78 Q 140,84 136,90 L 122,86 Z",
		],
		labelX: 28,
		labelY: 82,
		labelAnchor: "end",
	},
	{
		name: "Chest",
		dataKey: "Chest",
		paths: [
			// Left pectoral
			"M 58,72 L 58,86 L 60,100 Q 70,104 88,100 L 90,72 Q 74,66 58,72",
			// Right pectoral
			"M 122,72 L 122,86 L 120,100 Q 110,104 92,100 L 90,72 Q 106,66 122,72",
		],
		labelX: 156,
		labelY: 88,
		labelAnchor: "start",
	},
	{
		name: "Arms",
		dataKey: "Arms",
		paths: [
			// Left bicep
			"M 44,90 Q 38,100 36,114 Q 36,126 40,136 L 50,136 Q 54,120 56,108 L 58,86 L 44,90",
			// Right bicep
			"M 136,90 Q 142,100 144,114 Q 144,126 140,136 L 130,136 Q 126,120 124,108 L 122,86 L 136,90",
			// Left forearm
			"M 40,136 Q 36,150 34,168 L 44,168 Q 48,150 50,136 Z",
			// Right forearm
			"M 140,136 Q 144,150 146,168 L 136,168 Q 132,150 130,136 Z",
		],
		labelX: 24,
		labelY: 130,
		labelAnchor: "end",
	},
	{
		name: "Core",
		dataKey: "Core",
		paths: [
			// Abdominals
			"M 72,102 L 70,140 Q 72,154 80,158 L 90,160 L 100,158 Q 108,154 110,140 L 108,102 Q 90,108 72,102",
		],
		labelX: 156,
		labelY: 130,
		labelAnchor: "start",
	},
	{
		name: "Legs",
		dataKey: "Legs",
		paths: [
			// Left quad
			"M 70,158 Q 66,178 64,200 Q 62,220 64,240 L 78,240 Q 82,220 84,200 Q 86,178 90,160 L 80,158 Z",
			// Right quad
			"M 110,158 Q 114,178 116,200 Q 118,220 116,240 L 102,240 Q 98,220 96,200 Q 94,178 90,160 L 100,158 Z",
			// Left calf
			"M 64,248 Q 62,268 64,290 L 76,290 Q 78,268 78,248 Z",
			// Right calf
			"M 116,248 Q 118,268 116,290 L 104,290 Q 102,268 102,248 Z",
		],
		labelX: 28,
		labelY: 200,
		labelAnchor: "end",
	},
	{
		name: "Back",
		dataKey: "Back",
		paths: [
			// Upper back/lats visible from front as side torso width
			"M 58,86 L 56,108 Q 58,120 60,100 L 70,102 Q 68,92 58,86",
			"M 122,86 L 124,108 Q 122,120 120,100 L 110,102 Q 112,92 122,86",
		],
		labelX: 156,
		labelY: 108,
		labelAnchor: "start",
	},
];

// Back-view muscle regions using the same viewBox
const BACK_MUSCLE_REGIONS: MuscleRegion[] = [
	{
		name: "Traps",
		dataKey: "Shoulders",
		paths: [
			// Left trapezius
			"M 74,58 L 58,72 L 58,82 Q 68,78 78,74 L 90,68 L 90,58 Q 82,56 74,58",
			// Right trapezius
			"M 106,58 L 122,72 L 122,82 Q 112,78 102,74 L 90,68 L 90,58 Q 98,56 106,58",
		],
		labelX: 28,
		labelY: 72,
		labelAnchor: "end",
	},
	{
		name: "Lats",
		dataKey: "Back",
		paths: [
			// Left lat
			"M 58,82 L 56,100 Q 58,114 62,122 L 72,128 Q 78,118 80,104 L 78,88 Q 68,82 58,82",
			// Right lat
			"M 122,82 L 124,100 Q 122,114 118,122 L 108,128 Q 102,118 100,104 L 102,88 Q 112,82 122,82",
		],
		labelX: 156,
		labelY: 105,
		labelAnchor: "start",
	},
	{
		name: "Lower Back",
		dataKey: "Back",
		paths: [
			// Erector spinae / lumbar
			"M 72,128 Q 76,140 80,152 L 90,156 L 100,152 Q 104,140 108,128 Q 100,122 90,120 Q 80,122 72,128",
		],
		labelX: 156,
		labelY: 140,
		labelAnchor: "start",
	},
	{
		name: "Glutes",
		dataKey: "Legs",
		paths: [
			// Left glute
			"M 68,156 Q 64,164 66,174 Q 68,182 76,184 L 90,180 L 90,156 L 80,152 Q 74,152 68,156",
			// Right glute
			"M 112,156 Q 116,164 114,174 Q 112,182 104,184 L 90,180 L 90,156 L 100,152 Q 106,152 112,156",
		],
		labelX: 28,
		labelY: 170,
		labelAnchor: "end",
	},
	{
		name: "Hamstrings",
		dataKey: "Legs",
		paths: [
			// Left hamstring
			"M 66,186 Q 64,206 62,226 Q 62,240 64,248 L 78,248 Q 80,236 82,220 Q 84,200 86,186 L 76,184 Q 70,184 66,186",
			// Right hamstring
			"M 114,186 Q 116,206 118,226 Q 118,240 116,248 L 102,248 Q 100,236 98,220 Q 96,200 94,186 L 104,184 Q 110,184 114,186",
		],
		labelX: 156,
		labelY: 216,
		labelAnchor: "start",
	},
	{
		name: "Calves",
		dataKey: "Legs",
		paths: [
			// Left calf (back view)
			"M 64,250 Q 60,266 62,282 Q 64,292 68,296 L 78,296 Q 80,288 80,276 Q 80,264 78,250 Z",
			// Right calf (back view)
			"M 116,250 Q 120,266 118,282 Q 116,292 112,296 L 102,296 Q 100,288 100,276 Q 100,264 102,250 Z",
		],
		labelX: 28,
		labelY: 272,
		labelAnchor: "end",
	},
];

// Body outline path (front view)
const BODY_OUTLINE_FRONT =
	"M 90,20 Q 78,20 72,30 Q 66,42 66,54 Q 66,64 72,68 Q 58,66 48,70 Q 38,74 36,84 Q 34,96 32,114 Q 30,132 32,148 Q 30,158 28,170 L 38,170 Q 42,156 44,148 Q 48,154 56,160 Q 62,164 64,174 Q 60,190 58,210 Q 56,230 58,248 Q 56,260 56,278 Q 56,292 60,298 L 82,298 Q 84,292 84,278 Q 84,260 82,248 Q 80,230 82,210 Q 84,196 90,182 Q 96,196 98,210 Q 100,230 98,248 Q 96,260 96,278 Q 96,292 98,298 L 120,298 Q 124,292 124,278 Q 124,260 122,248 Q 120,230 122,210 Q 120,190 116,174 Q 118,164 124,160 Q 132,154 136,148 Q 138,156 142,170 L 152,170 Q 150,158 148,148 Q 150,132 148,114 Q 146,96 144,84 Q 142,74 132,70 Q 122,66 108,68 Q 114,64 114,54 Q 114,42 108,30 Q 102,20 90,20 Z";

// Body outline path (back view - same silhouette)
const BODY_OUTLINE_BACK =
	"M 90,20 Q 78,20 72,30 Q 66,42 66,54 Q 66,64 72,68 Q 58,66 48,70 Q 38,74 36,84 Q 34,96 32,114 Q 30,132 32,148 Q 30,158 28,170 L 38,170 Q 42,156 44,148 Q 48,154 56,160 Q 62,164 64,174 Q 60,190 58,210 Q 56,230 58,248 Q 56,260 56,278 Q 56,292 60,298 L 82,298 Q 84,292 84,278 Q 84,260 82,248 Q 80,230 82,210 Q 84,196 90,182 Q 96,196 98,210 Q 100,230 98,248 Q 96,260 96,278 Q 96,292 98,298 L 120,298 Q 124,292 124,278 Q 124,260 122,248 Q 120,230 122,210 Q 120,190 116,174 Q 118,164 124,160 Q 132,154 136,148 Q 138,156 142,170 L 152,170 Q 150,158 148,148 Q 150,132 148,114 Q 146,96 144,84 Q 142,74 132,70 Q 122,66 108,68 Q 114,64 114,54 Q 114,42 108,30 Q 102,20 90,20 Z";

const EMBER = PHOENIX.ember;

export function MuscleHeatmap({
	muscleVolumes,
	unit = "kg",
}: MuscleHeatmapProps) {
	const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
	const [hoveredDataKey, setHoveredDataKey] = useState<string | null>(null);
	const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
	const [view, setView] = useState<"front" | "back">("front");

	const { minVolume, maxVolume } = useMemo(() => {
		const values = Object.values(muscleVolumes).filter((v) => v > 0);
		if (values.length === 0) return { minVolume: 0, maxVolume: 1 };
		return { minVolume: Math.min(...values), maxVolume: Math.max(...values) };
	}, [muscleVolumes]);

	function getOpacity(volume: number): number {
		if (volume <= 0) return 0;
		if (maxVolume === minVolume) return 0.6;
		return 0.15 + ((volume - minVolume) / (maxVolume - minVolume)) * 0.85;
	}

	const regions = view === "front" ? FRONT_MUSCLE_REGIONS : BACK_MUSCLE_REGIONS;
	const bodyOutline = view === "front" ? BODY_OUTLINE_FRONT : BODY_OUTLINE_BACK;

	return (
		<div
			className="relative w-full"
			style={{ maxWidth: 320, margin: "0 auto" }}
		>
			<div className="flex gap-1 mb-3">
				<button
					type="button"
					onClick={() => setView("front")}
					className={`px-3 py-1 text-xs rounded-md transition-colors ${
						view === "front"
							? "bg-primary/20 text-primary"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					Front
				</button>
				<button
					type="button"
					onClick={() => setView("back")}
					className={`px-3 py-1 text-xs rounded-md transition-colors ${
						view === "back"
							? "bg-primary/20 text-primary"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					Back
				</button>
			</div>

			<svg
				viewBox="0 0 180 320"
				className="w-full h-auto"
				role="img"
				aria-label="Muscle group heatmap body diagram"
			>
				{/* Body outline */}
				<path
					d={bodyOutline}
					fill="none"
					stroke={PHOENIX.moltenSteel}
					strokeWidth={1.5}
					opacity={0.5}
				/>

				{/* Muscle regions */}
				{regions.map((region) => {
					const volume = muscleVolumes[region.dataKey] ?? 0;
					const opacity = getOpacity(volume);
					const isHovered = hoveredGroup === region.name;

					return (
						<g key={region.name}>
							{region.paths.map((path, i) => (
								// biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: SVG path needs role="img" for screen readers while also supporting hover
								<path
									// biome-ignore lint/suspicious/noArrayIndexKey: static SVG path list per region never reorders
									key={i}
									role="img"
									aria-label={`${region.name} muscle region`}
									d={path}
									fill={volume > 0 ? EMBER : "none"}
									fillOpacity={volume > 0 ? opacity : 0}
									stroke={volume > 0 ? EMBER : "#4B5563"}
									strokeWidth={isHovered ? 2 : 1}
									strokeOpacity={volume > 0 ? 0.8 : 0.4}
									style={{ cursor: "pointer", transition: "all 0.2s" }}
									onMouseEnter={(e) => {
										setHoveredGroup(region.name);
										setHoveredDataKey(region.dataKey);
										const rect = (
											e.currentTarget.ownerSVGElement as SVGSVGElement
										).getBoundingClientRect();
										setTooltipPos({
											x: e.clientX - rect.left,
											y: e.clientY - rect.top,
										});
									}}
									onMouseMove={(e) => {
										const rect = (
											e.currentTarget.ownerSVGElement as SVGSVGElement
										).getBoundingClientRect();
										setTooltipPos({
											x: e.clientX - rect.left,
											y: e.clientY - rect.top,
										});
									}}
									onMouseLeave={() => {
										setHoveredGroup(null);
										setHoveredDataKey(null);
									}}
								/>
							))}

							{/* Label */}
							<text
								x={region.labelX}
								y={region.labelY}
								fill={PHOENIX.mutedForeground}
								fontSize={9}
								textAnchor={region.labelAnchor}
								fontFamily="Inter, system-ui, sans-serif"
							>
								{region.name}
							</text>
						</g>
					);
				})}
			</svg>

			{/* Tooltip */}
			{hoveredGroup && hoveredDataKey && (
				<div
					className="pointer-events-none absolute z-10 rounded-md px-3 py-2 text-xs"
					style={{
						left: tooltipPos.x + 12,
						top: tooltipPos.y - 10,
						background: "var(--surface-2)",
						color: "var(--secondary-foreground)",
						border: "1px solid #374151",
						whiteSpace: "nowrap",
					}}
				>
					<span className="font-semibold" style={{ color: EMBER }}>
						{hoveredGroup}
					</span>
					:{" "}
					{(muscleVolumes[hoveredDataKey] ?? 0) > 0
						? formatVolume(muscleVolumes[hoveredDataKey], unit)
						: "No data"}
				</div>
			)}
		</div>
	);
}
