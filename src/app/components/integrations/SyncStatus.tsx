import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import {
	type SyncQueueActiveCount,
	syncQueueActiveCountOptions,
	syncQueueOptions,
} from "@/queries/integrations";

interface SyncStatusProps {
	userId: string;
}

const STATUS_BADGE_CLASS: Record<string, string> = {
	completed: "bg-success/20 text-success border-success/30",
	failed: "bg-destructive/20 text-destructive border-destructive/30",
	processing: "bg-warning/20 text-warning border-warning/30",
	pending:
		"bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30",
	superseded: "bg-muted/40 text-muted-foreground border-muted",
};

const ACTIVE_POLL_MS = 15_000;

function hasActiveWork(snapshot: SyncQueueActiveCount | undefined): boolean {
	return (snapshot?.pending ?? 0) > 0 || snapshot?.processingProvider != null;
}

export function SyncStatus({ userId }: SyncStatusProps) {
	const active = useQuery({
		...syncQueueActiveCountOptions(userId),
		refetchInterval: (query) =>
			hasActiveWork(query.state.data) ? ACTIVE_POLL_MS : false,
	});

	const hasWork = hasActiveWork(active.data);
	const { data: queue, isError: activityError } = useQuery({
		...syncQueueOptions(userId),
		// Refresh the activity list while status-filtered work is still open.
		refetchInterval: hasWork ? ACTIVE_POLL_MS : false,
	});

	const countFailed = active.isError;
	const pending = active.data?.pending ?? 0;
	const processingProvider = active.data?.processingProvider ?? null;
	const showAllSynced =
		!countFailed &&
		active.isSuccess &&
		pending === 0 &&
		processingProvider == null;

	return (
		<Card className="bg-surface-2 border-secondary">
			<CardHeader className="pb-3">
				<CardTitle className="text-lg">Sync Status</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{(countFailed || activityError) && (
						<div className="flex items-center gap-2 text-sm text-destructive">
							<AlertCircle className="h-4 w-4" />
							<span>Couldn't load sync status. Please try again.</span>
						</div>
					)}

					{!countFailed && processingProvider && (
						<div className="flex items-center gap-2 text-sm">
							<Loader2 className="h-4 w-4 animate-spin text-warning" />
							<span className="capitalize">
								Syncing {processingProvider}...
							</span>
						</div>
					)}

					{!countFailed && pending > 0 && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Clock className="h-4 w-4" />
							<span>{pending} sync(s) pending</span>
						</div>
					)}

					{showAllSynced && (
						<div className="flex items-center gap-2 text-sm text-success">
							<CheckCircle className="h-4 w-4" />
							<span>All synced</span>
						</div>
					)}

					{!activityError && queue && queue.length > 0 && (
						<div className="border-t border-secondary pt-4 mt-4">
							<h4 className="text-sm font-medium mb-2">Recent Activity</h4>
							<div className="space-y-2">
								{queue.map((item) => (
									<div
										key={item.id}
										className="flex justify-between items-center text-xs"
									>
										<span className="capitalize">{item.provider}</span>
										<Badge
											variant="outline"
											className={
												(item.status
													? STATUS_BADGE_CLASS[item.status]
													: undefined) ?? ""
											}
										>
											{item.status}
										</Badge>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
