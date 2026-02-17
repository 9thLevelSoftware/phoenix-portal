import {
	differenceInCalendarDays,
	eachDayOfInterval,
	format,
	startOfWeek,
	subWeeks,
} from "date-fns";
import { Flame } from "lucide-react";
import { useMemo, useState } from "react";
import { PHOENIX } from "@/lib/colors";

export interface ConsistencyCalendarProps {
	workoutDates: Date[];
	weeks?: number;
}

const CELL_SIZE = 10;
const CELL_GAP = 2;
const STEP = CELL_SIZE + CELL_GAP;
const EMBER = PHOENIX.ember;
const BG_EMPTY = "#1A1A2E";
const DAY_LABELS_WIDTH = 24;
const TOP_LABEL_HEIGHT = 18;

function getIntensity(count: number): string {
	if (count === 0) return BG_EMPTY;
	if (count === 1) return `${EMBER}66`; // 40% opacity
	if (count === 2) return `${EMBER}B3`; // 70% opacity
	return EMBER; // 100%
}

interface StreakResult {
	currentStreak: number;
	longestStreak: number;
}

function computeStreaks(dates: Date[]): StreakResult {
	if (dates.length === 0) return { currentStreak: 0, longestStreak: 0 };

	// Get unique days sorted ascending
	const uniqueDays = [
		...new Set(dates.map((d) => d.toISOString().slice(0, 10))),
	]
		.sort()
		.map((s) => new Date(s));

	if (uniqueDays.length === 0) return { currentStreak: 0, longestStreak: 0 };

	let longestStreak = 1;
	let currentRun = 1;

	for (let i = 1; i < uniqueDays.length; i++) {
		const diff = differenceInCalendarDays(uniqueDays[i], uniqueDays[i - 1]);
		if (diff === 1) {
			currentRun++;
		} else {
			longestStreak = Math.max(longestStreak, currentRun);
			currentRun = 1;
		}
	}
	longestStreak = Math.max(longestStreak, currentRun);

	// Check if current streak is still active (last workout was today or yesterday)
	const today = new Date();
	const lastWorkout = uniqueDays[uniqueDays.length - 1];
	const daysSinceLast = differenceInCalendarDays(today, lastWorkout);

	let currentStreak = 0;
	if (daysSinceLast <= 1) {
		currentStreak = 1;
		for (let i = uniqueDays.length - 2; i >= 0; i--) {
			const diff = differenceInCalendarDays(uniqueDays[i + 1], uniqueDays[i]);
			if (diff === 1) {
				currentStreak++;
			} else {
				break;
			}
		}
	}

	return { currentStreak, longestStreak };
}

