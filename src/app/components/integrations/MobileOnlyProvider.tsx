import { Smartphone } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import type {
	IntegrationProvider,
	UserIntegration,
} from "@/lib/integrations/types";

interface MobileOnlyProviderProps {
	provider: Extract<IntegrationProvider, "apple_health" | "google_health">;
	integration: UserIntegration | null;
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

export function MobileOnlyProvider({
	provider,
	integration,
}: MobileOnlyProviderProps) {
	const isApple = provider === "apple_health";
	const name = isApple ? "Apple Health" : "Google Health Connect";

	return (
		<Card className="border-border/50">
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center size-10 rounded-lg bg-muted/50">
						<Smartphone className="size-5 text-muted-foreground" />
					</div>
					<div>
						<CardTitle className="text-base">{name}</CardTitle>
						<CardDescription>Synced via Phoenix mobile app</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{integration?.status === "connected" ? (
						<>
							<Badge className="bg-[var(--color-forge-green)]/20 text-[var(--color-forge-green)] border-transparent">
								Synced from mobile
							</Badge>
							<p className="text-sm text-muted-foreground">
								Last sync: {formatRelative(integration?.last_sync_at ?? null)}
							</p>
						</>
					) : (
						<div className="bg-muted/50 rounded-lg p-4">
							<h4 className="font-medium mb-2">How to connect</h4>
							{isApple ? (
								<ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
									<li>Open Phoenix app on your iPhone</li>
									<li>Go to Settings &rarr; Integrations</li>
									<li>Tap &ldquo;Connect Apple Health&rdquo;</li>
									<li>Grant permissions when prompted</li>
									<li>Data will sync automatically to this portal</li>
								</ol>
							) : (
								<ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
									<li>Open Phoenix app on your Android device</li>
									<li>Go to Settings &rarr; Integrations</li>
									<li>Tap &ldquo;Connect Health Connect&rdquo;</li>
									<li>Grant permissions when prompted</li>
									<li>Data will sync automatically to this portal</li>
								</ol>
							)}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
