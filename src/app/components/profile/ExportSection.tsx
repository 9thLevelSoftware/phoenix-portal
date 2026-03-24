import { useQuery } from "@tanstack/react-query";
import { Archive, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { useAuth } from "@/app/hooks/useAuth";
import {
	downloadCSV,
	generateRecordsCSV,
	generateWorkoutCSV,
} from "@/lib/export/csv";
import { exportAllUserData } from "@/lib/export/data-export";
import { profileOptions } from "@/queries/profile";
import { personalRecordsOptions } from "@/queries/records";
import { workoutListOptions } from "@/queries/workouts";

export function ExportSection() {
	const { user } = useAuth();
	const { data: workouts, isLoading: workoutsLoading } = useQuery(
		workoutListOptions(user?.id ?? ""),
	);
	const { data: records, isLoading: recordsLoading } = useQuery(
		personalRecordsOptions(user?.id ?? ""),
	);
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const [exporting, setExporting] = useState<"workouts" | "records" | null>(
		null,
	);
	const [fullExporting, setFullExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<{
		step: string;
		percent: number;
	} | null>(null);
	const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	const handleExportWorkouts = () => {
		if (!workouts?.length) {
			toast.error("No workout data to export");
			return;
		}

		setExporting("workouts");
		try {
			const csv = generateWorkoutCSV(workouts, unit);
			const filename = `phoenix-workouts-${new Date().toISOString().split("T")[0]}`;
			downloadCSV(csv, filename);
			toast.success(`Exported ${workouts.length} workouts`);
		} catch (error) {
			toast.error("Failed to export workouts");
			console.error("Export error:", error);
		} finally {
			setExporting(null);
		}
	};

	const handleFullExport = async () => {
		if (!user?.id) return;
		setFullExporting(true);
		setExportProgress({ step: "Starting...", percent: 0 });
		try {
			await exportAllUserData(user.id, (step, current, total) => {
				setExportProgress({
					step,
					percent: Math.round((current / total) * 100),
				});
			});
			toast.success("Data export complete — check your downloads folder");
		} catch (error) {
			toast.error("Failed to export data");
			console.error("Full export error:", error);
		} finally {
			setFullExporting(false);
			setExportProgress(null);
		}
	};

	const handleExportRecords = () => {
		if (!records?.length) {
			toast.error("No personal records to export");
			return;
		}

		setExporting("records");
		try {
			const csv = generateRecordsCSV(records, unit);
			const filename = `phoenix-records-${new Date().toISOString().split("T")[0]}`;
			downloadCSV(csv, filename);
			toast.success(`Exported ${records.length} personal records`);
		} catch (error) {
			toast.error("Failed to export records");
			console.error("Export error:", error);
		} finally {
			setExporting(null);
		}
	};

	return (
		<Card className="bg-surface-2 border-secondary">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-white">
					<FileSpreadsheet className="h-5 w-5 text-primary" />
					Export Data
				</CardTitle>
				<CardDescription>
					Download your workout history and personal records as CSV files
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col sm:flex-row gap-3">
					<Button
						variant="outline"
						onClick={handleExportWorkouts}
						disabled={workoutsLoading || exporting !== null}
						className="flex-1 border-secondary text-white hover:bg-secondary/50"
					>
						{exporting === "workouts" ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Download className="mr-2 h-4 w-4" />
						)}
						Export Workout History
						{workouts?.length ? ` (${workouts.length})` : ""}
					</Button>

					<Button
						variant="outline"
						onClick={handleExportRecords}
						disabled={recordsLoading || exporting !== null}
						className="flex-1 border-secondary text-white hover:bg-secondary/50"
					>
						{exporting === "records" ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Download className="mr-2 h-4 w-4" />
						)}
						Export Personal Records
						{records?.length ? ` (${records.length})` : ""}
					</Button>
				</div>

				<p className="text-xs text-muted-foreground">
					CSV files can be opened in Excel, Google Sheets, or any spreadsheet
					application.
				</p>

				<div className="border-t border-secondary pt-4 mt-4">
					<p className="text-sm font-medium text-white mb-2">
						Complete Data Export
					</p>
					<p className="text-xs text-muted-foreground mb-3">
						Download all your data as a ZIP file containing JSON files. This
						includes your complete workout history, telemetry, records,
						routines, goals, comments, and account information.
					</p>
					{exportProgress && (
						<div className="mb-3 space-y-1">
							<p className="text-xs text-muted-foreground">
								{exportProgress.step}
							</p>
							<div className="w-full bg-secondary/30 rounded-full h-2">
								<div
									className="bg-primary h-2 rounded-full transition-all duration-300"
									style={{ width: `${exportProgress.percent}%` }}
								/>
							</div>
						</div>
					)}
					<Button
						variant="outline"
						onClick={handleFullExport}
						disabled={fullExporting}
						className="w-full border-primary text-primary hover:bg-primary/10"
					>
						{fullExporting ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Archive className="mr-2 h-4 w-4" />
						)}
						{fullExporting ? "Exporting..." : "Download All My Data (ZIP)"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
