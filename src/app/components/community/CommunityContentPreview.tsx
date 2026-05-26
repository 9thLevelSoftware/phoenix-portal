import { Calendar, Clock, Dumbbell, Repeat } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { formatWeight } from "@/lib/units";
import type {
	CycleSnapshot,
	EmbeddedRoutineSnapshot,
	RoutineExerciseSnapshot,
} from "@/schemas/community";
import { WEIGHT_MULTIPLIER } from "@/schemas/transforms";

function orderedExercises(exercises: RoutineExerciseSnapshot[]) {
	return [...exercises].sort((a, b) => a.order_index - b.order_index);
}

function asPrimitiveArray(value: unknown): Array<string | number | boolean> {
	return Array.isArray(value)
		? value.filter((item): item is string | number | boolean =>
				["string", "number", "boolean"].includes(typeof item),
			)
		: [];
}

function formatStoredDurationMinutes(duration: number | null | undefined) {
	if (!duration) return "0 min";
	return duration > 300
		? `${Math.round(duration / 60)} min`
		: `${Math.round(duration)} min`;
}

function formatLoad(exercise: RoutineExerciseSnapshot) {
	if (exercise.is_bodyweight) return "Bodyweight";
	return formatWeight((exercise.weight ?? 0) * WEIGHT_MULTIPLIER, "kg");
}

function formatPrescription(exercise: RoutineExerciseSnapshot) {
	const load = formatLoad(exercise);
	if (exercise.duration_seconds) {
		return `${exercise.sets} sets / ${exercise.duration_seconds}s / ${load}`;
	}
	if (exercise.is_amrap) {
		return `${exercise.sets} sets / AMRAP / ${load}`;
	}
	return `${exercise.sets} sets / ${exercise.reps} reps / ${load}`;
}

function exerciseBadges(exercise: RoutineExerciseSnapshot) {
	return [
		exercise.mode,
		exercise.is_amrap ? "AMRAP" : null,
		exercise.is_bodyweight ? "Bodyweight" : null,
		exercise.eccentric_load ? `Eccentric ${exercise.eccentric_load}` : null,
		exercise.echo_level ? `Echo ${exercise.echo_level}` : null,
		exercise.rep_count_timing ? `Timing ${exercise.rep_count_timing}` : null,
		exercise.stop_at_position ? `Stop ${exercise.stop_at_position}` : null,
		exercise.stall_detection === false ? "Stall off" : null,
	].filter(Boolean) as string[];
}

function perSetRows(exercise: RoutineExerciseSnapshot) {
	const weights = asPrimitiveArray(exercise.per_set_weights).map((value) =>
		typeof value === "number"
			? formatWeight(value * WEIGHT_MULTIPLIER, "kg")
			: String(value),
	);
	const reps = asPrimitiveArray(exercise.per_set_reps).map(String);
	const rest = asPrimitiveArray(exercise.per_set_rest).map((value) =>
		typeof value === "number" ? `${value}s` : String(value),
	);
	const echoLevels = asPrimitiveArray(exercise.per_set_echo_levels).map(String);

	return [
		weights.length ? `Weights: ${weights.join(", ")}` : null,
		reps.length ? `Reps: ${reps.join(", ")}` : null,
		rest.length ? `Rest: ${rest.join(", ")}` : null,
		echoLevels.length ? `Echo: ${echoLevels.join(", ")}` : null,
	].filter(Boolean) as string[];
}

function RoutineExerciseCard({
	exercise,
	index,
}: {
	exercise: RoutineExerciseSnapshot;
	index: number;
}) {
	const perSet = perSetRows(exercise);

	return (
		<div className="rounded-lg border border-secondary bg-surface-2 p-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="mb-1 flex flex-wrap items-center gap-2">
						<span className="text-xs text-muted-foreground">
							{String(index + 1).padStart(2, "0")}
						</span>
						<h5 className="text-sm font-semibold text-white">
							{exercise.name}
						</h5>
						<Badge className="border-0 bg-secondary text-secondary-foreground">
							{exercise.muscle_group}
						</Badge>
					</div>
					<p className="text-sm text-secondary-foreground">
						{formatPrescription(exercise)}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Rest: {exercise.rest_seconds}s between sets
					</p>
					{perSet.length > 0 && (
						<div className="mt-2 space-y-1 text-xs text-muted-foreground">
							{perSet.map((row) => (
								<p key={row}>{row}</p>
							))}
						</div>
					)}
				</div>
				<div className="flex flex-wrap gap-1.5 sm:max-w-[240px] sm:justify-end">
					{exerciseBadges(exercise).map((badge) => (
						<Badge
							key={badge}
							variant="outline"
							className="border-secondary text-muted-foreground"
						>
							{badge}
						</Badge>
					))}
				</div>
			</div>
		</div>
	);
}

