import { Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

export function PortalBanner() {
	const [dismissed, setDismissed] = useState(false);

	return (
		<AnimatePresence>
			{!dismissed && (
				<motion.div
					key="portal-banner"
					initial={{ opacity: 0, y: -10 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -10 }}
					className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/30 rounded-lg p-3 mb-6"
				>
					<div className="flex items-start gap-3">
						<Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
						<div className="flex-1">
							<p className="text-sm text-secondary-foreground">
								<span className="font-semibold text-primary">
									Phoenix Portal
								</span>{" "}
								displays workout data synced from your mobile app. Create and
								share routines that sync back to your Vitruvian trainer.
							</p>
						</div>
						<button
							type="button"
							onClick={() => setDismissed(true)}
							aria-label="Dismiss banner"
							className="text-muted-foreground hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-primary rounded"
						>
							<X className="w-4 h-4" aria-hidden="true" />
						</button>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
