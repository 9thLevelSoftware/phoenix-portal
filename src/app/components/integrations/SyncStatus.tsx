import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { supabase } from "@/lib/supabase";

interface SyncStatusProps {
	userId: string;
}

const STATUS_BADGE_CLASS: Record<string, string> = {
	completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
	failed: "bg-red-500/20 text-red-400 border-red-500/30",
	processing: "bg-amber-500/20 text-amber-400 border-amber-500/30",
	pending: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

export function SyncStatus({ userId }: SyncStatusProps) {
	const { data: queue } = useQuery({
		queryKey: ["sync-queue", userId],
		queryFn: async () => {
			const { data } = await supabase
				.from("sync_queue")
				.select("*")
				.eq("user_id", userId)
				.order("created_at", { ascending: false })
				.limit(10);
			return data ?? [];
		},
		enabled: !!userId,
		refetchInterval: 15_000, // Poll every 15s while visible
	});

	const pending = queue?.filter((q) => q.status === "pending").length ?? 0;
	const processing = queue?.find((q) => q.status === "processing");

	return (
		<Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
			<CardHeader className="pb-3">
				<CardTitle className="text-lg">Sync Status</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{processing && (
						<div className="flex items-center gap-2 text-sm">
							<Loader2 className="h-4 w-4 animate-spin text-amber-400" />
							<span className="capitalize">
								Syncing {processing.provider}...
							</span>
						</div>
					)}

					{pending > 0 && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Clock className="h-4 w-4" />
							<span>{pending} sync(s) pending</span>
						</div>
					)}

					{!processing && pending === 0 && (
						<div className="flex items-center gap-2 text-sm text-emerald-400">
							<CheckCircle className="h-4 w-4" />
							<span>All synced</span>
						</div>
					)}

					{/* Recent activity */}
					{queue && queue.length > 0 && (
						<div className="border-t border-[#374151] pt-4 mt-4">
							<h4 className="text-sm font-medium mb-2">Recent Activity</h4>
							<div className="space-y-2">
								{queue.slice(0, 5).map((item) => (
									<div
										key={item.id}
										className="flex justify-between items-center text-xs"
									>
										<span className="capitalize">{item.provider}</span>
										<Badge
											variant="outline"
											className={STATUS_BADGE_CLASS[item.status] ?? ""}
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