export function RoutineSnapshotPreview({
	exercises,
	title = "Routine Details",
}: {
	exercises: RoutineExerciseSnapshot[] | null | undefined;
	title?: string;
}) {
	if (!exercises || exercises.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-secondary p-4 text-sm text-muted-foreground">
				Full routine details are unavailable for this older share.
			</div>
		);
	}

	const grouped = orderedExercises(exercises).reduce<
		Array<
			| { type: "exercise"; exercise: RoutineExerciseSnapshot }
			| {
					type: "superset";
					id: string;
					color: string | null | undefined;
					exercises: RoutineExerciseSnapshot[];
			  }
		>
	>((items, exercise) => {
		if (!exercise.superset_id) {
			items.push({ type: "exercise", exercise });
			return items;
		}
		if (
			items.some(
				(item) => item.type === "superset" && item.id === exercise.superset_id,
			)
		) {
			return items;
		}
		items.push({
			type: "superset",
			id: exercise.superset_id,
			color: exercise.superset_color,
			exercises: exercises
				.filter((entry) => entry.superset_id === exercise.superset_id)
				.sort((a, b) => (a.superset_order ?? 0) - (b.superset_order ?? 0)),
		});
		return items;
	}, []);

	return (
		<section className="space-y-3">
			<div className="flex items-center gap-2">
				<Dumbbell className="h-4 w-4 text-primary" />
				<h4 className="text-sm font-semibold text-white">{title}</h4>
			</div>
			<div className="space-y-3">
				{grouped.map((item, itemIndex) =>
					item.type === "exercise" ? (
						<RoutineExerciseCard
							key={`${item.exercise.name}-${item.exercise.order_index}`}
							exercise={item.exercise}
							index={itemIndex}
						/>
					) : (
						<div
							key={item.id}
							className="rounded-lg border border-secondary bg-background/30 p-3"
							style={{
								borderLeftColor: item.color ?? undefined,
								borderLeftWidth: 4,
							}}
						>
							<div className="mb-3 flex items-center gap-2">
								<Badge
									variant="outline"
									className="border-primary/40 text-primary"
								>
									Superset
								</Badge>
								<span className="text-xs text-muted-foreground">
									{item.exercises.length} exercises
								</span>
							</div>
							<div className="space-y-2">
								{item.exercises.map((exercise, exerciseIndex) => (
									<RoutineExerciseCard
										key={`${exercise.name}-${exercise.order_index}`}
										exercise={exercise}
										index={exerciseIndex}
									/>
								))}
							</div>
						</div>
					),
				)}
			</div>
		</section>
	);
}

