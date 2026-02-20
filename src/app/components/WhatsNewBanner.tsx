import { Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";

interface WhatsNewBannerProps {
	onDismiss: () => void;
}

const newFeatures = [
	"Goals & Tracking - Set weekly and monthly training targets",
	"Recovery Dashboard - Monitor training load and recovery trends",
	"Community Comments - Discuss workouts and routines with others",
	"Workout Comparison - Compare sessions side by side",
];

/**
 * Dismissible banner shown to returning users (v1.0 mobile users or web users
 * who haven't seen the v1.1 update). Appears between Navigation and page content.
 */
export function WhatsNewBanner({ onDismiss }: WhatsNewBannerProps) {
	const [visible, setVisible] = useState(true);

	function handleDismiss() {
		setVisible(false);
		// Wait for exit animation to complete before persisting
		setTimeout(() => onDismiss(), 300);
	}

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{ duration: 0.3, ease: "easeInOut" }}
					className="overflow-hidden"
				>
					<div className="mx-4 mt-4 mb-2 rounded-lg border border-[#FF6B35]/30 bg-gradient-to-r from-[#FF6B35]/10 via-[#DC2626]/10 to-[#F59E0B]/10 p-4">
						<div className="flex items-start justify-between gap-4">
							<div className="flex items-start gap-3">
								<Sparkles className="size-5 shrink-0 text-[#F59E0B] mt-0.5" />
								<div>
									<h3 className="text-sm font-semibold text-white mb-2">
										What's New in v1.1
									</h3>
									<ul className="space-y-1">
										{newFeatures.map((feature) => (
											<li
												key={feature}
												className="text-xs text-[#9CA3AF] flex items-baseline gap-2"
											>
												<span className="text-[#FF6B35]">-</span>
												{feature}
											</li>
										))}
									</ul>
								</div>
							</div>
							<Button
								variant="ghost"
								size="icon"
								className="shrink-0 size-7 text-[#9CA3AF] hover:text-white"
								onClick={handleDismiss}
								aria-label="Dismiss what's new banner"
							>
								<X className="size-4" />
							</Button>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
