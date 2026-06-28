import { Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import type { CycleDay, DayOverrides } from "./types";

interface DayEditorProps {
	day: CycleDay;
	onClose: () => void;
	onAssignRoutine: () => void;
	onConvertToRest: () => void;
	onConvertToWorkout: () => void;
	onUpdateOverrides: (overrides: DayOverrides) => void;
	onUpdateNotes: (notes: string) => void;
	onUpdateRestType: (type: "complete" | "active" | "mobility") => void;
	onRemoveFromSchedule: () => void;
}

export function DayEditor({
	day,
	onClose,
	onAssignRoutine,
	onConvertToRest,
	onConvertToWorkout,
	onUpdateOverrides,
	onUpdateNotes,
	onUpdateRestType,
	onRemoveFromSchedule,
}: DayEditorProps) {
	const overrides = day.overrides || {
		weightAdjustment: 0,
		repModifier: 0,
		restTimeOverride: undefined,
	};

	// Treat an explicit 0-second override as enabled; only null/undefined means
	// "no override".
	const [restTimeEnabled, setRestTimeEnabled] = useState(
		overrides.restTimeOverride != null,
	);

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				onClick={onClose}
				className="fixed inset-0 bg-black/60 z-40"
			/>

			<motion.div
				initial={{ x: "100%" }}
				animate={{ x: 0 }}
				exit={{ x: "100%" }}
				transition={{ type: "spring", damping: 25, stiffness: 200 }}
				className="fixed right-0 top-0 bottom-0 w-full md:w-[480px] bg-surface-2 border-l border-secondary z-50 overflow-y-auto"
			>
				<div className="sticky top-0 bg-surface-1 border-b border-secondary px-6 py-4 flex items-center justify-between">
					<h3 className="text-lg font-semibold text-white">
						Day {day.dayNumber}{" "}
						{day.type === "rest" ? "- Rest Day" : "Configuration"}
					</h3>
					<Button variant="ghost" size="sm" onClick={onClose}>
						<X className="w-5 h-5" />
					</Button>
				</div>

				<div className="p-6 space-y-6">
					{day.type === "workout" ? (
						<>
							{/* Assigned Routine */}
							<div>
								<Label className="text-secondary-foreground mb-2">
									Assigned Routine
								</Label>
								{day.routineName ? (
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
											className="border-secondary hover:border-primary"
										>
											Change
										</Button>
									</div>
								) : (
									<Button
										onClick={onAssignRoutine}
										variant="outline"
										className="w-full border-secondary hover:border-primary"
									>
										<Plus className="w-4 h-4 mr-2" />
										Assign Routine
									</Button>
								)}
								<Button
									size="sm"
									variant="ghost"
									onClick={onAssignRoutine}
									className="w-full mt-2 text-primary hover:text-chart-2"
								>
									+ Create New Routine
								</Button>
							</div>

							{/* Day-Specific Overrides */}
							<div className="pt-6 border-t border-secondary">
								<h4 className="font-semibold text-white mb-2">
									Day-Specific Overrides
								</h4>
								<p className="text-xs text-muted-foreground mb-4">
									Adjust settings for this day only
								</p>

								{/* Weight Adjustment */}
								<div className="mb-4">
									<Label className="text-sm text-muted-foreground mb-2">
										Weight Adjustment (%)
									</Label>
									<div className="flex items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												onUpdateOverrides({
													...overrides,
													weightAdjustment: overrides.weightAdjustment - 5,
												})
											}
											className="border-secondary"
										>
											−
										</Button>
										<Input
											type="number"
											value={overrides.weightAdjustment}
											onChange={(e) =>
												onUpdateOverrides({
													...overrides,
													weightAdjustment: parseInt(e.target.value, 10) || 0,
												})
											}
											className="text-center bg-background border-secondary"
										/>
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												onUpdateOverrides({
													...overrides,
													weightAdjustment: overrides.weightAdjustment + 5,
												})
											}
											className="border-secondary"
										>
											+
										</Button>
									</div>
									<p className="text-xs text-muted-foreground mt-1">
										Increase or decrease all weights for this day
									</p>
								</div>

								{/* Rep Modifier */}
								<div className="mb-4">
									<Label className="text-sm text-muted-foreground mb-2">
										Rep Modifier
									</Label>
									<div className="flex items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												onUpdateOverrides({
													...overrides,
													repModifier: overrides.repModifier - 1,
												})
											}
											className="border-secondary"
										>
											−
										</Button>
										<Input
											type="number"
											value={overrides.repModifier}
											onChange={(e) =>
												onUpdateOverrides({
													...overrides,
													repModifier: parseInt(e.target.value, 10) || 0,
												})
											}
											className="text-center bg-background border-secondary"
										/>
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												onUpdateOverrides({
													...overrides,
													repModifier: overrides.repModifier + 1,
												})
											}
											className="border-secondary"
										>
											+
										</Button>
									</div>
									<p className="text-xs text-muted-foreground mt-1">
										Add or subtract reps per set
									</p>
								</div>

								{/* Rest Time Override */}
								<div>
									<div className="flex items-center gap-2 mb-2">
										<Switch
											checked={restTimeEnabled}
											onCheckedChange={(checked) => {
												setRestTimeEnabled(checked);
												if (!checked) {
													onUpdateOverrides({
														...overrides,
														restTimeOverride: undefined,
													});
												} else {
													onUpdateOverrides({
														...overrides,
														restTimeOverride: 90,
													});
												}
											}}
										/>
										<Label className="text-sm text-muted-foreground">
											Override default rest times
										</Label>
									</div>
									{restTimeEnabled && (
										<div className="flex items-center gap-2 mt-2">
											<Button
												size="sm"
												variant="outline"
												onClick={() =>
													onUpdateOverrides({
														...overrides,
														restTimeOverride: Math.max(
															0,
															(overrides.restTimeOverride ?? 90) - 15,
														),
													})
												}
												className="border-secondary"
											>
												−
											</Button>
											<Input
												type="number"
												value={overrides.restTimeOverride ?? 90}
												onChange={(e) => {
													// Preserve an explicit 0; only fall back to the
													// default when cleared/non-numeric. Clamp negatives.
													const raw = e.target.value;
													const parsed = parseInt(raw, 10);
													onUpdateOverrides({
														...overrides,
														restTimeOverride:
															raw === "" || !Number.isFinite(parsed)
																? 90
																: Math.max(0, parsed),
													});
												}}
												className="text-center bg-background border-secondary"
											/>
											<span className="text-sm text-muted-foreground">s</span>
											<Button
												size="sm"
												variant="outline"
												onClick={() =>
													onUpdateOverrides({
														...overrides,
														restTimeOverride:
															(overrides.restTimeOverride || 90) + 15,
													})
												}
												className="border-secondary"
											>
												+
											</Button>
										</div>
									)}
								</div>
							</div>

							{/* Notes */}
							<div className="pt-6 border-t border-secondary">
								<Label className="text-secondary-foreground mb-2">Notes</Label>
								<Textarea
									value={day.notes || ""}
									onChange={(e) => onUpdateNotes(e.target.value)}
									className="bg-background border-secondary min-h-[100px]"
									placeholder="Focus on form today..."
								/>
							</div>

							{/* Actions */}
							<div className="space-y-2 pt-6 border-t border-secondary">
								<Button
									onClick={onConvertToRest}
									variant="outline"
									className="w-full border-secondary text-muted-foreground hover:border-primary hover:text-white"
								>
									Convert to Rest Day
								</Button>
								<Button
									onClick={onRemoveFromSchedule}
									variant="outline"
									className="w-full border-destructive text-destructive hover:bg-destructive hover:text-white"
								>
									<Trash2 className="w-4 h-4 mr-2" />
									Remove from Schedule
								</Button>
							</div>
						</>
					) : (
						<>
							{/* Rest Day Configuration */}
							<div className="text-center py-4">
								<div className="text-6xl mb-4">🛋️</div>
								<h4 className="text-xl font-semibold text-white mb-2">
									REST DAY
								</h4>
							</div>

							{/* Rest Type */}
							<div>
								<Label className="text-secondary-foreground mb-3">
									Rest Type
								</Label>
								<div className="space-y-2">
									<label className="flex items-start gap-3 p-3 bg-background border border-secondary rounded-lg cursor-pointer hover:border-primary transition-colors">
										<input
											type="radio"
											name="restType"
											checked={day.restType === "complete"}
											onChange={() => onUpdateRestType("complete")}
											className="mt-1"
										/>
										<div className="flex-1">
											<div className="font-semibold text-white">
												Complete Rest
											</div>
											<div className="text-sm text-muted-foreground">
												No structured activity
											</div>
										</div>
									</label>

									<label className="flex items-start gap-3 p-3 bg-background border border-secondary rounded-lg cursor-pointer hover:border-primary transition-colors">
										<input
											type="radio"
											name="restType"
											checked={day.restType === "active"}
											onChange={() => onUpdateRestType("active")}
											className="mt-1"
										/>
										<div className="flex-1">
											<div className="font-semibold text-white">
												Active Recovery
											</div>
											<div className="text-sm text-muted-foreground">
												Light movement, walking
											</div>
										</div>
									</label>

									<label className="flex items-start gap-3 p-3 bg-background border border-secondary rounded-lg cursor-pointer hover:border-primary transition-colors">
										<input
											type="radio"
											name="restType"
											checked={day.restType === "mobility"}
											onChange={() => onUpdateRestType("mobility")}
											className="mt-1"
										/>
										<div className="flex-1">
											<div className="font-semibold text-white">
												Mobility & Stretching
											</div>
											<div className="text-sm text-muted-foreground">
												Foam rolling, yoga
											</div>
										</div>
									</label>
								</div>
							</div>

							{/* Notes */}
							<div className="pt-6 border-t border-secondary">
								<Label className="text-secondary-foreground mb-2">Notes</Label>
								<Textarea
									value={day.notes || ""}
									onChange={(e) => onUpdateNotes(e.target.value)}
									className="bg-background border-secondary min-h-[100px]"
									placeholder="Light walk, foam rolling..."
								/>
							</div>

							{/* Actions */}
							<div className="space-y-2 pt-6 border-t border-secondary">
								<Button
									onClick={onConvertToWorkout}
									variant="outline"
									className="w-full border-primary text-primary hover:bg-primary/10"
								>
									Convert to Workout Day
								</Button>
								<Button
									onClick={onRemoveFromSchedule}
									variant="outline"
									className="w-full border-destructive text-destructive hover:bg-destructive hover:text-white"
								>
									<Trash2 className="w-4 h-4 mr-2" />
									Remove from Schedule
								</Button>
							</div>
						</>
					)}
				</div>
			</motion.div>
		</AnimatePresence>
	);
}
