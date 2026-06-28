import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ExternalActivityList } from "@/app/components/integrations/ExternalActivityList";
import { HevyConnect } from "@/app/components/integrations/HevyConnect";
import { LiftosaurConnect } from "@/app/components/integrations/LiftosaurConnect";
import { MobileOnlyProvider } from "@/app/components/integrations/MobileOnlyProvider";
import { ProviderCard } from "@/app/components/integrations/ProviderCard";
import { StrongConnect } from "@/app/components/integrations/StrongConnect";
import { SyncStatus } from "@/app/components/integrations/SyncStatus";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { initiateFitbitConnect } from "@/lib/integrations/fitbit";
import { initiateGarminConnect } from "@/lib/integrations/garmin";
import { initiateStravaConnect } from "@/lib/integrations/strava";
import type {
	ExternalActivity,
	IntegrationProvider,
	UserIntegration,
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
	const { user, session, loading: authLoading } = useAuth();
	const { isPremium } = useSubscription();
	const userId = user?.id ?? "";
	const accessToken = session?.access_token ?? "";
	// Provider connect/sync/disconnect actions all require an authenticated user
	// and a valid access token; treat their absence as "auth not ready".
	const isAuthReady = !!userId && !!accessToken;
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
	}, [searchParams, setSearchParams]);

	const { data: integrations } = useQuery({
		...integrationsOptions(userId),
		enabled: isPremium && !!userId,
	});
	const { data: activities } = useQuery({
		...externalActivitiesOptions(userId),
		enabled: isPremium && !!userId,
	});

	const disconnectMutation = useDisconnectIntegration();
	const syncMutation = useManualSync();

	// Helper to find a user's integration by provider
	const getIntegration = (
		provider: IntegrationProvider,
	): UserIntegration | null => {
		const match = integrations?.find((i) => i.provider === provider);
		return match ? (match as UserIntegration) : null;
	};

	const handleConnectError = (providerName: string, err: unknown) => {
		toast.error(
			err instanceof Error
				? err.message
				: `Failed to connect ${providerName}. Please try again.`,
		);
	};

	if (authLoading || !isAuthReady) {
		return (
			<SubscriptionGate requiredTier="FLAME">
				<div className="container mx-auto p-6">
					<div className="flex flex-col items-center justify-center py-24 text-center">
						<div className="w-10 h-10 rounded-full border-2 border-secondary border-t-primary animate-spin mb-4" />
						<p className="text-sm text-muted-foreground">
							Preparing your integrations...
						</p>
					</div>
				</div>
			</SubscriptionGate>
		);
	}

	return (
		<SubscriptionGate requiredTier="FLAME">
			<div className="container mx-auto p-6 space-y-8">
				<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
					<div>
						<h1 className="text-display-2">Integrations</h1>
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
							onConnect={async () => {
								try {
									await initiateStravaConnect(accessToken);
								} catch (err) {
									handleConnectError("Strava", err);
								}
							}}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "strava" })
							}
							onSync={() => syncMutation.mutate({ userId, provider: "strava" })}
							isLoading={disconnectMutation.isPending || syncMutation.isPending}
						/>
						<ProviderCard
							provider="fitbit"
							integration={getIntegration("fitbit")}
							onConnect={async () => {
								try {
									await initiateFitbitConnect(accessToken);
								} catch (err) {
									handleConnectError("Fitbit", err);
								}
							}}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "fitbit" })
							}
							onSync={() => syncMutation.mutate({ userId, provider: "fitbit" })}
							isLoading={disconnectMutation.isPending || syncMutation.isPending}
							comingSoon
						/>
						<ProviderCard
							provider="garmin"
							integration={getIntegration("garmin")}
							onConnect={async () => {
								try {
									await initiateGarminConnect(accessToken);
								} catch (err) {
									handleConnectError("Garmin", err);
								}
							}}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "garmin" })
							}
							onSync={() => syncMutation.mutate({ userId, provider: "garmin" })}
							isLoading={disconnectMutation.isPending || syncMutation.isPending}
							supportsManualSync={false}
							syncHint="Garmin sync is webhook-driven. New activities appear automatically after Garmin pushes them."
							comingSoon
						/>
						{/* HevyConnect from 07-03 - handles both API and CSV import */}
						<HevyConnect
							userId={userId}
							isConnected={getIntegration("hevy")?.status === "connected"}
							onDisconnect={() =>
								disconnectMutation.mutate({ userId, provider: "hevy" })
							}
						/>
						<LiftosaurConnect
							userId={userId}
							isConnected={getIntegration("liftosaur")?.status === "connected"}
							onDisconnect={() =>
								disconnectMutation.mutate({
									userId,
									provider: "liftosaur",
								})
							}
						/>
						<StrongConnect
							userId={userId}
							isConnected={getIntegration("strong")?.status === "connected"}
							onDisconnect={() =>
								disconnectMutation.mutate({
									userId,
									provider: "strong",
								})
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
