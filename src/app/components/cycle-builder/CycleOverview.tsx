import { Calendar } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";

const DURATION_PRESETS = [3, 4, 5, 6, 7];

interface CycleOverviewProps {
	name: string;
	description: string;
	duration: number;
	startDate: string;
	onNameChange: (name: string) => void;
	onDescriptionChange: (description: string) => void;
	onDurationChange: (duration: number) => void;
	onStartDateChange: (date: string) => void;
}

export function CycleOverview({
	name,
	description,
	duration,
	startDate,
	onNameChange,
	onDescriptionChange,
	onDurationChange,
	onStartDateChange,
}: CycleOverviewProps) {
	const durationPresets = DURATION_PRESETS;
	const [customMode, setCustomMode] = useState(
		!durationPresets.includes(duration),
	);
	// Sync custom mode if the parent later resets duration to a preset value
	// (e.g. when loading an existing cycle), so a stale customMode doesn't keep
	// the custom input visible.
	useEffect(() => {
		if (DURATION_PRESETS.includes(duration)) {
			setCustomMode(false);
		}
	}, [duration]);
	const isCustomDuration = customMode || !durationPresets.includes(duration);

	return (
		<Card className="p-6 bg-surface-2 border-secondary">
			<h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
				<Calendar className="w-5 h-5 text-primary" />
				Cycle Details
			</h2>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Cycle Name */}
				<div className="md:col-span-2">
					<Label className="text-secondary-foreground mb-2">Cycle Name</Label>
					<Input
						value={name}
						onChange={(e) => onNameChange(e.target.value)}
						className="bg-background border-secondary focus:border-primary focus:ring-primary/20"
						placeholder="e.g., 12-Week Strength Builder"
					/>
				</div>

				{/* Description */}
				<div className="md:col-span-2">
					<Label className="text-secondary-foreground mb-2">
						Description (optional)
					</Label>
					<Textarea
						value={description}
						onChange={(e) => onDescriptionChange(e.target.value)}
						className="bg-background border-secondary focus:border-primary focus:ring-primary/20 min-h-[100px]"
						placeholder="Progressive overload program with periodization and scheduled deload weeks for optimal recovery..."
					/>
				</div>

				{/* Cycle Duration */}
				<div className="md:col-span-2">
					<Label className="text-secondary-foreground mb-2">
						Cycle Duration
					</Label>
					<div className="flex flex-wrap items-center gap-2">
						{durationPresets.map((days) => (
							<Button
								key={days}
								size="sm"
								variant={
									duration === days && !isCustomDuration ? "default" : "outline"
								}
								onClick={() => {
									setCustomMode(false);
									onDurationChange(days);
								}}
								className={
									duration === days
										? "bg-primary hover:bg-chart-2 border-0"
										: "border-secondary hover:border-primary"
								}
							>
								{days}
							</Button>
						))}
						<Button
							size="sm"
							variant={isCustomDuration ? "default" : "outline"}
							onClick={() => setCustomMode(true)}
							className={
								isCustomDuration
									? "bg-primary hover:bg-chart-2 border-0"
									: "border-secondary hover:border-primary"
							}
						>
							Custom
						</Button>
						{isCustomDuration && (
							<Input
								type="number"
								value={duration}
								onChange={(e) =>
									onDurationChange(parseInt(e.target.value, 10) || 7)
								}
								className="w-20 bg-background border-secondary"
								min="1"
								max="365"
							/>
						)}
						<span className="text-sm text-muted-foreground ml-2">
							days per cycle
						</span>
					</div>
				</div>

				{/* Start Date */}
				<div className="md:col-span-2">
					<Label className="text-secondary-foreground mb-2">
						Start Date (optional)
					</Label>
					<Input
						type="date"
						value={startDate}
						onChange={(e) => onStartDateChange(e.target.value)}
						min={new Date().toISOString().split("T")[0]}
						className="bg-background border-secondary focus:border-primary focus:ring-primary/20"
					/>
					<p className="text-xs text-muted-foreground mt-1">
						Leave blank to start whenever you're ready
					</p>
				</div>
			</div>
		</Card>
	);
}