const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function ConsistencyCalendar({
	workoutDates,
	weeks = 52,
}: ConsistencyCalendarProps) {
	const [hoveredCell, setHoveredCell] = useState<{
		date: Date;
		count: number;
		x: number;
		y: number;
	} | null>(null);

	const { grid, monthLabels, streaks } = useMemo(() => {
		const today = new Date();
		const startDate = startOfWeek(subWeeks(today, weeks - 1), {
			weekStartsOn: 0,
		});
		const endDate = today;

		const allDays = eachDayOfInterval({ start: startDate, end: endDate });

		// Count workouts per day
		const countMap = new Map<string, number>();
		for (const d of workoutDates) {
			const key = d.toISOString().slice(0, 10);
			countMap.set(key, (countMap.get(key) ?? 0) + 1);
		}

		// Build grid: array of columns (weeks), each containing 7 cells
		const columns: Array<Array<{ date: Date; count: number }>> = [];
		let currentColumn: Array<{ date: Date; count: number }> = [];

		for (const day of allDays) {
			const dayOfWeek = day.getDay(); // 0=Sun
			if (dayOfWeek === 0 && currentColumn.length > 0) {
				columns.push(currentColumn);
				currentColumn = [];
			}
			const key = day.toISOString().slice(0, 10);
			currentColumn.push({ date: day, count: countMap.get(key) ?? 0 });
		}
		if (currentColumn.length > 0) {
			columns.push(currentColumn);
		}

		// Month labels: find first week containing the 1st of each month
		const labels: Array<{ month: string; col: number }> = [];
		let lastMonth = -1;
		for (let col = 0; col < columns.length; col++) {
			for (const cell of columns[col]) {
				const month = cell.date.getMonth();
				if (month !== lastMonth && cell.date.getDate() <= 7) {
					labels.push({ month: MONTH_NAMES[month], col });
					lastMonth = month;
					break;
				}
			}
		}

		return {
			grid: columns,
			monthLabels: labels,
			streaks: computeStreaks(workoutDates),
		};
	}, [workoutDates, weeks]);

	const svgWidth = DAY_LABELS_WIDTH + grid.length * STEP + 4;
	const svgHeight = TOP_LABEL_HEIGHT + 7 * STEP + 4;

	return (
		<div className="w-full">
			{/* Calendar grid */}
			<div className="overflow-x-auto pb-2">
				<svg
					width={svgWidth}
					height={svgHeight}
					className="min-w-full"
					style={{ minWidth: svgWidth }}
				>
					{/* Month labels */}
					{monthLabels.map((ml, i) => (
						<text
							key={i}
							x={DAY_LABELS_WIDTH + ml.col * STEP}
							y={12}
							fill={PHOENIX.ashGray}
							fontSize={9}
							fontFamily="system-ui"
						>
							{ml.month}
						</text>
					))}

					{/* Day labels */}
					{["", "M", "", "W", "", "F", ""].map((label, row) => (
						<text
							key={row}
							x={16}
							y={TOP_LABEL_HEIGHT + row * STEP + CELL_SIZE - 1}
							fill={PHOENIX.ashGray}
							fontSize={8}
							textAnchor="end"
							fontFamily="system-ui"
						>
							{label}
						</text>
					))}

					{/* Grid cells */}
					{grid.map((column, col) =>
						column.map((cell) => {
							const row = cell.date.getDay();
							const x = DAY_LABELS_WIDTH + col * STEP;
							const y = TOP_LABEL_HEIGHT + row * STEP;

							return (
								<rect
									key={cell.date.toISOString()}
									x={x}
									y={y}
									width={CELL_SIZE}
									height={CELL_SIZE}
									rx={2}
									fill={getIntensity(cell.count)}
									style={{ cursor: "pointer" }}
									onMouseEnter={(e) => {
										const svgRect = (
											e.currentTarget.ownerSVGElement as SVGSVGElement
										).getBoundingClientRect();
										setHoveredCell({
											date: cell.date,
											count: cell.count,
											x: e.clientX - svgRect.left,
											y: e.clientY - svgRect.top,
										});
									}}
									onMouseLeave={() => setHoveredCell(null)}
								/>
							);
						}),
					)}
				</svg>

				{/* Tooltip */}
				{hoveredCell && (
					<div
						className="pointer-events-none absolute z-10 rounded-md px-3 py-2 text-xs"
						style={{
							left: hoveredCell.x + 16,
							top: hoveredCell.y - 30,
							background: "#1F2937",
							color: "var(--secondary-foreground)",
							border: "1px solid #374151",
							whiteSpace: "nowrap",
							position: "absolute",
						}}
					>
						<div className="font-medium">
							{format(hoveredCell.date, "MMM d, yyyy")}
						</div>
						<div
							style={{ color: hoveredCell.count > 0 ? EMBER : PHOENIX.ashGray }}
						>
							{hoveredCell.count === 0
								? "No workouts"
								: `${hoveredCell.count} workout${hoveredCell.count > 1 ? "s" : ""}`}
						</div>
					</div>
				)}
			</div>

			{/* Streak info */}
			<div className="mt-3 flex items-center gap-6 text-sm text-muted-foreground">
				<div className="flex items-center gap-2">
					<Flame className="w-4 h-4 text-primary" />
					<span>
						Current Streak:{" "}
						<span className="font-semibold text-white">
							{streaks.currentStreak} day
							{streaks.currentStreak !== 1 ? "s" : ""}
						</span>
					</span>
				</div>
				<div>
					Longest:{" "}
					<span className="font-semibold text-white">
						{streaks.longestStreak} day{streaks.longestStreak !== 1 ? "s" : ""}
					</span>
				</div>
			</div>

			{/* Legend */}
			<div className="mt-2 flex items-center gap-2 text-xs text-muted">
				<span>Less</span>
				{[BG_EMPTY, `${EMBER}66`, `${EMBER}B3`, EMBER].map((color, i) => (
					<div
						key={i}
						className="rounded-sm"
						style={{ width: 10, height: 10, backgroundColor: color }}
					/>
				))}
				<span>More</span>
			</div>
		</div>
	);
}
