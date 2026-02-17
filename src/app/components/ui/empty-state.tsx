import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "./button";

interface EmptyStateProps {
	icon: LucideIcon;
	title: string;
	description: string;
	actionLabel?: string;
	actionHref?: string;
	onAction?: () => void;
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	actionLabel,
	actionHref,
	onAction,
}: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-16 text-center">
			<div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-6">
				<Icon className="w-8 h-8 text-muted-foreground" />
			</div>
			<h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
			<p className="text-sm text-muted-foreground mb-6 max-w-sm">
				{description}
			</p>
			{actionLabel &&
				(actionHref ? (
					<Button
						asChild
						className="bg-gradient-to-r from-primary to-chart-2 border-0"
					>
						<Link to={actionHref}>{actionLabel}</Link>
					</Button>
				) : onAction ? (
					<Button
						onClick={onAction}
						className="bg-gradient-to-r from-primary to-chart-2 border-0"
					>
						{actionLabel}
					</Button>
				) : null)}
		</div>
	);
}
