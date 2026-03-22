import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Dumbbell, FileText, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
	importStrongActivities,
	parseStrongCSV,
} from "@/lib/integrations/strong";
import type { NormalizedActivity } from "@/lib/integrations/types";
import { queryKeys } from "@/queries/keys";

interface StrongConnectProps {
	userId: string;
	isConnected?: boolean;
	onDisconnect?: () => void;
}

/**
 * Strong connection component -- CSV import only (no API available).
 * Includes a weight unit selector since Strong exports in the user's
 * configured unit (kg or lbs) with no way to determine which from the file.
 */
export function StrongConnect({
	userId,
	isConnected,
	onDisconnect,
}: StrongConnectProps) {
	const queryClient = useQueryClient();

	// CSV import state
	const [parsedActivities, setParsedActivities] = useState<
		NormalizedActivity[] | null
	>(null);
	const [isImporting, setIsImporting] = useState(false);
	const [csvFileName, setCsvFileName] = useState<string | null>(null);
	const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
	const fileInputRef = useRef<HTMLInputElement>(null);

	// =========================================================================
	// CSV Import Handlers
	// =========================================================================

	const handleFileSelect = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			if (!file) return;

			if (!file.name.endsWith(".csv")) {
				toast.error("Please select a CSV file");
				return;
			}

			setCsvFileName(file.name);

			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const csvContent = e.target?.result as string;
					const activities = parseStrongCSV(csvContent, weightUnit);

					if (activities.length === 0) {
						toast.error(
							"No workouts found in CSV. Verify this is a Strong export file.",
						);
						setParsedActivities(null);
						return;
					}

					setParsedActivities(activities);
				} catch (_err) {
					toast.error(
						"Failed to parse CSV file. Make sure it is a valid Strong export.",
					);
					setParsedActivities(null);
				}
			};
			reader.onerror = () => {
				toast.error("Failed to read file");
			};
			reader.readAsText(file);
		},
		[weightUnit],
	);

	const handleImport = useCallback(async () => {
		if (!parsedActivities || parsedActivities.length === 0) return;

		setIsImporting(true);
		try {
			const count = await importStrongActivities(userId, parsedActivities);

			toast.success(`Imported ${count} workouts from Strong`);
			await queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.external(userId),
			});
			setParsedActivities(null);
			setCsvFileName(null);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to import workouts",
			);
		} finally {
			setIsImporting(false);
		}
	}, [parsedActivities, queryClient, userId]);

	const handleClearPreview = useCallback(() => {
		setParsedActivities(null);
		setCsvFileName(null);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	}, []);

	// =========================================================================
	// Preview Helpers
	// =========================================================================

	function getDateRange(activities: NormalizedActivity[]): string {
		if (activities.length === 0) return "";
		const dates = activities.map((a) => new Date(a.started_at).getTime());
		const earliest = new Date(Math.min(...dates));
		const latest = new Date(Math.max(...dates));
		return `${earliest.toLocaleDateString()} - ${latest.toLocaleDateString()}`;
	}

	function getTotalDuration(activities: NormalizedActivity[]): string {
		const totalSeconds = activities.reduce(
			(sum, a) => sum + a.duration_seconds,
			0,
		);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	// =========================================================================
	// Render
	// =========================================================================

	return (
		<Card className="border-border/50">
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center size-10 rounded-lg bg-[#5856D6]/10">
						<Dumbbell className="size-5 text-[#5856D6]" />
					</div>
					<div className="flex-1">
						<CardTitle className="text-base">Strong</CardTitle>
						<CardDescription>Import workouts via CSV export</CardDescription>
					</div>
					{isConnected && (
						<div className="flex items-center gap-2">
							<span className="text-xs text-[var(--color-forge-green)] flex items-center gap-1">
								<CheckCircle className="size-3" />
								Connected
							</span>
							{onDisconnect && (
								<Button variant="ghost" size="sm" onClick={onDisconnect}>
									Disconnect
								</Button>
							)}
						</div>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-muted-foreground">
					Export your workouts from Strong (Settings &rarr; Export Workout Data)
					and upload the CSV file.
				</p>

				{/* Weight Unit Selector */}
				<div className="space-y-2">
					<Label>Weight unit in your Strong app</Label>
					<div className="flex gap-2">
						<Button
							type="button"
							variant={weightUnit === "kg" ? "default" : "outline"}
							size="sm"
							onClick={() => setWeightUnit("kg")}
							className={
								weightUnit === "kg"
									? "bg-[#5856D6] hover:bg-[#5856D6]/90 text-white border-0"
									: ""
							}
						>
							kg
						</Button>
						<Button
							type="button"
							variant={weightUnit === "lbs" ? "default" : "outline"}
							size="sm"
							onClick={() => setWeightUnit("lbs")}
							className={
								weightUnit === "lbs"
									? "bg-[#5856D6] hover:bg-[#5856D6]/90 text-white border-0"
									: ""
							}
						>
							lbs
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						Strong exports weights in your app's unit setting. Select the unit
						your Strong app uses so we can store values correctly.
					</p>
				</div>

				{/* File Input */}
				<div className="space-y-2">
					<Label htmlFor="strong-csv">Select CSV File</Label>
					<Input
						ref={fileInputRef}
						id="strong-csv"
						type="file"
						accept=".csv"
						onChange={handleFileSelect}
						className="cursor-pointer"
					/>
				</div>

				{/* Import Preview */}
				{parsedActivities && parsedActivities.length > 0 && (
					<div className="rounded-lg border border-border/50 bg-card/50 p-4 space-y-3">
						<div className="flex items-center gap-2 text-sm font-medium">
							<FileText className="size-4 text-[var(--color-phoenix-primary)]" />
							Import Preview
							{csvFileName && (
								<span className="text-muted-foreground font-normal">
									({csvFileName})
								</span>
							)}
						</div>
						<div className="grid grid-cols-3 gap-3 text-sm">
							<div>
								<p className="text-muted-foreground text-xs">Workouts</p>
								<p className="font-semibold">{parsedActivities.length}</p>
							</div>
							<div>
								<p className="text-muted-foreground text-xs">Date Range</p>
								<p className="font-semibold text-xs">
									{getDateRange(parsedActivities)}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground text-xs">Total Duration</p>
								<p className="font-semibold">
									{getTotalDuration(parsedActivities)}
								</p>
							</div>
						</div>
						<div className="flex gap-2">
							<Button
								onClick={handleImport}
								disabled={isImporting}
								size="sm"
								className="bg-[#5856D6] hover:bg-[#5856D6]/90 text-white"
							>
								{isImporting
									? "Importing..."
									: `Import ${parsedActivities.length} Workouts`}
							</Button>
							<Button
								onClick={handleClearPreview}
								variant="outline"
								size="sm"
								disabled={isImporting}
							>
								Cancel
							</Button>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
