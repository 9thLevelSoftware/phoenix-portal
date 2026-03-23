import type React from "react";
import { Card } from "@/app/components/ui/card";

export function MobileChartCard({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary active:scale-[0.98] transition-transform">
			<h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
			{children}
		</Card>
	);
}
