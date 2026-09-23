import { Activity, Dumbbell, RefreshCw, Watch } from "lucide-react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import {
	type IntegrationProvider,
	PROVIDER_METADATA,
	type UserIntegration,
} from "@/lib/integrations/types";

// Map PROVIDER_METADATA icon string to actual lucide component
const ICON_MAP: Record<string, typeof Activity> = {
	Activity,
	Watch,
	Dumbbell,
};

interface ProviderCardProps {
	provider: IntegrationProvider;
	integration: UserIntegration | null;
	onConnect: () => void;
	onDisconnect: () => void;
	onSync: () => void;
	isLoading?: boolean;
	supportsManualSync?: boolean;
	syncHint?: string;
	comingSoon?: boolean;
}

function formatRelative(dateStr: string | null): string {
	if (!dateStr) return "Never";
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMin = Math.floor(diffMs / 60000);
	const diffHr = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMin < 1) return "Just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHr < 24) return `${diffHr}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}

export function ProviderCard({
	provider,
	integration,
	onConnect,
	onDisconnect,
	onSync,
	isLoading,
	supportsManualSync = true,
	syncHint,
	comingSoon,
}: ProviderCardProps) {
	const meta = PROVIDER_METADATA[provider];
	const Icon = ICON_MAP[meta.icon] ?? Activity;

	// A lapsed connection is distinct from never having connected. `token_expired`
	// means the provider revoked or aged out our grant; `error` means syncing hit
	// a failure the sync function could not recover from. Both need a reconnect
	// prompt rather than the first-run Connect button.
	const isTokenExpired = integration?.status === "token_expired";
	const needsAttention = isTokenExpired || integration?.status === "error";

	return (
		<Card className="border-border/50">
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center size-10 rounded-lg bg-[var(--color-phoenix-primary)]/10">
						<Icon className="size-5 text-[var(--color-phoenix-primary)]" />
					</div>
					<div className="flex-1">
						<div className="flex items-center gap-2">
							<CardTitle className="text-base">{meta.name}</CardTitle>
							{comingSoon && (
								<Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
									Coming Soon
								</Badge>
							)}
						</div>
						<CardDescription>{meta.description}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{integration?.status === "connected" ? (
					<div className="space-y-4">
						<Badge className="bg-[var(--color-forge-green)]/20 text-[var(--color-forge-green)] border-transparent">
							Connected
						</Badge>
						<p className="text-sm text-muted-foreground">
							Last synced: {formatRelative(integration.last_sync_at)}
						</p>
						{integration.error_message && (
							<Alert variant="destructive">
								<AlertDescription>{integration.error_message}</AlertDescription>
							</Alert>
						)}
						{!supportsManualSync && syncHint && (
							<p className="text-sm text-muted-foreground">{syncHint}</p>
						)}
						<div className="flex gap-2">
							{supportsManualSync && (
								<Button onClick={onSync} size="sm" disabled={isLoading}>
									<RefreshCw
										className={`size-4 ${isLoading ? "animate-spin" : ""}`}
									/>
									Sync Now
								</Button>
							)}
							<Button onClick={onDisconnect} variant="outline" size="sm">
								Disconnect
							</Button>
						</div>
					</div>
				) : needsAttention ? (
					// token_expired / error are NOT the same as "never connected": the
					// user granted access and it has since lapsed. Rendering a bare
					// Connect button here left them with no indication anything had
					// broken, and no way to clear the stale connection.
					<div className="space-y-4">
						<Badge
							className={
								isTokenExpired
									? "bg-amber-500/20 text-amber-400 border-amber-500/30"
									: "bg-destructive/20 text-destructive border-destructive/30"
							}
						>
							{isTokenExpired ? "Reconnection needed" : "Sync error"}
						</Badge>
						<Alert variant="destructive">
							<AlertDescription>
								{integration?.error_message ??
									(isTokenExpired
										? `Your ${meta.name} authorization has expired. Reconnect to resume syncing.`
										: `${meta.name} syncing stopped after an error. Reconnect to try again.`)}
							</AlertDescription>
						</Alert>
						<p className="text-sm text-muted-foreground">
							Last synced: {formatRelative(integration?.last_sync_at ?? null)}
						</p>
						<div className="flex gap-2">
							<Button onClick={onConnect} size="sm" disabled={isLoading}>
								Reconnect {meta.name}
							</Button>
							<Button onClick={onDisconnect} variant="outline" size="sm">
								Disconnect
							</Button>
						</div>
					</div>
				) : comingSoon ? (
					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							Awaiting developer program approval
						</p>
						<Button disabled>Connect {meta.name}</Button>
					</div>
				) : (
					<Button onClick={onConnect} disabled={isLoading}>
						Connect {meta.name}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
