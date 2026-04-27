import { useQuery } from "@tanstack/react-query";
import { Clock, Dumbbell, Search } from "lucide-react";
import { useState } from "react";
import { Card } from "@/app/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { workoutListOptions } from "@/queries/workouts";

interface ComparisonSessionPickerProps {
	open: boolean;
	onClose: () => void;
	excludeSessionId?: string;
	onSelect: (sessionId: string) => void;
}

export function ComparisonSessionPicker({
	open,
	onClose,
	excludeSessionId,
	onSelect,
}: ComparisonSessionPickerProps) {
	const { user } = useAuth();
	const { data: workouts, isPending } = useQuery(
		workoutListOptions(user?.id ?? ""),
	);
	const [search, setSearch] = useState("");

	const filteredWorkouts = (workouts ?? [])
		.filter((w) => w.id !== excludeSessionId)
		.filter((w) => {
			if (!search) return true;
			const q = search.toLowerCase();
			return (
				w.name.toLowerCase().includes(q) ||
				w.started_at.toLocaleDateString().includes(q)
			);
		});

	const handleSelect = (sessionId: string) => {
		onSelect(sessionId);
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="bg-background border-secondary max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle className="text-white">
						Select Session to Compare
					</DialogTitle>
					<DialogDescription>
						Choose a workout session to compare against
					</DialogDescription>
				</DialogHeader>

				{/* Search */}
				<div className="relative">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
					<input
						type="text"
						placeholder="Search by name or date..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full pl-10 pr-4 py-2 bg-surface-2 border border-secondary rounded-lg text-white text-sm placeholder:text-muted focus:border-primary focus:outline-none"
					/>
				</div>

				{/* Session list */}
				<div className="overflow-y-auto flex-1 space-y-2 min-h-0">
					{isPending ? (
						<div className="space-y-2">
							{Array.from({ length: 5 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list never reorders
								<Skeleton key={i} className="h-20 bg-surface-2 rounded-lg" />
							))}
						</div>
					) : filteredWorkouts.length === 0 ? (
						<div className="py-8 text-center text-muted-foreground text-sm">
							No sessions found
						</div>
					) : (
						filteredWorkouts.map((workout) => (
							<Card
								key={workout.id}
								onClick={() => handleSelect(workout.id)}
								className="p-3 bg-surface-2 border-secondary hover:border-primary/50 transition-all cursor-pointer"
							>
								<div className="flex items-center gap-3">
									<div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
										<Dumbbell className="w-5 h-5 text-white" />
									</div>
									<div className="flex-1 min-w-0">
										<h4 className="text-sm font-semibold text-white truncate">
											{workout.name}
										</h4>
										<div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
											<span>
												{workout.started_at.toLocaleDateString("en-US", {
													month: "short",
													day: "numeric",
													year: "numeric",
												})}
											</span>
											<span className="flex items-center gap-1">
												<Clock className="w-3 h-3" />
												{workout.duration_seconds}m
											</span>
											<span>{workout.total_volume.toLocaleString()} kg</span>
										</div>
									</div>
								</div>
							</Card>
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
