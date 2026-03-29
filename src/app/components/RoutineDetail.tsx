import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Clock,
	Dumbbell,
	Edit,
	Loader2,
	Repeat,
} from "lucide-react";
import { Link, useParams } from "react-router";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { useAuth } from "@/app/hooks/useAuth";
import { formatWeight, type WeightUnit } from "@/lib/units";
import { profileOptions } from "@/queries/profile";
import { routineDetailOptions } from "@/queries/routines";

function formatExercisePrescription(
	exercise: {
		sets: number;
		reps: number;
		weight: number;
		rest_seconds: number;
		duration_seconds?: number | null;
		is_amrap?: boolean;
		is_bodyweight?: boolean;
		mode: string;
	},
	unit: WeightUnit,
) {
	const loadLabel = exercise.is_bodyweight
		? "Bodyweight"
		: formatWeight(exercise.weight, unit);

	if (exercise.duration_seconds) {
		return `${exercise.sets} sets • ${exercise.duration_seconds}s • ${loadLabel} • ${exercise.mode}`;
	}

	if (exercise.is_amrap) {
		return `${exercise.sets} sets • AMRAP • ${loadLabel} • ${exercise.mode}`;
	}

	return `${exercise.sets} sets • ${exercise.reps} reps • ${loadLabel} • ${exercise.mode}`;
}

function exerciseBadges(exercise: {
	is_amrap?: boolean;
	is_bodyweight?: boolean;
	eccentric_load?: string | null;
	echo_level?: string | null;
	stall_detection?: boolean;
	rep_count_timing?: string | null;
	stop_at_position?: string | null;
}) {
	return [
		exercise.is_amrap ? "AMRAP" : null,
		exercise.is_bodyweight ? "Bodyweight" : null,
		exercise.eccentric_load ? `Eccentric: ${exercise.eccentric_load}` : null,
		exercise.echo_level ? `Echo: ${exercise.echo_level}` : null,
		exercise.stall_detection ? "Stall Detection" : null,
		exercise.rep_count_timing ? `Timing: ${exercise.rep_count_timing}` : null,
		exercise.stop_at_position ? `Stop: ${exercise.stop_at_position}` : null,
	].filter(Boolean) as string[];
}

