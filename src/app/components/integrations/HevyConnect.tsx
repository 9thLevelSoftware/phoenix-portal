import {
	AlertCircle,
	CheckCircle,
	Dumbbell,
	FileText,
	Key,
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
import { parseHevyCSV } from "@/lib/integrations/hevy";
import type { NormalizedActivity } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";

interface HevyConnectProps {
	userId: string;
	isConnected?: boolean;
	onDisconnect?: () => void;
}

/**
 * Hevy connection component with dual path:
 * 1. API key connection (requires Hevy PRO subscription)
 * 2. CSV import (available to all users)
 */
export function HevyConnect({
	userId,
	isConnected,
	onDisconnect,
}: HevyConnectProps) {
	// API key state
	const [apiKey, setApiKey] = useState("");
	const [isSavingKey, setIsSavingKey] = useState(false);
	const [isTesting, setIsTesting] = useState(false);

	// CSV import state
	const [parsedActivities, setParsedActivities] = useState<
		NormalizedActivity[] | null
	>(null);
	const [isImporting, setIsImporting] = useState(false);
	const [csvFileName, setCsvFileName] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// =========================================================================
	// API Key Handlers
	// =========================================================================

	const handleSaveApiKey = useCallback(async () => {
		if (!apiKey.trim()) {
			toast.error("Please enter your Hevy API key");
			return;
		}

		setIsSavingKey(true);
		try {
			const { error } = await supabase.functions.invoke("hevy-sync", {
				body: { user_id: userId, api_key: apiKey.trim() },
			});

			if (error) throw error;

			toast.success("Hevy API key saved and initial sync started");
			setApiKey("");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to save API key",
			);
		} finally {
			setIsSavingKey(false);
		}
	}, [userId, apiKey]);

	const handleTestConnection = useCallback(async () => {
		setIsTesting(true);
		try {
			const { data, error } = await supabase.functions.invoke("hevy-sync", {
				body: { user_id: userId, sync_type: "manual" },
			});

			if (error) throw error;

			if (data?.requires_pro) {
				toast.error("Hevy PRO subscription required for API access");
			} else if (data?.success) {
				toast.success(`Connection verified. ${data.imported} workouts synced.`);
			} else {
				toast.info("Connection test completed");
			}
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Connection test failed",
			);
		} finally {
			setIsTesting(false);
		}
	}, [userId]);

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
					const activities = parseHevyCSV(csvContent);

					if (activities.length === 0) {
						toast.error(
							"No workouts found in CSV. Verify this is a Hevy export file.",
						);
						setParsedActivities(null);
						return;
					}

					setParsedActivities(activities);
				} catch (_err) {
					toast.error(
						"Failed to parse CSV file. Make sure it is a valid Hevy export.",
					);
					setParsedActivities(null);
				}
			};
			reader.onerror = () => {
				toast.error("Failed to read file");
			};
			reader.readAsText(file);
		},
		[],
	);

	const handleImport = useCallback(async () => {
		if (!parsedActivities || parsedActivities.length === 0) return;

		setIsImporting(true);
		try {
			// Insert all activities to external_activities via upsert
			const rows = parsedActivities.map((a) => ({
				user_id: userId,
				external_id: a.external_id,
				provider: "hevy",
				name: a.name,
				activity_type: a.activity_type,
				started_at: a.started_at,
				duration_seconds: a.duration_seconds,
				distance_meters: a.distance_meters,
				calories: a.calories,
				avg_heart_rate: a.avg_heart_rate,
				max_heart_rate: a.max_heart_rate,
				elevation_gain_meters: a.elevation_gain_meters,
			}));

			const { error } = await supabase
				.from("external_activities")
				.upsert(rows, { onConflict: "user_id,provider,external_id" });

			if (error) throw error;

			toast.success(`Imported ${parsedActivities.length} workouts from Hevy`);
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
	}, [userId, parsedActivities]);

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
					<div className="flex items-center justify-center size-10 rounded-lg bg-[#2563EB]/10">
						<Dumbbell className="size-5 text-[#2563EB]" />
					</div>
					<div className="flex-1">
						<CardTitle className="text-base">Hevy</CardTitle>
						<CardDescription>Import strength training workouts</CardDescription>
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
				<Tabs defaultValue="csv">
					<TabsList className="w-full">
						<TabsTrigger value="csv" className="flex-1">
							<Upload className="size-3.5 mr-1.5" />
							CSV Import
						</TabsTrigger>
						<TabsTrigger value="api" className="flex-1">
							<Key className="size-3.5 mr-1.5" />
							API (PRO)
						</TabsTrigger>
					</TabsList>

					{/* CSV Import Tab */}
					<TabsContent value="csv" className="space-y-4 mt-4">
						<p className="text-sm text-muted-foreground">
							Export your workouts from Hevy (Settings &rarr; Export Data) and
							upload the CSV file.
						</p>

						<div className="space-y-2">
							<Label htmlFor="hevy-csv">Select CSV File</Label>
							<Input
								ref={fileInputRef}
								id="hevy-csv"
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
										className="bg-[var(--color-phoenix-primary)] hover:bg-[var(--color-phoenix-primary)]/90 text-white"
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

					{/* API Tab */}
					<TabsContent value="api" className="space-y-4 mt-4">
						<div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
							<AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
							<p className="text-muted-foreground">
								Requires{" "}
								<span className="font-medium text-amber-500">Hevy PRO</span>{" "}
								subscription. Generate an API key in Hevy Settings &rarr; API.
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="hevy-api-key">API Key</Label>
							<Input
								id="hevy-api-key"
								type="password"
								placeholder="Enter your Hevy API key"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
							/>
						</div>

						<div className="flex gap-2">
							<Button
								onClick={handleSaveApiKey}
								disabled={isSavingKey || !apiKey.trim()}
								size="sm"
							>
								{isSavingKey ? "Saving..." : "Save & Sync"}
							</Button>
							{isConnected && (
								<Button
									onClick={handleTestConnection}
									disabled={isTesting}
									variant="outline"
									size="sm"
								>
									{isTesting ? "Testing..." : "Test Connection"}
								</Button>
							)}
						</div>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}
