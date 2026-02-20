import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";

interface SelectionModeBarProps {
	selectedCount: number;
	onCreateSuperset: () => void;
	onCancel: () => void;
}

export function SelectionModeBar({
	selectedCount,
	onCreateSuperset,
	onCancel,
}: SelectionModeBarProps) {
	return (
		<AnimatePresence>
			{selectedCount >= 2 && (
				<motion.div
					initial={{ y: 100, opacity: 0 }}
					animate={{ y: 0, opacity: 1 }}
					exit={{ y: 100, opacity: 0 }}
					transition={{ type: "spring", damping: 25, stiffness: 300 }}
					className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4"
				>
					<Card className="px-6 py-4 bg-gradient-to-br from-surface-2 to-background border-2 border-primary shadow-2xl">
						<div className="flex items-center gap-6">
							<div className="flex items-center gap-2 text-white">
								<Check className="w-5 h-5 text-success" />
								<span className="font-semibold">{selectedCount}</span>
								<span className="text-muted-foreground">
									exercises selected
								</span>
							</div>

							<div className="h-6 w-px bg-secondary" />

							<div className="flex items-center gap-3">
								<Button
									onClick={onCreateSuperset}
									className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
								>
									Create Superset
								</Button>

								<Button
									onClick={onCancel}
									variant="ghost"
									className="text-muted-foreground hover:text-white"
								>
									Cancel
								</Button>
							</div>
						</div>
					</Card>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
