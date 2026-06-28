import { Dumbbell, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";

interface RoutinePickerModalProps {
	isOpen: boolean;
	onClose: () => void;
	routines: Array<{
		id: string;
		name: string;
		exercises: number;
		duration: number;
		muscleGroup: string;
	}>;
	onSelect: (routineId: string) => void;
	/** Optional handler for the "Create New Routine" action. */
	onCreateRoutine?: () => void;
}

export function RoutinePickerModal({
	isOpen,
	onClose,
	routines,
	onSelect,
	onCreateRoutine,
}: RoutinePickerModalProps) {
	const [search, setSearch] = useState("");

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return routines;
		return routines.filter(
			(r) =>
				r.name.toLowerCase().includes(q) ||
				r.muscleGroup.toLowerCase().includes(q),
		);
	}, [routines, search]);

	// Only show the Recent section when not actively searching.
	const recent = search.trim() ? [] : routines.slice(0, 2);
	const all = filtered;

	return (
		<AnimatePresence>
			{isOpen && (
				<>
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						onClick={onClose}
						className="fixed inset-0 bg-black/80 z-50"
					/>

					<motion.div
						initial={{ opacity: 0, scale: 0.95, y: 20 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.95, y: 20 }}
						className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl z-50 max-h-[80vh] overflow-hidden"
					>
						<Card className="bg-surface-2 border-secondary">
							{/* Header */}
							<div className="flex items-center justify-between p-6 border-b border-secondary">
								<h2 className="text-xl font-semibold text-white">
									Select Routine
								</h2>
								<Button variant="ghost" size="sm" onClick={onClose}>
									<X className="w-5 h-5" />
								</Button>
							</div>

							{/* Search */}
							<div className="p-6 border-b border-secondary">
								<div className="relative">
									<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
									<Input
										placeholder="Search routines..."
										value={search}
										onChange={(e) => setSearch(e.target.value)}
										aria-label="Search routines"
										className="pl-10 bg-background border-secondary"
									/>
								</div>
							</div>

							{/* Content */}
							<div className="p-6 overflow-y-auto max-h-[calc(80vh-200px)]">
								{all.length === 0 && (
									<div className="text-center py-8 text-sm text-muted-foreground">
										No routines match "{search.trim()}"
									</div>
								)}
								{/* Recent */}
								{recent.length > 0 && (
									<div className="mb-6">
										<h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
											Recent
										</h3>
										<div className="space-y-2">
											{recent.map((routine) => (
												<button
													type="button"
													key={routine.id}
													onClick={() => onSelect(routine.id)}
													className="w-full p-4 bg-background border border-secondary rounded-lg hover:border-primary transition-all text-left group"
												>
													<div className="flex items-center justify-between">
														<div className="flex items-center gap-3">
															<div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
																<Dumbbell className="w-5 h-5 text-white" />
															</div>
															<div>
																<div className="font-semibold text-white">
																	{routine.name}
																</div>
																<div className="text-sm text-muted-foreground">
																	{routine.exercises} exercises • ~
																	{routine.duration} min
																</div>
															</div>
														</div>
														<Button
															size="sm"
															className="bg-primary hover:bg-chart-2 border-0 opacity-0 group-hover:opacity-100 transition-opacity"
														>
															Select
														</Button>
													</div>
												</button>
											))}
										</div>
									</div>
								)}

								{/* All Routines */}
								{all.length > 0 && (
									<div>
										<h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
											{search.trim() ? "Results" : "All My Routines"}
										</h3>
										<div className="space-y-2">
											{all.map((routine) => (
												<button
													type="button"
													key={routine.id}
													onClick={() => onSelect(routine.id)}
													className="w-full p-4 bg-background border border-secondary rounded-lg hover:border-primary transition-all text-left group"
												>
													<div className="flex items-center justify-between">
														<div>
															<div className="font-semibold text-white">
																{routine.name}
															</div>
															<div className="text-sm text-muted-foreground">
																{routine.exercises} exercises • ~
																{routine.duration} min
															</div>
														</div>
														<Button
															size="sm"
															className="bg-primary hover:bg-chart-2 border-0 opacity-0 group-hover:opacity-100 transition-opacity"
														>
															Select
														</Button>
													</div>
												</button>
											))}
										</div>
									</div>
								)}
							</div>

							{/* Footer */}
							{onCreateRoutine && (
								<div className="p-6 border-t border-secondary">
									<Button
										variant="outline"
										onClick={onCreateRoutine}
										className="w-full border-primary text-primary hover:bg-primary/10"
									>
										+ Create New Routine
									</Button>
								</div>
							)}
						</Card>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}
