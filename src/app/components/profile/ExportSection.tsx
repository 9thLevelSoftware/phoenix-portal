import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
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

	const [exporting, setExporting] = useState<"workouts" | "records" | null>(
		null,
	);

	const handleExportWorkouts = () => {
		if (!workouts?.length) {
			toast.error("No workout data to export");
			return;
		}

		setExporting("workouts");
		try {
			const csv = generateWorkoutCSV(workouts);
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

	const handleExportRecords = () => {
		if (!records?.length) {
			toast.error("No personal records to export");
			return;
		}

		setExporting("records");
		try {
			const csv = generateRecordsCSV(records);
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
		<Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-white">
					<FileSpreadsheet className="h-5 w-5 text-[#FF6B35]" />
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
						className="flex-1 border-[#374151] text-white hover:bg-[#374151]/50"
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
						className="flex-1 border-[#374151] text-white hover:bg-[#374151]/50"
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
			</CardContent>
		</Card>
	);
}
