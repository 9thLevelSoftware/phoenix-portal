import { useQuery } from "@tanstack/react-query";
import {
	Calendar,
	ChevronLeft,
	Dumbbell,
	Eye,
	Loader2,
	Plus,
	Save,
	Settings,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { RoutinePickerModal } from "@/app/components/modals/RoutinePickerModal";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import { UnsavedChangesDialog } from "@/app/components/ui/unsaved-changes-dialog";
import { useAuth } from "@/app/hooks/useAuth";
import { useSaveCycle } from "@/mutations/cycles";
import { cycleDetailOptions } from "@/queries/cycles";
import { routineListOptions } from "@/queries/routines";

interface DayConfig {
	dayNumber: number;
	type: "workout" | "rest";
	routineId?: string;
	routineName?: string;
	exerciseCount?: number;
	duration?: number;
	weightAdjustment?: number;
	repModifier?: number;
	restOverride?: number;
	notes?: string;
	restType?: "complete" | "active" | "mobility";
}

export function CycleBuilder() {
	const { cycleId } = useParams<{ cycleId: string }>();
	const navigate = useNavigate();
	const saveMutation = useSaveCycle();
	const isEditing = !!cycleId;

	// Fetch existing cycle for editing
	const { data: existingCycle, isLoading: isLoadingCycle } = useQuery({
		...cycleDetailOptions(cycleId ?? ""),
		enabled: !!cycleId,
	});

	const [cycleName, setCycleName] = useState("Untitled Cycle");
	const [description, setDescription] = useState("");
	const [duration, setDuration] = useState(7);
	const [startDate, setStartDate] = useState<string>("");
	const [days, setDays] = useState<DayConfig[]>([
		{ dayNumber: 1, type: "workout" },
		{ dayNumber: 2, type: "workout" },
		{ dayNumber: 3, type: "rest", restType: "complete" },
		{ dayNumber: 4, type: "workout" },
		{ dayNumber: 5, type: "workout" },
		{ dayNumber: 6, type: "rest", restType: "complete" },
		{ dayNumber: 7, type: "rest", restType: "complete" },
	]);
	const [selectedDay, setSelectedDay] = useState<number | null>(null);
	const [showPreview, setShowPreview] = useState(false);
	const [showRoutinePicker, setShowRoutinePicker] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

	// Progression settings
	const [progressionType, setProgressionType] = useState<
		"percentage" | "fixed" | "manual"
	>("percentage");
	const [progressionAmount, setProgressionAmount] = useState(2.5);
	const [progressionFrequency, setProgressionFrequency] = useState(1);
	const [progressionTrigger, setProgressionTrigger] = useState<
		"all_sets" | "target_rpe" | "cycle_complete"
	>("target_rpe");
	const [upperBodyIncrement, setUpperBodyIncrement] = useState(2.5);
	const [lowerBodyIncrement, setLowerBodyIncrement] = useState(5.0);
	const [includeDeload, setIncludeDeload] = useState(true);
	const [deloadFrequency, setDeloadFrequency] = useState(4);
	const [deloadIntensity, setDeloadIntensity] = useState(60);
	const [deloadVolume, setDeloadVolume] = useState(50);

	// Fetch real routines from Supabase
	const { user } = useAuth();
	const { data: routinesRaw } = useQuery({
		...routineListOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const routines = (routinesRaw ?? []).map((r) => ({
		id: r.id,
		name: r.name,
		exercises: r.exercise_count,
		duration: r.estimated_duration,
		muscleGroup: r.tags?.[0] ?? "General",
	}));

	// Populate form from existing cycle when editing
	useEffect(() => {
		if (existingCycle) {
			setCycleName(existingCycle.name);
			setDescription(existingCycle.description ?? "");
			setDuration(existingCycle.duration_weeks);
			if (existingCycle.cycle_days.length > 0) {
				setDays(
					existingCycle.cycle_days.map((d) => ({
						dayNumber: d.day_number,
						type: d.day_type as "workout" | "rest",
						routineId: d.routine_id ?? undefined,
						weightAdjustment: d.weight_adjustment,
						repModifier: d.rep_modifier,
						restOverride: d.rest_override ?? undefined,
						notes: d.notes ?? undefined,
						restType: (d.rest_type as DayConfig["restType"]) ?? undefined,
					})),
				);
			}
			if (existingCycle.progression_settings) {
				const ps = existingCycle.progression_settings as any;
				if (ps.type) setProgressionType(ps.type);
				if (ps.amount) setProgressionAmount(ps.amount);
				if (ps.frequency) setProgressionFrequency(ps.frequency);
				if (ps.trigger) setProgressionTrigger(ps.trigger);
				if (ps.upperIncrement) setUpperBodyIncrement(ps.upperIncrement);
				if (ps.lowerIncrement) setLowerBodyIncrement(ps.lowerIncrement);
			}
			if (existingCycle.deload_settings) {
				const ds = existingCycle.deload_settings as any;
				setIncludeDeload(true);
				if (ds.frequency) setDeloadFrequency(ds.frequency);
				if (ds.intensity) setDeloadIntensity(ds.intensity);
				if (ds.volume) setDeloadVolume(ds.volume);
			}
		}
	}, [existingCycle]);

	const handleCancel = () => {
		if (hasUnsavedChanges) {
			setShowUnsavedDialog(true);
		} else {
			navigate("/cycles");
		}
	};

	const handleSave = () => {
		const progressionSettings = {
			type: progressionType,
			amount: progressionAmount,
			frequency: progressionFrequency,
			trigger: progressionTrigger,
			upperIncrement: upperBodyIncrement,
			lowerIncrement: lowerBodyIncrement,
		};

		const deloadSettings = includeDeload
			? {
					frequency: deloadFrequency,
					intensity: deloadIntensity,
					volume: deloadVolume,
				}
			: null;

		saveMutation.mutate(
			{
				name: cycleName,
				description,
				duration_weeks: duration,
				started_at: startDate || null,
				days: days.map((d) => ({
					day_number: d.dayNumber,
					day_type: d.type,
					routine_id: d.routineId ?? null,
					weight_adjustment: d.weightAdjustment ?? 0,
					rep_modifier: d.repModifier ?? 0,
					rest_override: d.restOverride ?? null,
					notes: d.notes ?? null,
					rest_type: d.restType ?? null,
				})),
				progression_settings: progressionSettings,
				deload_settings: deloadSettings,
			},
			{
				onSuccess: () => {
					setHasUnsavedChanges(false);
				},
			},
		);
	};

	const handleDayClick = (dayNumber: number) => {
		setSelectedDay(dayNumber);
	};

	const handleAssignRoutine = (dayNumber: number, routineId: string) => {
		const routine = routines.find((r) => r.id === routineId);
		if (routine) {
			setDays(
				days.map((day) =>
					day.dayNumber === dayNumber
						? {
								...day,
								type: "workout",
								routineId: routine.id,
								routineName: routine.name,
								exerciseCount: routine.exercises,
								duration: routine.duration,
							}
						: day,
				),
			);
			setHasUnsavedChanges(true);
			setShowRoutinePicker(false);
		}
	};

	const handleSetRestDay = (dayNumber: number) => {
		setDays(
			days.map((day) =>
				day.dayNumber === dayNumber
					? {
							...day,
							type: "rest",
							restType: "complete",
							routineId: undefined,
							routineName: undefined,
						}
					: day,
			),
		);
		setHasUnsavedChanges(true);
	};

	const handleAddDay = () => {
		const newDay: DayConfig = {
			dayNumber: days.length + 1,
			type: "workout",
		};
		setDays([...days, newDay]);
		setDuration(days.length + 1);
		setHasUnsavedChanges(true);
	};

	const handleRemoveDay = (dayNumber: number) => {
		if (days.length <= 1) return;
		setDays(
			days
				.filter((d) => d.dayNumber !== dayNumber)
				.map((d, i) => ({ ...d, dayNumber: i + 1 })),
		);
		setDuration(days.length - 1);
		setHasUnsavedChanges(true);
	};

	const selectedDayData = days.find((d) => d.dayNumber === selectedDay);

	const workoutDays = days.filter((d) => d.type === "workout").length;
	const restDays = days.filter((d) => d.type === "rest").length;

	if (isEditing && isLoadingCycle) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="w-8 h-8 text-primary animate-spin" />
					<p className="text-muted-foreground">Loading cycle...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-8">
			{/* Sticky Top Bar */}
			<div className="sticky top-0 z-40 bg-background/95 backdrop-blur-lg border-b border-secondary px-4 py-4">
				<div className="max-w-7xl mx-auto flex items-center justify-between">
					<div className="flex items-center gap-4 flex-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={handleCancel}
							className="text-muted-foreground hover:text-white"
						>
							<ChevronLeft className="w-5 h-5 mr-1" />
							Cancel
						</Button>

						<Input
							value={cycleName}
							onChange={(e) => {
								setCycleName(e.target.value);
								setHasUnsavedChanges(true);
							}}
							className="text-xl font-semibold bg-transparent border-none focus:ring-0 max-w-md"
							placeholder="Cycle Name"
						/>

						{hasUnsavedChanges && (
							<Badge
								variant="outline"
								className="bg-accent/20 text-accent border-accent/30"
							>
								Unsaved
							</Badge>
						)}
					</div>

					<div className="flex items-center gap-3">
						<Button
							variant="outline"
							onClick={() => setShowPreview(true)}
							className="border-secondary hover:border-primary"
						>
							<Eye className="w-4 h-4 mr-2" />
							Preview
						</Button>
						<Button
							onClick={handleSave}
							disabled={saveMutation.isPending}
							className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
						>
							{saveMutation.isPending ? (
								<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							) : (
								<Save className="w-4 h-4 mr-2" />
							)}
							{saveMutation.isPending ? "Saving..." : "Save Cycle"}
						</Button>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
				{/* Section 1: Cycle Overview */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
							<Calendar className="w-5 h-5 text-primary" />
							Cycle Details
						</h2>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div>
								<Label className="text-secondary-foreground mb-2">
									Duration (Days)
								</Label>
								<div className="flex items-center gap-2">
									<Input
										type="number"
										value={duration}
										onChange={(e) => {
											setDuration(parseInt(e.target.value, 10) || 7);
											setHasUnsavedChanges(true);
										}}
										className="bg-background border-secondary w-24"
										min="1"
									/>
									<div className="flex gap-2">
										{[3, 4, 5, 6, 7].map((num) => (
											<Button
												key={num}
												size="sm"
												variant={duration === num ? "default" : "outline"}
												onClick={() => {
													setDuration(num);
													setHasUnsavedChanges(true);
												}}
												className={
													duration === num
														? "bg-primary border-0"
														: "border-secondary"
												}
											>
												{num}
											</Button>
										))}
									</div>
								</div>
							</div>

							<div className="md:col-span-2">
								<Label className="text-secondary-foreground mb-2">
									Description
								</Label>
								<Textarea
									value={description}
									onChange={(e) => {
										setDescription(e.target.value);
										setHasUnsavedChanges(true);
									}}
									className="bg-background border-secondary min-h-[80px]"
									placeholder="Describe your training cycle goals and approach..."
								/>
							</div>

							<div>
								<Label className="text-secondary-foreground mb-2">
									Start Date (Optional)
								</Label>
								<Input
									type="date"
									value={startDate}
									onChange={(e) => {
										setStartDate(e.target.value);
										setHasUnsavedChanges(true);
									}}
									className="bg-background border-secondary"
									{...(!isEditing && { min: new Date().toISOString().split("T")[0] })}
								/>
								<p className="text-xs text-muted mt-1">
									Leave blank to start anytime
								</p>
							</div>
						</div>
					</Card>
				</motion.div>

				{/* Section 2: Day Schedule */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-xl font-semibold text-white flex items-center gap-2">
								<Dumbbell className="w-5 h-5 text-primary" />
								Workout Schedule
							</h2>
							<Button
								size="sm"
								onClick={handleAddDay}
								className="bg-primary hover:bg-chart-2 border-0"
							>
								<Plus className="w-4 h-4 mr-2" />
								Add Day
							</Button>
						</div>

						{/* Horizontal Scrollable Day Cards */}
						<div className="overflow-x-auto pb-4 -mx-2 px-2">
							<div className="flex gap-4 min-w-max">
								{days.map((day) => (
									<DayCard
										key={day.dayNumber}
										day={day}
										onClick={() => handleDayClick(day.dayNumber)}
										onRemove={() => handleRemoveDay(day.dayNumber)}
										isSelected={selectedDay === day.dayNumber}
									/>
								))}
							</div>
						</div>

						<p className="text-sm text-muted mt-4 text-center">
							Click a day to configure -- Scroll horizontally for more days
						</p>
					</Card>
				</motion.div>

				{/* Day Editor Side Panel (Inline) */}
				<AnimatePresence>
					{selectedDay && selectedDayData && (
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -20 }}
						>
							<DayEditorPanel
								day={selectedDayData}
								onClose={() => setSelectedDay(null)}
								onAssignRoutine={() => setShowRoutinePicker(true)}
								onSetRestDay={() => handleSetRestDay(selectedDay)}
								onUpdate={(updates) => {
									setDays(
										days.map((d) =>
											d.dayNumber === selectedDay ? { ...d, ...updates } : d,
										),
									);
									setHasUnsavedChanges(true);
								}}
							/>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Section 3: Progression Rules */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2 }}
				>
					<ProgressionRules
						progressionType={progressionType}
						onProgressionTypeChange={(v: "percentage" | "fixed" | "manual") => {
							setProgressionType(v);
							setHasUnsavedChanges(true);
						}}
						progressionAmount={progressionAmount}
						onProgressionAmountChange={(v: number) => {
							setProgressionAmount(v);
							setHasUnsavedChanges(true);
						}}
						progressionFrequency={progressionFrequency}
						onProgressionFrequencyChange={(v: number) => {
							setProgressionFrequency(v);
							setHasUnsavedChanges(true);
						}}
						progressionTrigger={progressionTrigger}
						onProgressionTriggerChange={(
							v: "all_sets" | "target_rpe" | "cycle_complete",
						) => {
							setProgressionTrigger(v);
							setHasUnsavedChanges(true);
						}}
						upperBodyIncrement={upperBodyIncrement}
						onUpperBodyIncrementChange={(v: number) => {
							setUpperBodyIncrement(v);
							setHasUnsavedChanges(true);
						}}
						lowerBodyIncrement={lowerBodyIncrement}
						onLowerBodyIncrementChange={(v: number) => {
							setLowerBodyIncrement(v);
							setHasUnsavedChanges(true);
						}}
						includeDeload={includeDeload}
						onIncludeDeloadChange={(v: boolean) => {
							setIncludeDeload(v);
							setHasUnsavedChanges(true);
						}}
						deloadFrequency={deloadFrequency}
						onDeloadFrequencyChange={(v: number) => {
							setDeloadFrequency(v);
							setHasUnsavedChanges(true);
						}}
						deloadIntensity={deloadIntensity}
						onDeloadIntensityChange={(v: number) => {
							setDeloadIntensity(v);
							setHasUnsavedChanges(true);
						}}
						deloadVolume={deloadVolume}
						onDeloadVolumeChange={(v: number) => {
							setDeloadVolume(v);
							setHasUnsavedChanges(true);
						}}
					/>
				</motion.div>

				{/* Section 4: Week Overview */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.3 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<h2 className="text-xl font-semibold text-white mb-6">
							Week at a Glance
						</h2>

						<div className={`grid gap-2 mb-6 ${days.length <= 7 ? "grid-cols-7" : "grid-cols-7 overflow-x-auto"}`} style={days.length > 7 ? { gridTemplateColumns: `repeat(${days.length}, minmax(80px, 1fr))` } : undefined}>
							{days.map((day, i) => {
								const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
								const label = days.length <= 7 ? weekdayLabels[i] : `Day ${day.dayNumber}`;
								return (
									<div key={day.dayNumber} className="text-center">
										<div className="text-xs text-muted-foreground mb-2">
											{label}
										</div>
										<div
											className={`h-16 rounded-lg flex items-center justify-center text-2xl ${
												day.type === "workout"
													? "bg-primary/20 border border-primary/30"
													: "bg-secondary/20 border border-secondary"
											}`}
										>
											{day.type === "workout" ? (
												<Dumbbell className="w-6 h-6 text-primary" />
											) : (
												<span className="text-muted-foreground text-sm">
													REST
												</span>
											)}
										</div>
										<div className="text-xs text-muted mt-1 truncate">
											{day.routineName ||
												(day.type === "rest" ? "REST" : "-")}
										</div>
									</div>
								);
							})}
						</div>

						<div className="text-sm text-secondary-foreground mb-4">
							{workoutDays} workout days / {restDays} rest days
						</div>
					</Card>
				</motion.div>
			</div>

			{/* Routine Picker Modal */}
			<RoutinePickerModal
				isOpen={showRoutinePicker}
				onClose={() => setShowRoutinePicker(false)}
				routines={routines}
				onSelect={(routineId) =>
					selectedDay && handleAssignRoutine(selectedDay, routineId)
				}
			/>

			{/* Preview Modal */}
			<PreviewModal
				isOpen={showPreview}
				onClose={() => setShowPreview(false)}
				cycle={{
					name: cycleName,
					description,
					duration,
					days,
					progression: {
						type: progressionType,
						amount: progressionAmount,
						frequency: progressionFrequency,
						trigger: progressionTrigger,
					},
					deload: includeDeload
						? {
								frequency: deloadFrequency,
								intensity: deloadIntensity,
								volume: deloadVolume,
							}
						: null,
				}}
			/>

			{/* Unsaved Changes Dialog */}
			<UnsavedChangesDialog
				open={showUnsavedDialog}
				onSave={() => {
					setShowUnsavedDialog(false);
					handleSave();
				}}
				onDiscard={() => {
					setShowUnsavedDialog(false);
					navigate("/cycles");
				}}
				onCancel={() => setShowUnsavedDialog(false)}
			/>
		</div>
	);
}

// Day Card Component
function DayCard({
	day,
	onClick,
	onRemove,
	isSelected,
}: {
	day: DayConfig;
	onClick: () => void;
	onRemove: () => void;
	isSelected: boolean;
}) {
	return (
		<motion.div
			whileHover={{ scale: 1.02 }}
			whileTap={{ scale: 0.98 }}
			className={`relative min-w-[180px] cursor-pointer transition-all ${
				isSelected ? "ring-2 ring-primary" : ""
			}`}
		>
			<Card
				onClick={onClick}
				className={`p-4 ${
					day.type === "workout"
						? "bg-gradient-to-br from-primary/10 to-chart-2/5 border-l-4 border-l-[#FF6B35]"
						: "bg-gradient-to-br from-secondary/20 to-background border-secondary"
				}`}
			>
				<div className="text-center mb-3">
					<div className="text-sm font-semibold text-muted-foreground">
						Day {day.dayNumber}
					</div>
				</div>

				{day.type === "workout" && day.routineName ? (
					<div className="text-center space-y-2">
						<Dumbbell className="w-6 h-6 text-primary mx-auto" />
						<div className="font-semibold text-white text-sm">
							{day.routineName}
						</div>
						<div className="text-xs text-muted-foreground">
							{day.exerciseCount} ex. • ~{day.duration} min
						</div>
					</div>
				) : day.type === "workout" ? (
					<div className="text-center space-y-2">
						<div className="text-4xl text-muted">+</div>
						<div className="text-xs text-muted-foreground">Add Routine</div>
					</div>
				) : (
					<div className="text-center space-y-2">
						<span className="text-muted-foreground text-sm block mt-2">
							REST
						</span>
						<div className="text-sm font-semibold text-muted-foreground">
							{day.restType === "active"
								? "Active Recovery"
								: day.restType === "mobility"
									? "Mobility"
									: "Complete Rest"}
						</div>
					</div>
				)}

				<button
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					className="absolute top-2 right-2 p-1 bg-destructive/20 hover:bg-destructive/40 rounded transition-colors"
				>
					<X className="w-3 h-3 text-destructive" />
				</button>
			</Card>
		</motion.div>
	);
}

// Day Editor Panel Component
function DayEditorPanel({
	day,
	onClose,
	onAssignRoutine,
	onSetRestDay,
	onUpdate,
}: {
	day: DayConfig;
	onClose: () => void;
	onAssignRoutine: () => void;
	onSetRestDay: () => void;
	onUpdate: (updates: Partial<DayConfig>) => void;
}) {
	return (
		<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<div className="flex items-center justify-between mb-6">
				<h3 className="text-lg font-semibold text-white">
					Day {day.dayNumber} Configuration
				</h3>
				<Button variant="ghost" size="sm" onClick={onClose}>
					<X className="w-5 h-5" />
				</Button>
			</div>

			{day.type === "workout" ? (
				<div className="space-y-6">
					{day.routineName ? (
						<div>
							<Label className="text-secondary-foreground mb-2">
								Assigned Routine
							</Label>
							<div className="flex items-center gap-2">
								<div className="flex-1 p-3 bg-background border border-secondary rounded-lg">
									<div className="font-semibold text-white">
										{day.routineName}
									</div>
									<div className="text-sm text-muted-foreground">
										{day.exerciseCount} exercises • ~{day.duration} min
									</div>
								</div>
								<Button
									size="sm"
									onClick={onAssignRoutine}
									variant="outline"
									className="border-secondary"
								>
									Change
								</Button>
							</div>
						</div>
					) : (
						<div>
							<Label className="text-secondary-foreground mb-2">Routine</Label>
							<Button
								onClick={onAssignRoutine}
								variant="outline"
								className="w-full border-secondary"
							>
								<Plus className="w-4 h-4 mr-2" />
								Assign Routine
							</Button>
						</div>
					)}

					<div>
						<Label className="text-secondary-foreground mb-2">
							Day-Specific Overrides
						</Label>
						<p className="text-xs text-muted mb-4">
							Optional - override routine defaults for this day only
						</p>

						<div className="space-y-4">
							<div>
								<Label className="text-sm text-muted-foreground mb-2">
									Weight Adjustment (%)
								</Label>
								<div className="flex items-center gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() =>
											onUpdate({
												weightAdjustment: (day.weightAdjustment || 0) - 5,
											})
										}
										className="border-secondary"
									>
										-
									</Button>
									<Input
										type="number"
										value={day.weightAdjustment || 0}
										onChange={(e) =>
											onUpdate({
												weightAdjustment: parseInt(e.target.value, 10) || 0,
											})
										}
										className="text-center bg-background border-secondary"
									/>
									<Button
										size="sm"
										variant="outline"
										onClick={() =>
											onUpdate({
												weightAdjustment: (day.weightAdjustment || 0) + 5,
											})
										}
										className="border-secondary"
									>
										+
									</Button>
								</div>
							</div>

							<div>
								<Label className="text-sm text-muted-foreground mb-2">
									Rep Modifier
								</Label>
								<div className="flex items-center gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() =>
											onUpdate({ repModifier: (day.repModifier || 0) - 1 })
										}
										className="border-secondary"
									>
										-
									</Button>
									<Input
										type="number"
										value={day.repModifier || 0}
										onChange={(e) =>
											onUpdate({
												repModifier: parseInt(e.target.value, 10) || 0,
											})
										}
										className="text-center bg-background border-secondary"
									/>
									<Button
										size="sm"
										variant="outline"
										onClick={() =>
											onUpdate({ repModifier: (day.repModifier || 0) + 1 })
										}
										className="border-secondary"
									>
										+
									</Button>
								</div>
							</div>
						</div>
					</div>

					<div>
						<Label className="text-secondary-foreground mb-2">Notes</Label>
						<Textarea
							value={day.notes || ""}
							onChange={(e) => onUpdate({ notes: e.target.value })}
							className="bg-background border-secondary"
							placeholder="e.g., Focus on form, Deload week, etc."
						/>
					</div>

					<Button
						onClick={onSetRestDay}
						variant="outline"
						className="w-full border-secondary text-muted-foreground"
					>
						Convert to Rest Day
					</Button>
				</div>
			) : (
				<div className="space-y-6">
					<div className="text-center py-4">
						<span className="text-muted-foreground text-lg block">
							Rest Day
						</span>
					</div>

					<div>
						<Label className="text-secondary-foreground mb-2">Rest Type</Label>
						<Select
							value={day.restType || "complete"}
							onValueChange={(value: any) => onUpdate({ restType: value })}
						>
							<SelectTrigger className="bg-background border-secondary">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="complete">Complete Rest</SelectItem>
								<SelectItem value="active">Active Recovery</SelectItem>
								<SelectItem value="mobility">Mobility/Stretching</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div>
						<Label className="text-secondary-foreground mb-2">Notes</Label>
						<Textarea
							value={day.notes || ""}
							onChange={(e) => onUpdate({ notes: e.target.value })}
							className="bg-background border-secondary"
							placeholder="e.g., Light walk, foam rolling, yoga..."
						/>
					</div>

					<Button
						onClick={onAssignRoutine}
						variant="outline"
						className="w-full border-primary text-primary hover:bg-primary/10"
					>
						Convert to Workout Day
					</Button>
				</div>
			)}
		</Card>
	);
}

// Progression Rules Component
function ProgressionRules({
	progressionType,
	onProgressionTypeChange,
	progressionAmount,
	onProgressionAmountChange,
	progressionFrequency,
	onProgressionFrequencyChange,
	progressionTrigger,
	onProgressionTriggerChange,
	upperBodyIncrement,
	onUpperBodyIncrementChange,
	lowerBodyIncrement,
	onLowerBodyIncrementChange,
	includeDeload,
	onIncludeDeloadChange,
	deloadFrequency,
	onDeloadFrequencyChange,
	deloadIntensity,
	onDeloadIntensityChange,
	deloadVolume,
	onDeloadVolumeChange,
}: {
	progressionType: "percentage" | "fixed" | "manual";
	onProgressionTypeChange: (v: "percentage" | "fixed" | "manual") => void;
	progressionAmount: number;
	onProgressionAmountChange: (v: number) => void;
	progressionFrequency: number;
	onProgressionFrequencyChange: (v: number) => void;
	progressionTrigger: "all_sets" | "target_rpe" | "cycle_complete";
	onProgressionTriggerChange: (
		v: "all_sets" | "target_rpe" | "cycle_complete",
	) => void;
	upperBodyIncrement: number;
	onUpperBodyIncrementChange: (v: number) => void;
	lowerBodyIncrement: number;
	onLowerBodyIncrementChange: (v: number) => void;
	includeDeload: boolean;
	onIncludeDeloadChange: (v: boolean) => void;
	deloadFrequency: number;
	onDeloadFrequencyChange: (v: number) => void;
	deloadIntensity: number;
	onDeloadIntensityChange: (v: number) => void;
	deloadVolume: number;
	onDeloadVolumeChange: (v: number) => void;
}) {
	return (
		<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
				<Settings className="w-5 h-5 text-primary" />
				Progression Rules
			</h2>

			<div className="space-y-6">
				{/* Progression Type */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<Label className="text-secondary-foreground mb-2">
							Progression Type
						</Label>
						<Select
							value={progressionType}
							onValueChange={(v) =>
								onProgressionTypeChange(v as "percentage" | "fixed" | "manual")
							}
						>
							<SelectTrigger className="bg-background border-secondary">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="percentage">Percentage Increase</SelectItem>
								<SelectItem value="fixed">Fixed Weight Increase</SelectItem>
								<SelectItem value="manual">Manual Adjustment</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted mt-1">
							{progressionType === "percentage"
								? "Increase weight by a percentage each cycle"
								: progressionType === "fixed"
									? "Add a fixed amount of weight each cycle"
									: "Adjust weight manually between cycles"}
						</p>
					</div>

					{progressionType !== "manual" && (
						<div>
							<Label className="text-secondary-foreground mb-2">
								{progressionType === "percentage"
									? "Increase (%)"
									: "Increase (kg)"}
							</Label>
							<Input
								type="number"
								value={progressionAmount}
								onChange={(e) =>
									onProgressionAmountChange(parseFloat(e.target.value) || 0)
								}
								className="bg-background border-secondary"
								step={progressionType === "percentage" ? 0.5 : 0.25}
								min={0}
							/>
						</div>
					)}
				</div>

				{/* Frequency and Trigger */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<Label className="text-secondary-foreground mb-2">
							Progression Frequency (weeks)
						</Label>
						<Input
							type="number"
							value={progressionFrequency}
							onChange={(e) =>
								onProgressionFrequencyChange(parseInt(e.target.value, 10) || 1)
							}
							className="bg-background border-secondary"
							min={1}
						/>
						<p className="text-xs text-muted mt-1">
							How often to apply progression
						</p>
					</div>

					<div>
						<Label className="text-secondary-foreground mb-2">
							Progression Trigger
						</Label>
						<Select
							value={progressionTrigger}
							onValueChange={(v) =>
								onProgressionTriggerChange(
									v as "all_sets" | "target_rpe" | "cycle_complete",
								)
							}
						>
							<SelectTrigger className="bg-background border-secondary">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all_sets">All Sets Completed</SelectItem>
								<SelectItem value="target_rpe">Target RPE Met</SelectItem>
								<SelectItem value="cycle_complete">Cycle Complete</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted mt-1">When to advance weight</p>
					</div>
				</div>

				{/* Body-specific Increments */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<Label className="text-secondary-foreground mb-2">
							Upper Body Increment (kg)
						</Label>
						<Input
							type="number"
							value={upperBodyIncrement}
							onChange={(e) =>
								onUpperBodyIncrementChange(parseFloat(e.target.value) || 0)
							}
							className="bg-background border-secondary"
							step={0.25}
							min={0}
						/>
					</div>
					<div>
						<Label className="text-secondary-foreground mb-2">
							Lower Body Increment (kg)
						</Label>
						<Input
							type="number"
							value={lowerBodyIncrement}
							onChange={(e) =>
								onLowerBodyIncrementChange(parseFloat(e.target.value) || 0)
							}
							className="bg-background border-secondary"
							step={0.5}
							min={0}
						/>
					</div>
				</div>

				{/* Deload Section */}
				<div className="border-t border-secondary pt-6">
					<div className="flex items-center justify-between mb-4">
						<div>
							<Label className="text-white text-base">Deload Week</Label>
							<p className="text-xs text-muted-foreground">
								Periodically reduce intensity for recovery
							</p>
						</div>
						<Switch
							checked={includeDeload}
							onCheckedChange={onIncludeDeloadChange}
						/>
					</div>

					{includeDeload && (
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<div>
								<Label className="text-secondary-foreground mb-2">
									Every N weeks
								</Label>
								<Input
									type="number"
									value={deloadFrequency}
									onChange={(e) =>
										onDeloadFrequencyChange(parseInt(e.target.value, 10) || 1)
									}
									className="bg-background border-secondary"
									min={1}
								/>
							</div>
							<div>
								<Label className="text-secondary-foreground mb-2">
									Intensity (% of normal)
								</Label>
								<Input
									type="number"
									value={deloadIntensity}
									onChange={(e) =>
										onDeloadIntensityChange(parseInt(e.target.value, 10) || 0)
									}
									className="bg-background border-secondary"
									min={0}
									max={100}
								/>
							</div>
							<div>
								<Label className="text-secondary-foreground mb-2">
									Volume (% of normal)
								</Label>
								<Input
									type="number"
									value={deloadVolume}
									onChange={(e) =>
										onDeloadVolumeChange(parseInt(e.target.value, 10) || 0)
									}
									className="bg-background border-secondary"
									min={0}
									max={100}
								/>
							</div>
						</div>
					)}
				</div>
			</div>
		</Card>
	);
}

// Preview Modal
function PreviewModal({
	isOpen,
	onClose,
	cycle,
}: {
	isOpen: boolean;
	onClose: () => void;
	cycle: {
		name: string;
		description: string;
		duration: number;
		days: DayConfig[];
		progression: {
			type: string;
			amount: number;
			frequency: number;
			trigger: string;
		};
		deload: { frequency: number; intensity: number; volume: number } | null;
	};
}) {
	const workoutDays = cycle.days.filter((d) => d.type === "workout").length;
	const restDays = cycle.days.filter((d) => d.type === "rest").length;

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="bg-surface-2 border-secondary max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="text-white text-xl">
						{cycle.name || "Untitled Cycle"}
					</DialogTitle>
					<DialogDescription>
						{cycle.description || "No description provided"}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					{/* Summary Stats */}
					<div className="grid grid-cols-3 gap-4">
						<div className="p-3 bg-background rounded-lg border border-secondary text-center">
							<div className="text-sm text-muted-foreground">Duration</div>
							<div className="text-2xl font-bold text-white">
								{cycle.duration}
							</div>
							<div className="text-xs text-muted">days</div>
						</div>
						<div className="p-3 bg-background rounded-lg border border-secondary text-center">
							<div className="text-sm text-muted-foreground">Workout</div>
							<div className="text-2xl font-bold text-primary">
								{workoutDays}
							</div>
							<div className="text-xs text-muted">days</div>
						</div>
						<div className="p-3 bg-background rounded-lg border border-secondary text-center">
							<div className="text-sm text-muted-foreground">Rest</div>
							<div className="text-2xl font-bold text-muted-foreground">
								{restDays}
							</div>
							<div className="text-xs text-muted">days</div>
						</div>
					</div>

					{/* Day Grid */}
					<div>
						<h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
							Schedule
						</h4>
						<div className="grid grid-cols-7 gap-2">
							{cycle.days.map((day) => (
								<div
									key={day.dayNumber}
									className={`p-2 rounded-lg text-center text-xs ${
										day.type === "workout"
											? "bg-primary/20 border border-primary/30"
											: "bg-secondary/20 border border-secondary"
									}`}
								>
									<div className="font-semibold text-muted-foreground">
										D{day.dayNumber}
									</div>
									{day.type === "workout" ? (
										<>
											<Dumbbell className="w-3 h-3 text-primary mx-auto my-1" />
											<div className="text-white truncate text-[10px]">
												{day.routineName || "TBD"}
											</div>
										</>
									) : (
										<div className="text-muted-foreground mt-1">REST</div>
									)}
								</div>
							))}
						</div>
					</div>

					{/* Progression Preview */}
					<div>
						<h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
							Progression
						</h4>
						<div className="p-3 bg-background rounded-lg border border-secondary space-y-1">
							<div className="text-sm text-white">
								Type:{" "}
								<span className="text-primary capitalize">
									{cycle.progression.type}
								</span>
							</div>
							{cycle.progression.type !== "manual" && (
								<div className="text-sm text-white">
									Amount:{" "}
									<span className="text-primary">
										{cycle.progression.amount}
										{cycle.progression.type === "percentage" ? "%" : "kg"}
									</span>
								</div>
							)}
							<div className="text-sm text-white">
								Every:{" "}
								<span className="text-primary">
									{cycle.progression.frequency} week(s)
								</span>
							</div>
							<div className="text-sm text-white">
								Trigger:{" "}
								<span className="text-primary">
									{cycle.progression.trigger.replace(/_/g, " ")}
								</span>
							</div>
						</div>
					</div>

					{/* Deload Preview */}
					{cycle.deload && (
						<div>
							<h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
								Deload Schedule
							</h4>
							<div className="p-3 bg-background rounded-lg border border-secondary space-y-1">
								<div className="text-sm text-white">
									Every{" "}
									<span className="text-primary">
										{cycle.deload.frequency} weeks
									</span>
								</div>
								<div className="text-sm text-white">
									Intensity:{" "}
									<span className="text-primary">
										{cycle.deload.intensity}% of normal
									</span>
								</div>
								<div className="text-sm text-white">
									Volume:{" "}
									<span className="text-primary">
										{cycle.deload.volume}% of normal
									</span>
								</div>
							</div>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