function SettingList({ title, value }: { title: string; value: unknown }) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const entries = Object.entries(value as Record<string, unknown>).filter(
		([, entryValue]) => entryValue !== null && entryValue !== undefined,
	);
	if (entries.length === 0) return null;

	return (
		<div className="rounded-lg border border-secondary bg-surface-2 p-3">
			<h5 className="mb-2 text-sm font-semibold text-white">{title}</h5>
			<div className="grid gap-2 sm:grid-cols-2">
				{entries.map(([key, entryValue]) => (
					<div key={key} className="text-xs">
						<span className="capitalize text-muted-foreground">
							{key.replace(/_/g, " ")}:
						</span>{" "}
						<span className="text-secondary-foreground">
							{String(entryValue)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function CycleRoutineDetails({
	routine,
}: {
	routine: EmbeddedRoutineSnapshot | null | undefined;
}) {
	if (!routine) {
		return (
			<p className="mt-2 text-xs text-muted-foreground">
				The routine assigned to this day is unavailable in the shared snapshot.
			</p>
		);
	}

	return (
		<details className="mt-3 rounded-lg border border-secondary bg-background/40 p-3">
			<summary className="cursor-pointer text-sm font-medium text-white">
				View {routine.name}
			</summary>
			<div className="mt-3">
				<RoutineSnapshotPreview
					exercises={routine.exercises}
					title={`${routine.name} Exercises`}
				/>
			</div>
		</details>
	);
}

export function CycleSnapshotPreview({
	snapshot,
}: {
	snapshot: CycleSnapshot | null | undefined;
}) {
	if (!snapshot) {
		return (
			<div className="rounded-lg border border-dashed border-secondary p-4 text-sm text-muted-foreground">
				Full cycle details are unavailable for this older share.
			</div>
		);
	}

	const days = [...snapshot.days].sort((a, b) => a.day_number - b.day_number);
	const workoutDays =
		snapshot.workout_days ??
		days.filter((day) => day.day_type === "workout").length;
	const restDays =
		snapshot.rest_days ?? days.filter((day) => day.day_type === "rest").length;

	return (
		<section className="space-y-3">
			<div className="flex items-center gap-2">
				<Calendar className="h-4 w-4 text-primary" />
				<h4 className="text-sm font-semibold text-white">Cycle Details</h4>
			</div>

			<div className="grid gap-2 sm:grid-cols-3">
				<div className="rounded-lg border border-secondary bg-surface-2 p-3">
					<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<Calendar className="h-3.5 w-3.5" />
						Duration
					</div>
					<p className="text-lg font-semibold text-white">
						{snapshot.duration_weeks} days
					</p>
				</div>
				<div className="rounded-lg border border-secondary bg-surface-2 p-3">
					<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<Dumbbell className="h-3.5 w-3.5" />
						Workouts
					</div>
					<p className="text-lg font-semibold text-white">{workoutDays}</p>
				</div>
				<div className="rounded-lg border border-secondary bg-surface-2 p-3">
					<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<Clock className="h-3.5 w-3.5" />
						Rest Days
					</div>
					<p className="text-lg font-semibold text-white">{restDays}</p>
				</div>
			</div>

			<SettingList title="Progression" value={snapshot.progression_settings} />
			<SettingList title="Deload" value={snapshot.deload_settings} />

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Repeat className="h-4 w-4 text-primary" />
					<h5 className="text-sm font-semibold text-white">Schedule</h5>
				</div>
				{days.map((day) => {
					const routine = day.routine;
					const isWorkout = day.day_type === "workout";

					return (
						<div
							key={day.day_number}
							className="rounded-lg border border-secondary bg-surface-2 p-3"
						>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
								<div>
									<div className="mb-1 flex flex-wrap items-center gap-2">
										<Badge
											variant={isWorkout ? "default" : "outline"}
											className={
												isWorkout
													? "border-0 bg-primary text-white"
													: "border-secondary text-muted-foreground"
											}
										>
											Day {day.day_number}
										</Badge>
										<h6 className="text-sm font-semibold text-white">
											{isWorkout ? (routine?.name ?? "Workout") : "Rest Day"}
										</h6>
									</div>
									{isWorkout && routine && (
										<p className="text-xs text-muted-foreground">
											{routine.exercise_count} exercises /{" "}
											{formatStoredDurationMinutes(routine.estimated_duration)}
										</p>
									)}
									{!isWorkout && (
										<p className="text-xs capitalize text-muted-foreground">
											{day.rest_type ?? "complete"} rest
										</p>
									)}
								</div>
								<div className="text-xs text-muted-foreground sm:text-right">
									{day.weight_adjustment !== 0 && (
										<p>
											Weight {day.weight_adjustment > 0 ? "+" : ""}
											{day.weight_adjustment}%
										</p>
									)}
									{day.rep_modifier !== 0 && (
										<p>
											Reps {day.rep_modifier > 0 ? "+" : ""}
											{day.rep_modifier}
										</p>
									)}
									{day.rest_override != null && (
										<p>Rest {day.rest_override}s</p>
									)}
								</div>
							</div>
							{day.notes && (
								<p className="mt-2 text-xs text-secondary-foreground">
									{day.notes}
								</p>
							)}
							{isWorkout && <CycleRoutineDetails routine={routine} />}
						</div>
					);
				})}
			</div>
		</section>
	);
}
