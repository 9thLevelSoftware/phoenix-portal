import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ExternalActivityList } from "@/app/components/integrations/ExternalActivityList";
import { HevyConnect } from "@/app/components/integrations/HevyConnect";
import { MobileOnlyProvider } from "@/app/components/integrations/MobileOnlyProvider";
import { ProviderCard } from "@/app/components/integrations/ProviderCard";
import { SyncStatus } from "@/app/components/integrations/SyncStatus";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { useAuth } from "@/app/hooks/useAuth";
import { initiateFitbitConnect } from "@/lib/integrations/fitbit";
import { initiateGarminConnect } from "@/lib/integrations/garmin";
import { initiateStravaConnect } from "@/lib/integrations/strava";
import type {
	ExternalActivity,
	IntegrationProvider,
} from "@/lib/integrations/types";
import {
	useDisconnectIntegration,
	useManualSync,
} from "@/mutations/integrations";
import {
	externalActivitiesOptions,
	integrationsOptions,
} from "@/queries/integrations";

export function Integrations() {
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const [searchParams, setSearchParams] = useSearchParams();

	// Handle OAuth callback URL params (?connected=provider or ?error=type)
	useEffect(() => {
		const connected = searchParams.get("connected");
		const error = searchParams.get("error");

		if (connected) {
			toast.success(`Successfully connected ${connected}`);
			// Clean up URL params
			setSearchParams({}, { replace: true });
		}
		if (error) {
			toast.error(`Connection failed: ${error}`);
			setSearchParams({}, { replace: true });
		}
	}, [searchParams.get, setSearchParams]); // Run on mount only

	const { data: integrations, isLoading } = useQuery({
		...integrationsOptions(userId),
		enabled: !!userId,
	});
	const { data: activities } = useQuery({
		...externalActivitiesOptions(userId),
		enabled: !!userId,
	});

	const disconnectMutation = useDisconnectIntegration();
	const syncMutation = useManualSync();

	// Helper to find a user's integration by provider
	const getIntegration = (provider: IntegrationProvider) =>
		integrations?.find((i) => i.provider === provider) ?? null;

	return (
		<SubscriptionGate requiredTier="ELITE">
			<div className="container mx-auto p-6 space-y-8">
				<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
					<div>
						<h1 className="text-3xl font-bold">Integrations</h1>
						<p className="text-muted-foreground">
							Connect your fitness services to see all your data in one place
						</p>
					</div>
					<div className="w-full md:w-80 shrink-0">
						<SyncStatus userId={userId} />
					</div>
				</div>

				{/* OAuth Providers */}
				<section>
					<h2 className="text-xl font-semibold mb-4">Fitness Services</h2>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						<ProviderCard
							provider="strava"
							integration={getIntegration("strava")}
							onConnect={() => initiateStravaConnect(userId)}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "strava" })
							}
							onSync={() => syncMutation.mutate({ userId, provider: "strava" })}
							isLoading={disconnectMutation.isPending || syncMutation.isPending}
						/>
						<ProviderCard
							provider="fitbit"
							integration={getIntegration("fitbit")}
							onConnect={() => initiateFitbitConnect(userId)}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "fitbit" })
							}
							onSync={() => syncMutation.mutate({ userId, provider: "fitbit" })}
							isLoading={disconnectMutation.isPending || syncMutation.isPending}
						/>
						<ProviderCard
							provider="garmin"
							integration={getIntegration("garmin")}
							onConnect={() => initiateGarminConnect(userId)}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "garmin" })
							}
							onSync={() => syncMutation.mutate({ userId, provider: "garmin" })}
							isLoading={disconnectMutation.isPending || syncMutation.isPending}
						/>
						{/* HevyConnect from 07-03 - handles both API and CSV import */}
						<HevyConnect
							userId={userId}
							isConnected={getIntegration("hevy")?.status === "connected"}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "hevy" })
							}
						/>
					</div>
				</section>

				{/* Mobile-Only Providers */}
				<section>
					<h2 className="text-xl font-semibold mb-4">Mobile Health Apps</h2>
					<div className="grid gap-4 md:grid-cols-2">
						<MobileOnlyProvider
							provider="apple_health"
							integration={getIntegration("apple_health")}
						/>
						<MobileOnlyProvider
							provider="google_health"
							integration={getIntegration("google_health")}
						/>
					</div>
				</section>

				{/* External Activities */}
				<section>
					<h2 className="text-xl font-semibold mb-4">Synced Activities</h2>
					<ExternalActivityList
						activities={(activities as ExternalActivity[]) ?? []}
					/>
				</section>
			</div>
		</SubscriptionGate>
	);
}
