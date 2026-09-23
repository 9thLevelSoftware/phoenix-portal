import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Archive, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
	cancelUserDataExport,
	ExportAlreadyRunningError,
	ExportCancelledError,
	exportAllUserData,
	exportAnalyticsTablesZip,
	getRunningUserDataExport,
} from "@/lib/export/data-export";
import { profileOptions } from "@/queries/profile";
import { personalRecordsOptions } from "@/queries/records";
import { workoutListOptions } from "@/queries/workouts";

export function ExportSection() {
	const { user } = useAuth();
	const { data: workouts, isLoading: workoutsLoading } = useQuery(
		workoutListOptions(user?.id ?? ""),
	);
	const {
		data: records,
		isLoading: recordsLoading,
		hasNextPage: hasMoreRecords,
		fetchNextPage: fetchMoreRecords,
	} = useInfiniteQuery(personalRecordsOptions(user?.id ?? ""));
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const [exporting, setExporting] = useState<"workouts" | "records" | null>(
		null,
	);
	const [fullExporting, setFullExporting] = useState(false);
	const [analyticsExporting, setAnalyticsExporting] = useState(false);
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

	const showFullExportProgress = (
		step: string,
		current: number,
		total: number,
	) => {
		setExportProgress({ step, percent: Math.round((current / total) * 100) });
	};

	// An export started before a remount keeps running: show it instead of
	// allowing a second one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: attach once on mount
	useEffect(() => {
		const running = getRunningUserDataExport();
		if (!running) return;
		setFullExporting(true);
		const unsubscribe = running.subscribe(showFullExportProgress);
		running.promise
			.catch(() => {})
			.finally(() => {
				setFullExporting(false);
				setExportProgress(null);
			});
		return unsubscribe;
	}, []);

	const handleFullExport = async () => {
		if (!user?.id) return;
		setFullExporting(true);
		setExportProgress({ step: "Starting...", percent: 0 });
		try {
			await exportAllUserData(user.id, showFullExportProgress);
			toast.success("Data export complete — check your downloads folder");
		} catch (error) {
			if (error instanceof ExportCancelledError) {
				toast.info("Data export cancelled — nothing was downloaded");
				return;
			}
			if (error instanceof ExportAlreadyRunningError) {
				toast.info("A data export is already running");
				return;
			}
			// Name the failure: no partial file was downloaded.
			toast.error("Failed to export data — nothing was downloaded", {
				description: error instanceof Error ? error.message : undefined,
			});
			console.error("Full export error:", error);
		} finally {
			setFullExporting(false);
			setExportProgress(null);
		}
	};

	const handleAnalyticsExport = async () => {
		if (!user?.id) return;
		setAnalyticsExporting(true);
		setExportProgress({ step: "Starting analytics export...", percent: 0 });
		try {
			await exportAnalyticsTablesZip(user.id, unit, (step, current, total) => {
				setExportProgress({
					step,
					percent: Math.round((current / total) * 100),
				});
			});
			toast.success("Analytics tables export complete");
		} catch (error) {
			toast.error("Failed to export analytics tables");
			console.error("Analytics export error:", error);
		} finally {
			setAnalyticsExporting(false);
			setExportProgress(null);
		}
	};

	// The records query is keyset-paged, so the export drains the remaining
	// pages first: a CSV that stops at the first page would be an incomplete
	// export rather than a visible failure.
	const loadAllRecords = async () => {
		let page = { data: records, hasNextPage: hasMoreRecords };
		// Bounded so a server that keeps reporting another page cannot spin.
		for (let i = 0; i < 200 && page.hasNextPage; i++) {
			page = await fetchMoreRecords();
		}
		return page.data ?? [];
	};

	const handleExportRecords = async () => {
		if (!records?.length) {
			toast.error("No personal records to export");
			return;
		}

		setExporting("records");
		try {
			const allRecords = await loadAllRecords();
			const csv = generateRecordsCSV(allRecords, unit);
			const filename = `phoenix-records-${new Date().toISOString().split("T")[0]}`;
			downloadCSV(csv, filename);
			toast.success(`Exported ${allRecords.length} personal records`);
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
				<CardTitle className="flex items-center gap-2 text-foreground">
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
						className="flex-1 border-secondary text-foreground hover:bg-secondary/50"
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
						onClick={() => {
							void handleExportRecords();
						}}
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

				{exportProgress && (
					<div className="space-y-1 rounded-md border border-secondary bg-muted/10 p-3">
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

				<div className="border-t border-secondary pt-4 mt-4">
					<p className="text-sm font-medium text-white mb-2">
						Analytics Tables
					</p>
					<p className="text-xs text-muted-foreground mb-3">
						Download cleaned CSV tables for workout-exercise summaries, daily
						summaries, muscle contributions, and rep summaries.
					</p>
					<Button
						variant="outline"
						onClick={handleAnalyticsExport}
						disabled={analyticsExporting || fullExporting || !user?.id}
						className="w-full border-secondary text-white hover:bg-secondary/50"
					>
						{analyticsExporting ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Archive className="mr-2 h-4 w-4" />
						)}
						{analyticsExporting
							? "Exporting Analytics..."
							: "Export Analytics Tables (ZIP)"}
					</Button>
				</div>

				<div className="border-t border-secondary pt-4 mt-4">
					<p className="text-sm font-medium text-white mb-2">
						Complete Data Export
					</p>
					<p className="text-xs text-muted-foreground mb-3">
						Download all your data as a ZIP file containing JSON files. This
						includes your complete workout history, telemetry, records,
						routines, goals, comments, and account information. Large histories
						can take a while; the export is built in your browser, so very large
						exports (several million telemetry rows) may not fit in memory.
					</p>
					<Button
						variant="outline"
						onClick={handleFullExport}
						disabled={fullExporting || analyticsExporting}
						className="w-full border-primary text-primary hover:bg-primary/10"
					>
						{fullExporting ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Archive className="mr-2 h-4 w-4" />
						)}
						{fullExporting ? "Exporting..." : "Download All My Data (ZIP)"}
					</Button>
					{fullExporting && (
						<Button
							variant="ghost"
							onClick={() => cancelUserDataExport()}
							className="w-full mt-2 text-muted-foreground"
						>
							Cancel export
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
