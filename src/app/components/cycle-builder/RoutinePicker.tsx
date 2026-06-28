import { Dumbbell, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import type { Routine } from "./types";

interface RoutinePickerProps {
	isOpen: boolean;
	onClose: () => void;
	routines: Routine[];
	onSelect: (routineId: string) => void;
	onCreateNew: () => void;
}

export function RoutinePicker({
	isOpen,
	onClose,
	routines,
	onSelect,
	onCreateNew,
}: RoutinePickerProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedFilter, setSelectedFilter] = useState<string>("All");

	const filters = [
		"All",
		"Push",
		"Pull",
		"Legs",
		"Upper",
		"Lower",
		"Full Body",
	];

	const recentRoutines = routines
		.filter((r) => r.lastUsed)
		.sort((a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0))
		.slice(0, 3);

	const filteredRoutines = routines.filter((routine) => {
		const matchesSearch = routine.name
			.toLowerCase()
			.includes(searchQuery.toLowerCase());
		const matchesFilter =
			selectedFilter === "All" || routine.muscleGroup === selectedFilter;
		return matchesSearch && matchesFilter;
	});

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
						className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl z-50 max-h-[85vh] overflow-hidden"
					>
						<Card className="bg-surface-2 border-secondary">
							{/* Header */}
							<div className="flex items-center justify-between p-6 border-b border-secondary">
								<h2 className="text-2xl font-semibold text-white">
									Select Routine
								</h2>
								<Button variant="ghost" size="sm" onClick={onClose}>
									<X className="w-5 h-5" />
								</Button>
							</div>

							{/* Search & Filters */}
							<div className="p-6 space-y-4 border-b border-secondary">
								<div className="relative">
									<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
									<Input
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										placeholder="Search routines..."
										className="pl-10 bg-background border-secondary focus:border-primary"
									/>
								</div>

								<div className="flex flex-wrap gap-2">
									<span className="text-sm text-muted-foreground self-center mr-2">
										Filter:
									</span>
									{filters.map((filter) => (
										<Button
											key={filter}
											size="sm"
											variant={
												selectedFilter === filter ? "default" : "outline"
											}
											onClick={() => setSelectedFilter(filter)}
											className={
												selectedFilter === filter
													? "bg-primary hover:bg-chart-2 border-0"
													: "border-secondary hover:border-primary"
											}
										>
											{filter}
										</Button>
									))}
								</div>
							</div>

							{/* Content */}
							<div className="p-6 overflow-y-auto max-h-[calc(85vh-300px)]">
								{/* Recently Used */}
								{recentRoutines.length > 0 &&
									searchQuery === "" &&
									selectedFilter === "All" && (
										<div className="mb-6">
											<h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
												Recently Used
											</h3>
											<div className="space-y-2">
												{recentRoutines.map((routine) => (
													<RoutineItem
														key={routine.id}
														routine={routine}
														onSelect={() => onSelect(routine.id)}
														showLastUsed
													/>
												))}
											</div>
										</div>
									)}

								{/* All Routines */}
								<div>
									<h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
										{searchQuery || selectedFilter !== "All"
											? "Results"
											: "All My Routines"}
									</h3>
									{filteredRoutines.length > 0 ? (
										<div className="space-y-2">
											{filteredRoutines.map((routine) => (
												<RoutineItem
													key={routine.id}
													routine={routine}
													onSelect={() => onSelect(routine.id)}
												/>
											))}
										</div>
									) : (
										<div className="text-center py-8 text-muted-foreground">
											<p>No routines found</p>
											<p className="text-sm mt-2">
												Try adjusting your search or filters
											</p>
										</div>
									)}
								</div>
							</div>

							{/* Footer */}
							<div className="p-6 border-t border-secondary">
								<p className="text-sm text-muted-foreground mb-3">
									Don't see what you need?
								</p>
								<Button
									onClick={onCreateNew}
									variant="outline"
									className="w-full border-primary text-primary hover:bg-primary/10"
								>
									<Plus className="w-4 h-4 mr-2" />
									Create New Routine
								</Button>
							</div>
						</Card>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}

function RoutineItem({
	routine,
	onSelect,
	showLastUsed = false,
}: {
	routine: Routine;
	onSelect: () => void;
	showLastUsed?: boolean;
}) {
	const getTimeAgo = (date: Date) => {
		const days = Math.floor(
			(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24),
		);
		if (days === 0) return "Today";
		if (days === 1) return "Yesterday";
		return `${days} days ago`;
	};

	return (
		// Use a non-button container so the inner Select button isn't nested inside
		// another button (invalid HTML) and clicks don't fire onSelect twice.
		// biome-ignore lint/a11y/useSemanticElements: a <button> can't contain the inner Select <button>, so a role=button div is required here.
		<div
			role="button"
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			className="w-full p-4 bg-background border border-secondary rounded-lg hover:border-primary transition-all text-left group cursor-pointer"
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3 flex-1">
					<div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
						<Dumbbell className="w-5 h-5 text-white" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="font-semibold text-white mb-1">{routine.name}</div>
						<div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
							<span>{routine.exercises} exercises</span>
							<span className="text-muted-foreground">•</span>
							<span>~{routine.duration} min</span>
							{showLastUsed && routine.lastUsed && (
								<>
									<span className="text-muted-foreground">•</span>
									<span>Last used: {getTimeAgo(routine.lastUsed)}</span>
								</>
							)}
						</div>
					</div>
				</div>
				<Button
					size="sm"
					className="bg-primary hover:bg-chart-2 border-0 opacity-0 group-hover:opacity-100 transition-opacity ml-4"
					onClick={(e) => {
						// Prevent the outer card's onClick from also firing.
						e.stopPropagation();
						onSelect();
					}}
				>
					Select
				</Button>
			</div>
		</div>
	);
}
