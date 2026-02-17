import {
	AlertCircle,
	CheckCircle2,
	Clock,
	RefreshCw,
	Smartphone,
} from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";

interface SyncStatusProps {
	lastSync?: string;
	status?: "synced" | "syncing" | "pending" | "error";
}

export function SyncStatus({
	lastSync = "2 minutes ago",
	status = "synced",
}: SyncStatusProps) {
	const getStatusConfig = () => {
		switch (status) {
			case "synced":
				return {
					icon: CheckCircle2,
					color: "text-success",
					bgColor: "bg-success/10",
					borderColor: "border-success/30",
					label: "Synced",
				};
			case "syncing":
				return {
					icon: RefreshCw,
					color: "text-accent",
					bgColor: "bg-accent/10",
					borderColor: "border-accent/30",
					label: "Syncing...",
					animate: true,
				};
			case "pending":
				return {
					icon: Clock,
					color: "text-muted",
					bgColor: "bg-muted/10",
					borderColor: "border-muted/30",
					label: "Pending",
				};
			case "error":
				return {
					icon: AlertCircle,
					color: "text-destructive",
					bgColor: "bg-destructive/10",
					borderColor: "border-destructive/30",
					label: "Sync Error",
				};
			default:
				return {
					icon: CheckCircle2,
					color: "text-success",
					bgColor: "bg-success/10",
					borderColor: "border-success/30",
					label: "Synced",
				};
		}
	};

	const config = getStatusConfig();
	const StatusIcon = config.icon;

	return (
		<Card className={`p-4 border ${config.borderColor} ${config.bgColor}`}>
			<div className="flex items-center gap-3">
				<div
					className={`w-10 h-10 rounded-lg bg-background flex items-center justify-center ${config.color}`}
				>
					<Smartphone className="w-5 h-5" />
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<span className="text-white text-sm font-medium">
							Project Phoenix Mobile
						</span>
						<Badge
							className={`${config.bgColor} ${config.color} border-0 text-xs`}
						>
							<StatusIcon
								className={`w-3 h-3 mr-1 ${config.animate ? "animate-spin" : ""}`}
							/>
							{config.label}
						</Badge>
					</div>
					<p className="text-xs text-muted-foreground">
						<span className="text-muted">App → Portal</span> • Last sync:{" "}
						{lastSync}
					</p>
				</div>
			</div>
		</Card>
	);
}
