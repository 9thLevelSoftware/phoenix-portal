import { Activity, Dumbbell, Smartphone, Watch } from "lucide-react";
import { useMemo, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/app/components/ui/table";
import type {
	ExternalActivity,
	IntegrationProvider,
} from "@/lib/integrations/types";

const PROVIDER_ICON: Record<IntegrationProvider, typeof Activity> = {
	strava: Activity,
	fitbit: Watch,
	garmin: Watch,
	hevy: Dumbbell,
	liftosaur: Dumbbell,
	strong: Dumbbell,
	apple_health: Smartphone,
	google_health: Smartphone,
};

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
	strava: "Strava",
	fitbit: "Fitbit",
	garmin: "Garmin",
	hevy: "Hevy",
	liftosaur: "Liftosaur",
	strong: "Strong",
	apple_health: "Apple Health",
	google_health: "Health Connect",
};

function formatDuration(seconds: number): string {
	const hrs = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	if (hrs > 0) return `${hrs}h ${mins}m`;
	return `${mins}m`;
}

function formatDistance(meters: number | null): string {
	if (meters == null) return "-";
	if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
	return `${Math.round(meters)} m`;
}

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

interface ExternalActivityListProps {
	activities: ExternalActivity[];
}

export function ExternalActivityList({
	activities,
}: ExternalActivityListProps) {
	const [providerFilter, setProviderFilter] = useState<string>("all");

	// Get unique providers for filter dropdown
	const providers = useMemo(() => {
		const set = new Set(activities.map((a) => a.provider));
		return Array.from(set).sort();
	}, [activities]);

	// Filter and sort activities
	const filtered = useMemo(() => {
		let result = activities;
		if (providerFilter !== "all") {
			result = result.filter((a) => a.provider === providerFilter);
		}
		// Sort by date descending (most recent first)
		return [...result].sort(
			(a, b) =>
				new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
		);
	}, [activities, providerFilter]);

	if (activities.length === 0) {
		return (
			<div className="text-center py-12 text-muted-foreground">
				<Activity className="size-12 mx-auto mb-3 opacity-30" />
				<p className="text-sm">No synced activities yet.</p>
				<p className="text-xs mt-1">
					Connect a provider above to start syncing activities.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Filter bar */}
			<div className="flex items-center gap-3">
				<Select value={providerFilter} onValueChange={setProviderFilter}>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="All providers" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All providers</SelectItem>
						{providers.map((p) => (
							<SelectItem key={p} value={p}>
								{PROVIDER_LABEL[p as IntegrationProvider] ?? p}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-sm text-muted-foreground">
					{filtered.length} {filtered.length === 1 ? "activity" : "activities"}
				</span>
			</div>

			{/* Activity table */}
			<div className="rounded-md border border-border/50">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Provider</TableHead>
							<TableHead>Type</TableHead>
							<TableHead className="text-right">Duration</TableHead>
							<TableHead className="text-right">Distance</TableHead>
							<TableHead className="text-right">Calories</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map((activity) => {
							const ProviderIcon = PROVIDER_ICON[activity.provider] ?? Activity;
							return (
								<TableRow key={activity.id}>
									<TableCell className="text-muted-foreground text-sm">
										{formatDate(activity.started_at)}
									</TableCell>
									<TableCell className="font-medium">{activity.name}</TableCell>
									<TableCell>
										<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
											<ProviderIcon className="size-3.5" />
											{PROVIDER_LABEL[activity.provider]}
										</div>
									</TableCell>
									<TableCell className="capitalize text-sm">
										{activity.activity_type}
									</TableCell>
									<TableCell className="text-right text-sm">
										{formatDuration(activity.duration_seconds)}
									</TableCell>
									<TableCell className="text-right text-sm">
										{formatDistance(activity.distance_meters)}
									</TableCell>
									<TableCell className="text-right text-sm">
										{activity.calories != null
											? `${activity.calories} kcal`
											: "-"}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
