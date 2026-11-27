import { useQuery } from "@tanstack/react-query";
import { Plus, Share2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { EndpointCard } from "@/app/components/profile/data-sharing/EndpointCard";
import {
	EndpointFormDialog,
	type EndpointFormSubmission,
} from "@/app/components/profile/data-sharing/EndpointFormDialog";
import {
	type RevealedSecret,
	SecretRevealDialog,
} from "@/app/components/profile/data-sharing/SecretRevealDialog";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { MAX_WEBHOOK_ENDPOINTS, type WebhookEndpoint } from "@/lib/dataSharing";
import { TIER_LEVEL } from "@/lib/subscription-entitlement";
import { FEATURE_MIN_TIER } from "@/lib/tierMatrix";
import {
	useCreateWebhookEndpoint,
	useUpdateWebhookEndpoint,
} from "@/mutations/dataSharing";
import { webhookEndpointsOptions } from "@/queries/dataSharing";

type FormState = { endpoint: WebhookEndpoint | null } | null;

/**
 * Profile > Settings > Data Sharing. Lives on a route with no tier gate on
 * purpose: someone whose plan lapsed must still be able to see where their
 * data was going and pause or delete it. Adding, editing and switching an
 * endpoint on need Flame, here for the buttons and on the server for real.
 */
export function DataSharingSection() {
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const subscription = useSubscription();
	const {
		data: endpoints,
		isLoading,
		isError,
		refetch,
	} = useQuery(webhookEndpointsOptions(userId));

	const [form, setForm] = useState<FormState>(null);
	const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
	const create = useCreateWebhookEndpoint(userId);
	const update = useUpdateWebhookEndpoint(userId);

	// A billing outage is not "no plan": it disables changes without telling a
	// paying user to upgrade.
	const billingUnavailable = subscription.isError;
	const tierKnown = !subscription.isLoading && !billingUnavailable;
	const canManage =
		tierKnown &&
		TIER_LEVEL[subscription.tier] >= TIER_LEVEL[FEATURE_MIN_TIER.dataSharing];
	const needsUpgrade = tierKnown && !canManage;
	const count = endpoints?.length ?? 0;
	const atLimit = count >= MAX_WEBHOOK_ENDPOINTS;

	const handleSubmit = (values: EndpointFormSubmission) => {
		const editing = form?.endpoint ?? null;
		if (!editing) {
			create.mutate(
				{
					label: values.label,
					url: values.url,
					scopes: values.scopes,
					...(values.customHeader ? { customHeader: values.customHeader } : {}),
				},
				{
					onSuccess: (result) => {
						setForm(null);
						setRevealed({
							endpointLabel: result.endpoint.label,
							signingSecret: result.signingSecret,
							rotated: false,
						});
					},
				},
			);
			return;
		}
		update.mutate(
			{
				endpointId: editing.id,
				label: values.label,
				scopes: values.scopes,
				// Only when it changed: a new URL is re-validated and resolved.
				...(values.url !== editing.url ? { url: values.url } : {}),
				...(values.customHeader !== undefined
					? { customHeader: values.customHeader }
					: {}),
			},
			{
				onSuccess: () => {
					setForm(null);
					toast.success("Endpoint updated");
				},
			},
		);
	};

	return (
		<Card className="bg-surface-2 border-secondary" data-testid="data-sharing">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-foreground">
					<Share2 className="h-5 w-5 text-primary" />
					Data Sharing
				</CardTitle>
				<CardDescription>
					Send your own training data to an HTTPS endpoint you control, as
					signed webhook events. Only you can set this up, and each endpoint
					receives only your data.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{needsUpgrade && (
					<div
						className="rounded-md bg-warning/10 p-3 text-sm text-foreground"
						data-testid="data-sharing-upgrade"
					>
						Data sharing is part of Flame.{" "}
						<Link to="/pricing" className="text-primary underline">
							See plans
						</Link>
						{count > 0
							? " Your endpoints are listed below so you can pause or delete them; nothing is sent while your plan does not include data sharing."
							: ""}
					</div>
				)}
				{billingUnavailable && (
					<div className="rounded-md bg-warning/10 p-3 text-sm text-foreground">
						Billing status is unavailable, so changes are switched off for the
						moment. You can still pause or delete an endpoint.{" "}
						<button
							type="button"
							className="text-primary underline"
							onClick={() => void subscription.refetch()}
						>
							Retry
						</button>
					</div>
				)}

				{isLoading ? (
					<Skeleton className="h-24 w-full" />
				) : isError ? (
					<div className="space-y-2">
						<p className="text-sm text-destructive">
							Couldn't load your endpoints.
						</p>
						<Button
							variant="outline"
							size="sm"
							className="border-secondary"
							onClick={() => void refetch()}
						>
							Try again
						</Button>
					</div>
				) : count === 0 ? (
					<p className="text-sm text-muted-foreground">
						No endpoints yet. Add one to start receiving your workouts, records,
						routines and more as they change.
					</p>
				) : (
					<div className="space-y-3">
						{endpoints?.map((endpoint) => (
							<EndpointCard
								key={endpoint.id}
								userId={userId}
								endpoint={endpoint}
								canManage={canManage}
								onEdit={(target) => setForm({ endpoint: target })}
								onSecret={(target, signingSecret) =>
									setRevealed({
										endpointLabel: target.label,
										signingSecret,
										rotated: true,
									})
								}
							/>
						))}
					</div>
				)}

				<div className="flex flex-wrap items-center gap-3">
					<Button
						onClick={() => setForm({ endpoint: null })}
						disabled={!canManage || atLimit || isLoading || isError}
					>
						<Plus className="size-4" />
						Add endpoint
					</Button>
					<p className="text-xs text-muted-foreground">
						{atLimit
							? `You have the maximum of ${MAX_WEBHOOK_ENDPOINTS} endpoints.`
							: `Up to ${MAX_WEBHOOK_ENDPOINTS} endpoints.`}
					</p>
				</div>

				<p className="border-t border-secondary pt-4 text-xs text-muted-foreground">
					Loads are sent per cable, as on the phone. Raw force-curve telemetry,
					advanced biomechanics data and activities imported from Strava are
					never shared this way. The complete download above is unaffected.
				</p>
			</CardContent>

			<EndpointFormDialog
				open={form !== null}
				endpoint={form?.endpoint ?? null}
				isSaving={create.isPending || update.isPending}
				onSubmit={handleSubmit}
				onClose={() => setForm(null)}
			/>
			<SecretRevealDialog secret={revealed} onClose={() => setRevealed(null)} />
		</Card>
	);
}
