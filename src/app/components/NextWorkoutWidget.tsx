import { useQuery } from "@tanstack/react-query";
import { Calendar, Dumbbell, Leaf } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import { computeNextWorkout } from "@/lib/computeNextWorkout";
import { cycleDetailOptions } from "@/queries/cycles";
import { routineDetailOptions } from "@/queries/routines";

function RoutineName({ routineId }: { routineId: string }) {
	const { data: routine, isPending } = useQuery(
		routineDetailOptions(routineId),
	);

	if (isPending) return <Skeleton className="h-6 w-40" />;
	return <>{routine?.name ?? "Custom Workout"}</>;
}

export function NextWorkoutWidget({ cycleId }: { cycleId: string }) {
	const {
		data: cycleDetail,
		isPending,
		isError,
	} = useQuery(cycleDetailOptions(cycleId));

	if (isPending) {
		return (
			<Card className="p-6 bg-surface-2 border-secondary" data-print-hide>
				<div className="flex items-center justify-between mb-4">
					<Skeleton className="h-6 w-40" />
					<Skeleton className="h-5 w-24" />
				</div>
				<div className="space-y-3">
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-10 w-full" />
				</div>
			</Card>
		);
	}

	if (isError || !cycleDetail) {
		return (
			<Card className="p-6 bg-surface-2 border-secondary" data-print-hide>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-xl text-white">Today's Workout</h3>
				</div>
				<div className="flex flex-col items-center justify-center py-6 text-center">
					<Calendar className="w-10 h-10 text-secondary mb-3" />
					<p className="text-muted-foreground">Cycle schedule unavailable</p>
				</div>
			</Card>
		);
	}

	// Compute today's workout day
	const result =
		cycleDetail.started_at && cycleDetail.cycle_days.length > 0
			? computeNextWorkout(
					cycleDetail.cycle_days,
					cycleDetail.started_at,
					cycleDetail.duration_weeks,
				)
			: null;

	if (!result) {
		return (
			<Card className="p-6 bg-surface-2 border-secondary" data-print-hide>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-xl text-white">Today's Workout</h3>
					<Badge className="bg-secondary text-muted-foreground border-0">
						{cycleDetail.name}
					</Badge>
				</div>
				<div className="flex flex-col items-center justify-center py-6 text-center">
					<Calendar className="w-10 h-10 text-secondary mb-3" />
					<p className="text-muted-foreground">Cycle schedule unavailable</p>
					<p className="text-sm text-muted-foreground mt-1">
						The cycle may have ended or not started yet
					</p>
				</div>
			</Card>
		);
	}

	// Rest day card
	if (result.isRestDay) {
		return (
			<Card
				className="p-6 bg-surface-2 border-secondary hover:border-success/50 transition-all duration-300"
				data-print-hide
			>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-xl text-white">Today's Schedule</h3>
					<Badge className="bg-success text-white border-0">Rest Day</Badge>
				</div>
				<div className="space-y-4">
					<div className="flex items-center gap-3">
						<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-success/20 to-success/5 flex items-center justify-center">
							<Leaf className="w-6 h-6 text-success" />
						</div>
						<div>
							<h4 className="text-2xl text-success">Rest Day</h4>
							<p className="text-muted-foreground">
								Day {result.dayNumber} - Week {result.cycleWeek} of{" "}
								{cycleDetail.duration_weeks}
							</p>
						</div>
					</div>
					<p className="text-sm text-muted-foreground">
						Recovery is part of the process. Let your muscles rebuild and come
						back stronger.
					</p>
					<Button
						className="w-full bg-gradient-to-r from-success/80 to-success hover:from-success hover:to-success/80 border-0 shadow-lg shadow-success/30"
						asChild
					>
						<Link to={`/cycles/${cycleId}`}>
							<Calendar className="w-4 h-4 mr-2" />
							View Full Cycle
						</Link>
					</Button>
				</div>
			</Card>
		);
	}

	// Workout day card
	return (
		<Card
			className="p-6 bg-surface-2 border-secondary hover:border-primary/50 transition-all duration-300"
			data-print-hide
		>
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-xl text-white">Today's Workout</h3>
				<Badge className="bg-success text-white border-0">Active Cycle</Badge>
			</div>
			<div className="space-y-4">
				<div className="flex items-center gap-3">
					<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-chart-2/20 flex items-center justify-center">
						<Dumbbell className="w-6 h-6 text-primary" />
					</div>
					<div>
						<h4 className="text-2xl text-primary">Day {result.dayNumber}</h4>
						<p className="text-muted-foreground">
							Week {result.cycleWeek} of {cycleDetail.duration_weeks}
						</p>
					</div>
				</div>
				<div className="p-3 bg-background rounded-lg border border-secondary">
					<p className="text-sm text-muted-foreground mb-1">Routine</p>
					<p className="text-white font-semibold">
						{result.routineId ? (
							<RoutineName routineId={result.routineId} />
						) : (
							"Custom Workout"
						)}
					</p>
				</div>
				<Button
					variant="cta"
					className="w-full shadow-lg shadow-primary/50"
					asChild
				>
					<Link to={`/cycles/${cycleId}`}>
						<Calendar className="w-4 h-4 mr-2" />
						View Full Cycle
					</Link>
				</Button>
			</div>
		</Card>
	);
}
