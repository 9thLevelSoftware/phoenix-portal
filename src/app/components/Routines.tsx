import {
	Calendar,
	Clock,
	Copy,
	Dumbbell,
	Edit,
	Eye,
	Plus,
	Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";

export function Routines() {
	const myRoutines = [
		{
			id: 1,
			name: "Push Day A",
			exercises: 6,
			duration: "60 min",
			lastUsed: "2 hours ago",
			timesCompleted: 24,
			isFavorite: true,
		},
		{
			id: 2,
			name: "Pull Day B",
			exercises: 6,
			duration: "55 min",
			lastUsed: "Yesterday",
			timesCompleted: 22,
			isFavorite: true,
		},
		{
			id: 3,
			name: "Leg Day",
			exercises: 7,
			duration: "65 min",
			lastUsed: "2 days ago",
			timesCompleted: 19,
			isFavorite: true,
		},
		{
			id: 4,
			name: "Upper Power",
			exercises: 5,
			duration: "50 min",
			lastUsed: "3 days ago",
			timesCompleted: 18,
			isFavorite: false,
		},
	];

	const trainingCycles = [
		{
			id: 1,
			name: "Upper/Lower 4-Day Split",
			weeks: 8,
			currentWeek: 3,
			currentDay: 2,
			progress: 37,
			status: "active",
		},
		{
			id: 2,
			name: "Strength Building Phase",
			weeks: 12,
			currentWeek: 0,
			currentDay: 0,
			progress: 0,
			status: "upcoming",
		},
	];

	const exerciseLibrary = [
		{ name: "Bench Press", category: "Chest", equipment: "Barbell" },
		{ name: "Squat", category: "Legs", equipment: "Barbell" },
		{ name: "Deadlift", category: "Back", equipment: "Barbell" },
		{ name: "Overhead Press", category: "Shoulders", equipment: "Barbell" },
		{ name: "Barbell Row", category: "Back", equipment: "Barbell" },
		{ name: "Pull-ups", category: "Back", equipment: "Bodyweight" },
	];

	return (
		<div className="min-h-screen bg-background pb-20 md:pb-8">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
					<div>
						<h1 className="text-3xl sm:text-4xl mb-2">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								My Routines
							</span>
						</h1>
						<p className="text-muted-foreground">
							Create, manage, and track your workout routines
						</p>
					</div>
					<Button className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0 shadow-lg shadow-primary/50">
						<Plus className="w-4 h-4 mr-2" />
						Create Routine
					</Button>
				</div>

				<Tabs defaultValue="routines" className="space-y-6">
					<TabsList className="bg-surface-2 border border-secondary p-1">
						<TabsTrigger
							value="routines"
							className="data-[state=active]:bg-primary"
						>
							My Routines
						</TabsTrigger>
						<TabsTrigger
							value="cycles"
							className="data-[state=active]:bg-primary"
						>
							Training Cycles
						</TabsTrigger>
						<TabsTrigger
							value="library"
							className="data-[state=active]:bg-primary"
						>
							Exercise Library
						</TabsTrigger>
					</TabsList>

					{/* My Routines Tab */}
					<TabsContent value="routines" className="space-y-6">
						{/* Favorites */}
						<div>
							<h2 className="text-2xl text-white mb-4">⭐ Favorites</h2>
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
								{myRoutines
									.filter((r) => r.isFavorite)
									.map((routine, index) => (
										<motion.div
											key={routine.id}
											initial={{ opacity: 0, y: 20 }}
											animate={{ opacity: 1, y: 0 }}
											transition={{ delay: index * 0.1 }}
										>
											<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all h-full flex flex-col">
												<div className="flex-1">
													<div className="flex items-start justify-between mb-4">
														<h3 className="text-xl text-white">
															{routine.name}
														</h3>
														<Badge className="bg-accent text-background border-0">
															⭐
														</Badge>
													</div>

													<div className="space-y-3 mb-4">
														<div className="flex items-center gap-2 text-muted-foreground">
															<Dumbbell className="w-4 h-4" />
															<span className="text-sm">
																{routine.exercises} exercises
															</span>
														</div>
														<div className="flex items-center gap-2 text-muted-foreground">
															<Clock className="w-4 h-4" />
															<span className="text-sm">
																~{routine.duration}
															</span>
														</div>
														<div className="flex items-center gap-2 text-muted-foreground">
															<Calendar className="w-4 h-4" />
															<span className="text-sm">
																Last used: {routine.lastUsed}
															</span>
														</div>
													</div>

													<div className="p-3 bg-background rounded-lg border border-secondary mb-4">
														<div className="text-xs text-muted-foreground mb-1">
															Times Completed
														</div>
														<div className="text-2xl text-primary">
															{routine.timesCompleted}
														</div>
													</div>
												</div>

												<div className="grid grid-cols-2 gap-2">
													<Button className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0">
														<Eye className="w-4 h-4 mr-2" />
														View
													</Button>
													<Button
														variant="outline"
														className="border-secondary text-white hover:bg-secondary/50"
													>
														<Edit className="w-4 h-4 mr-2" />
														Edit
													</Button>
												</div>
											</Card>
										</motion.div>
									))}
							</div>
						</div>

						{/* All Routines */}
						<div>
							<h2 className="text-2xl text-white mb-4">All Routines</h2>
							<div className="space-y-3">
								{myRoutines.map((routine) => (
									<Card
										key={routine.id}
										className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all"
									>
										<div className="flex items-center gap-4">
											<div className="flex-1">
												<div className="flex items-center gap-2 mb-2">
													<h3 className="text-lg text-white">{routine.name}</h3>
													{routine.isFavorite && (
														<span className="text-accent">⭐</span>
													)}
												</div>
												<div className="flex items-center gap-4 text-sm text-muted-foreground">
													<span>{routine.exercises} exercises</span>
													<span>•</span>
													<span>{routine.duration}</span>
													<span>•</span>
													<span>{routine.timesCompleted} times completed</span>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<Button
													size="sm"
													className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
												>
													<Eye className="w-4 h-4" />
												</Button>
												<Button
													size="sm"
													variant="outline"
													className="border-secondary text-white hover:bg-secondary/50"
												>
													<Edit className="w-4 h-4" />
												</Button>
												<Button
													size="sm"
													variant="outline"
													className="border-secondary text-white hover:bg-secondary/50"
												>
													<Copy className="w-4 h-4" />
												</Button>
												<Button
													size="sm"
													variant="outline"
													className="border-destructive text-destructive hover:bg-destructive/10"
												>
													<Trash2 className="w-4 h-4" />
												</Button>
											</div>
										</div>
									</Card>
								))}
							</div>
						</div>
					</TabsContent>

					{/* Training Cycles Tab */}
					<TabsContent value="cycles" className="space-y-6">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
							{trainingCycles.map((cycle, index) => (
								<motion.div
									key={cycle.id}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.1 }}
								>
									<Card
										className={`p-6 h-full flex flex-col ${
											cycle.status === "active"
												? "bg-gradient-to-br from-primary/20 to-chart-2/20 border-primary border-2"
												: "bg-gradient-to-br from-surface-2 to-background border-secondary"
										}`}
									>
										<div className="flex-1">
											<div className="flex items-start justify-between mb-4">
												<h3 className="text-xl text-white">{cycle.name}</h3>
												<Badge
													className={
														cycle.status === "active"
															? "bg-gradient-to-r from-primary to-chart-2 text-white border-0"
															: "bg-secondary text-muted-foreground border-0"
													}
												>
													{cycle.status === "active" ? "ACTIVE" : "UPCOMING"}
												</Badge>
											</div>

											<div className="space-y-3 mb-4">
												<div className="flex items-center justify-between text-sm">
													<span className="text-muted-foreground">Duration</span>
													<span className="text-white">
														{cycle.weeks} weeks
													</span>
												</div>
												{cycle.status === "active" && (
													<>
														<div className="flex items-center justify-between text-sm">
															<span className="text-muted-foreground">
																Current Week
															</span>
															<span className="text-white">
																Week {cycle.currentWeek} of {cycle.weeks}
															</span>
														</div>
														<div className="flex items-center justify-between text-sm">
															<span className="text-muted-foreground">Progress</span>
															<span className="text-primary">
																{cycle.progress}%
															</span>
														</div>
														<div className="h-2 bg-secondary rounded-full overflow-hidden">
															<div
																className="h-full bg-gradient-to-r from-primary to-chart-2 rounded-full"
																style={{ width: `${cycle.progress}%` }}
															/>
														</div>
													</>
												)}
											</div>
										</div>

										<div className="grid grid-cols-2 gap-2">
											{cycle.status === "active" ? (
												<>
													<Button className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0">
														Continue
													</Button>
													<Button
														variant="outline"
														className="border-secondary text-white hover:bg-secondary/50"
													>
														Edit
													</Button>
												</>
											) : (
												<>
													<Button className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0">
														Start
													</Button>
													<Button
														variant="outline"
														className="border-secondary text-white hover:bg-secondary/50"
													>
														Preview
													</Button>
												</>
											)}
										</div>
									</Card>
								</motion.div>
							))}

							{/* Create New Cycle Card */}
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary border-dashed hover:border-primary/50 transition-all flex items-center justify-center min-h-[300px] cursor-pointer">
								<div className="text-center">
									<div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
										<Plus className="w-8 h-8 text-white" />
									</div>
									<h3 className="text-xl text-white mb-2">
										Create Training Cycle
									</h3>
									<p className="text-sm text-muted-foreground">
										Plan your long-term training program
									</p>
								</div>
							</Card>
						</div>
					</TabsContent>

					{/* Exercise Library Tab */}
					<TabsContent value="library" className="space-y-6">
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<h3 className="text-xl text-white mb-6">Exercise Library</h3>
							<div className="space-y-2">
								{exerciseLibrary.map((exercise, index) => (
									<div
										key={index}
										className="flex items-center justify-between p-4 bg-background rounded-lg border border-secondary hover:border-primary/50 transition-all cursor-pointer"
									>
										<div>
											<h4 className="text-white mb-1">{exercise.name}</h4>
											<div className="flex items-center gap-2">
												<Badge className="bg-secondary text-secondary-foreground border-0 text-xs">
													{exercise.category}
												</Badge>
												<Badge className="bg-secondary text-secondary-foreground border-0 text-xs">
													{exercise.equipment}
												</Badge>
											</div>
										</div>
										<Button
											size="sm"
											variant="outline"
											className="border-primary text-primary hover:bg-primary/10"
										>
											<Plus className="w-4 h-4 mr-2" />
											Add to Routine
										</Button>
									</div>
								))}
							</div>
						</Card>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
