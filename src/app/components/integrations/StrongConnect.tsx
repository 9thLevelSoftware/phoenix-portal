import { useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle,
	Download,
	Dumbbell,
	FileText,
	Upload,
} from "lucide-react";
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
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import {
	downloadCSV,
	exportWorkoutsAsCSV,
} from "@/lib/integrations/export-csv";
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
 * Strong integration component with two paths:
 * 1. Import: Upload a Strong CSV export to bring workout history into Phoenix
 * 2. Export: Download Phoenix workouts as Strong-compatible CSV for import
 *    into Strong, Hevy, or any app that accepts the Strong CSV format
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
	const [rawCsv, setRawCsv] = useState<string | null>(null);
	const [importWeightUnit, setImportWeightUnit] = useState<"kg" | "lbs">("kg");
	const [importDistanceUnit, setImportDistanceUnit] = useState<"km" | "miles">(
		"km",
	);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// CSV export state
	const [isExporting, setIsExporting] = useState(false);
	const [exportWeightUnit, setExportWeightUnit] = useState<"kg" | "lbs">("kg");

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
					const activities = parseStrongCSV(
						csvContent,
						importWeightUnit,
						importDistanceUnit,
					);

					if (activities.length === 0) {
						toast.error(
							"No workouts found in CSV. Verify this is a Strong export file.",
						);
						setRawCsv(null);
						setParsedActivities(null);
						return;
					}

					// Keep the raw CSV so we can reparse if the user changes the unit.
					setRawCsv(csvContent);
					setParsedActivities(activities);
				} catch (_err) {
					toast.error(
						"Failed to parse CSV file. Make sure it is a valid Strong export.",
					);
					setRawCsv(null);
					setParsedActivities(null);
				}
			};
			reader.onerror = () => {
				toast.error("Failed to read file");
			};
			reader.readAsText(file);
		},
		[importWeightUnit, importDistanceUnit],
	);

	// Reparse the already-loaded CSV when the import unit changes, so the preview
	// and the imported values reflect the currently-selected unit.
	const handleImportUnitChange = useCallback(
		(unit: "kg" | "lbs") => {
			setImportWeightUnit(unit);
			if (!rawCsv) return;
			try {
				const activities = parseStrongCSV(rawCsv, unit);
				setParsedActivities(activities.length > 0 ? activities : null);
			} catch {
				setParsedActivities(null);
			}
		},
		[rawCsv],
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
			setRawCsv(null);
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
		setRawCsv(null);
		setCsvFileName(null);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	}, []);

	// =========================================================================
	// CSV Export Handler
	// =========================================================================

	const handleExport = useCallback(async () => {
		setIsExporting(true);
		try {
			const result = await exportWorkoutsAsCSV(userId, {
				weightUnit: exportWeightUnit,
			});

			if (result.sessionCount === 0) {
				toast.error("No workouts found to export");
				return;
			}

			const date = new Date().toISOString().slice(0, 10);
			downloadCSV(result.csv, `phoenix-workouts-${date}.csv`);
			toast.success(
				`Exported ${result.sessionCount} workouts (${result.setCount} sets)`,
			);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to export workouts",
			);
		} finally {
			setIsExporting(false);
		}
	}, [userId, exportWeightUnit]);

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
	// Shared UI: Weight Unit Toggle
	// =========================================================================

	function WeightUnitToggle({
		value,
		onChange,
		description,
	}: {
		value: "kg" | "lbs";
		onChange: (unit: "kg" | "lbs") => void;
		description: string;
	}) {
		return (
			<div className="space-y-2">
				<Label>Weight unit</Label>
				<div className="flex gap-2">
					<Button
						type="button"
						variant={value === "kg" ? "default" : "outline"}
						size="sm"
						onClick={() => onChange("kg")}
						className={
							value === "kg"
								? "bg-[#5856D6] hover:bg-[#5856D6]/90 text-white border-0"
								: ""
						}
					>
						kg
					</Button>
					<Button
						type="button"
						variant={value === "lbs" ? "default" : "outline"}
						size="sm"
						onClick={() => onChange("lbs")}
						className={
							value === "lbs"
								? "bg-[#5856D6] hover:bg-[#5856D6]/90 text-white border-0"
								: ""
						}
					>
						lbs
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
		);
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
					<div>
						<CardTitle className="text-base">Strong</CardTitle>
						<CardDescription>
							Import and export workouts via CSV
						</CardDescription>
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
			<CardContent>
				<Tabs defaultValue="export">
					<TabsList className="w-full">
						<TabsTrigger value="export">
							<Download className="size-3.5 mr-1.5" />
							Export
						</TabsTrigger>
						<TabsTrigger value="import">
							<Upload className="size-3.5 mr-1.5" />
							Import
						</TabsTrigger>
					</TabsList>

					{/* Export Tab */}
					<TabsContent value="export" className="space-y-4 mt-4">
						<p className="text-sm text-muted-foreground">
							Download your Phoenix workouts as a Strong-compatible CSV. This
							file can be imported into Strong, Hevy, or any app that accepts
							Strong CSV format.
						</p>

						<WeightUnitToggle
							value={exportWeightUnit}
							onChange={setExportWeightUnit}
							description="Choose the weight unit for the exported file. Select the unit your target app uses."
						/>

						<Button
							onClick={handleExport}
							disabled={isExporting}
							size="sm"
							className="bg-[#5856D6] hover:bg-[#5856D6]/90 text-white"
						>
							{isExporting ? (
								"Exporting..."
							) : (
								<>
									<Download className="size-3.5 mr-1.5" />
									Export All Workouts
								</>
							)}
						</Button>
					</TabsContent>

					{/* Import Tab */}
					<TabsContent value="import" className="space-y-4 mt-4">
						<p className="text-sm text-muted-foreground">
							Export your workouts from Strong (Settings &rarr; Export Workout
							Data) and upload the CSV file here.
						</p>

						<WeightUnitToggle
							value={importWeightUnit}
							onChange={handleImportUnitChange}
							description="Strong exports weights in your app's unit setting. Select the unit your Strong app uses so we can store values correctly."
						/>

						{/* Distance Unit Toggle */}
						<div className="space-y-2">
							<Label>Distance unit</Label>
							<div className="flex gap-2">
								<Button
									type="button"
									variant={importDistanceUnit === "km" ? "default" : "outline"}
									size="sm"
									onClick={() => setImportDistanceUnit("km")}
									className={
										importDistanceUnit === "km"
											? "bg-[#5856D6] hover:bg-[#5856D6]/90 text-white border-0"
											: ""
									}
								>
									km
								</Button>
								<Button
									type="button"
									variant={
										importDistanceUnit === "miles" ? "default" : "outline"
									}
									size="sm"
									onClick={() => setImportDistanceUnit("miles")}
									className={
										importDistanceUnit === "miles"
											? "bg-[#5856D6] hover:bg-[#5856D6]/90 text-white border-0"
											: ""
									}
								>
									miles
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">
								Strong exports distances in your app's unit setting. Select the
								unit your Strong app uses so cardio distances are stored
								correctly.
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
										<p className="text-muted-foreground text-xs">
											Total Duration
										</p>
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
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}
