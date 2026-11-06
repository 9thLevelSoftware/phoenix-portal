import { useQuery } from "@tanstack/react-query";
import { formatRelative } from "@/app/components/integrations/formatRelative";
import { Badge } from "@/app/components/ui/badge";
import { Skeleton } from "@/app/components/ui/skeleton";
import { describeDeliveryError } from "@/lib/dataSharing";
import {
	WEBHOOK_DELIVERY_LOG_LIMIT,
	type WebhookDelivery,
	webhookDeliveriesOptions,
} from "@/queries/dataSharing";

const STATUS_LABEL: Record<WebhookDelivery["status"], string> = {
	pending: "Waiting",
	delivering: "Sending",
	delivered: "Delivered",
	dead: "Failed",
	skipped: "Not sent",
};

const STATUS_CLASS: Record<WebhookDelivery["status"], string> = {
	pending: "bg-secondary/40 text-foreground",
	delivering: "bg-secondary/40 text-foreground",
	delivered: "bg-success/20 text-success",
	dead: "bg-destructive/20 text-destructive",
	skipped: "bg-muted/30 text-muted-foreground",
};

/** What a delivery was about: the resolved event, or the item while it waits. */
function deliverySubject(delivery: WebhookDelivery): string {
	return delivery.event_type ?? delivery.entity.replaceAll("_", " ");
}

function deliveryDetail(delivery: WebhookDelivery): string | null {
	if (delivery.status === "pending" && delivery.attempt_count > 0) {
		// A retry is scheduled: say what went wrong last time and when it retries.
		const reason = describeDeliveryError(
			delivery.last_error_code,
			delivery.last_status_code,
		);
		const when = new Date(delivery.next_attempt_at).toLocaleString();
		return `${reason ?? "Last attempt failed"}. Retrying at ${when}.`;
	}
	if (delivery.status === "delivered") {
		return delivery.duration_ms === null
			? null
			: `${delivery.last_status_code ?? ""} in ${delivery.duration_ms} ms`.trim();
	}
	return describeDeliveryError(
		delivery.last_error_code,
		delivery.last_status_code,
	);
}

interface DeliveryLogProps {
	userId: string;
	endpointId: string;
}

/** The endpoint's latest deliveries, read directly under owner RLS. */
export function DeliveryLog({ userId, endpointId }: DeliveryLogProps) {
	const { data, isLoading, isError } = useQuery(
		webhookDeliveriesOptions(userId, endpointId),
	);

	if (isLoading) return <Skeleton className="h-16 w-full" />;
	if (isError) {
		return (
			<p className="text-sm text-destructive">
				Couldn't load the delivery log. Try again in a moment.
			</p>
		);
	}
	if (!data?.length) {
		return (
			<p className="text-sm text-muted-foreground">
				No deliveries yet. They appear here within a minute or two of a change.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			<ul className="divide-y divide-secondary rounded-md border border-secondary">
				{data.map((delivery) => {
					const detail = deliveryDetail(delivery);
					return (
						<li
							key={delivery.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
						>
							<Badge
								className={`border-transparent ${STATUS_CLASS[delivery.status]}`}
							>
								{STATUS_LABEL[delivery.status]}
							</Badge>
							<span className="font-mono text-xs text-foreground">
								{deliverySubject(delivery)}
							</span>
							<span className="text-xs text-muted-foreground">
								{formatRelative(delivery.created_at)}
								{delivery.attempt_count > 1
									? ` · attempt ${delivery.attempt_count}`
									: ""}
							</span>
							{detail && (
								<span className="w-full text-xs text-muted-foreground">
									{detail}
								</span>
							)}
						</li>
					);
				})}
			</ul>
			<p className="text-xs text-muted-foreground">
				Showing the latest {WEBHOOK_DELIVERY_LOG_LIMIT}. The log keeps 30 days.
			</p>
		</div>
	);
}
