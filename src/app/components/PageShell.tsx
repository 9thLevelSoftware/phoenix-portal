import { cn } from "@/app/components/ui/utils";

interface PageShellProps {
	children: React.ReactNode;
	className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
	return (
		<div
			className={cn("max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8", className)}
		>
			{children}
		</div>
	);
}