export function RoutineDetail() {
	const { routineId } = useParams<{ routineId: string }>();
	const { user } = useAuth();
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const {
		data: routine,
		isLoading,
		isError,
	} = useQuery({
		...routineDetailOptions(routineId ?? ""),
		enabled: !!routineId,
	});
	const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	if (isLoading) {
		return (
			<PageShell className="min-h-screen">
				<div className="flex min-h-[50vh] items-center justify-center">
					<div className="flex flex-col items-center gap-4">
						<Loader2 className="h-8 w-8 animate-spin text-primary" />
						<p className="text-muted-foreground">Loading routine...</p>
					</div>
				</div>
			</PageShell>
		);
	}

	if (isError || !routine) {
		return (
			<PageShell className="min-h-screen">
				<Card className="mx-auto max-w-2xl border-secondary bg-surface-2 p-8 text-center">
					<h1 className="mb-2 text-2xl font-semibold text-white">
						Routine unavailable
					</h1>
					<p className="mb-6 text-muted-foreground">
						This routine could not be loaded. It may have been removed or you
						may no longer have access.
					</p>
					<Button asChild>
						<Link to="/routines">Back to Routines</Link>
					</Button>
				</Card>
			</PageShell>
		);
	}

	const groupedExercises = routine.routine_exercises.reduce<
		Array<
			| {
					type: "exercise";
					exercise: (typeof routine.routine_exercises)[number];
			  }
			| {
					type: "superset";
					id: string;
					color: string | null;
					exercises: (typeof routine.routine_exercises)[number][];
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
			color: exercise.superset_color ?? null,
			exercises: routine.routine_exercises
				.filter((entry) => entry.superset_id === exercise.superset_id)
				.sort((a, b) => (a.superset_order ?? 0) - (b.superset_order ?? 0)),
		});
		return items;
	}, []);

	return (
		<PageShell className="min-h-screen">
			<div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div>
					<Button
						variant="ghost"
						asChild
						className="mb-3 px-0 text-muted-foreground hover:text-white"
					>
						<Link to="/routines">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Routines
						</Link>
					</Button>
					<h1 className="mb-2 text-3xl text-white">{routine.name}</h1>
					<p className="max-w-2xl text-muted-foreground">
						{routine.description || "No description added yet."}
					</p>
				</div>

				<Button asChild variant="cta">
					<Link to={`/routines/${routine.id}`}>
						<Edit className="mr-2 h-4 w-4" />
						Edit Routine
					</Link>
				</Button>
			</div>

			<div className="mb-8 grid gap-4 md:grid-cols-4">
				<Card className="border-secondary bg-surface-2 p-4">
					<div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
						<Dumbbell className="h-4 w-4" />
						Exercises
					</div>
					<div className="text-2xl font-semibold text-white">
						{routine.exercise_count}
					</div>
				</Card>
				<Card className="border-secondary bg-surface-2 p-4">
					<div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
						<Clock className="h-4 w-4" />
						Estimated Duration
					</div>
					<div className="text-2xl font-semibold text-white">
						~{routine.estimated_duration} min
					</div>
				</Card>
				<Card className="border-secondary bg-surface-2 p-4">
					<div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
						<Repeat className="h-4 w-4" />
						Times Completed
					</div>
					<div className="text-2xl font-semibold text-white">
						{routine.times_completed}
					</div>
				</Card>
				<Card className="border-secondary bg-surface-2 p-4">
					<div className="mb-2 text-sm text-muted-foreground">Last Used</div>
					<div className="text-lg font-semibold text-white">
						{routine.last_used_at
							? routine.last_used_at.toLocaleDateString()
							: "Never"}
					</div>
				</Card>
			</div>

			<div className="space-y-4">
				{groupedExercises.map((item) =>
					item.type === "exercise" ? (
						<Card
							key={item.exercise.id}
							className="border-secondary bg-surface-2 p-5"
						>
							<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
								<div>
									<div className="mb-2 flex flex-wrap items-center gap-2">
										<h2 className="text-lg font-semibold text-white">
											{item.exercise.name}
										</h2>
										<Badge className="border-0 bg-primary text-white">
											{item.exercise.muscle_group}
										</Badge>
									</div>
									<p className="text-muted-foreground">
										{formatExercisePrescription(item.exercise, unit)}
									</p>
									<p className="mt-2 text-sm text-muted-foreground">
										Rest: {item.exercise.rest_seconds}s between sets
									</p>
								</div>
								<div className="flex flex-wrap gap-2 md:max-w-md md:justify-end">
									{exerciseBadges(item.exercise).map((badge) => (
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
						</Card>
					) : (
						<div
							key={item.id}
							className="rounded-xl border border-secondary bg-surface-2/50 p-4"
							style={{
								borderLeftColor: item.color ?? undefined,
								borderLeftWidth: 4,
							}}
						>
							<div className="mb-4 flex items-center gap-2">
								<Badge
									variant="outline"
									className="border-primary/40 text-primary"
								>
									Superset
								</Badge>
								<span className="text-sm text-muted-foreground">
									{item.exercises.length} exercises
								</span>
							</div>
							<div className="space-y-3">
								{item.exercises.map((exercise) => (
									<Card
										key={exercise.id}
										className="border-secondary bg-surface-2 p-5"
									>
										<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
											<div>
												<div className="mb-2 flex flex-wrap items-center gap-2">
													<h2 className="text-lg font-semibold text-white">
														{exercise.name}
													</h2>
													<Badge className="border-0 bg-primary text-white">
														{exercise.muscle_group}
													</Badge>
												</div>
												<p className="text-muted-foreground">
													{formatExercisePrescription(exercise, unit)}
												</p>
												<p className="mt-2 text-sm text-muted-foreground">
													Rest: {exercise.rest_seconds}s between sets
												</p>
											</div>
											<div className="flex flex-wrap gap-2 md:max-w-md md:justify-end">
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
									</Card>
								))}
							</div>
						</div>
					),
				)}
			</div>
		</PageShell>
	);
}
