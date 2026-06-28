import { MotionConfig, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { getConsentStatus, setConsentStatus } from "@/lib/consent";

export function CookieConsentBanner() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		// Storage access can throw in privacy modes / embedded contexts. When the
		// read fails, default to showing the banner rather than crashing.
		let status: string | null = null;
		try {
			status = getConsentStatus();
		} catch {
			status = null;
		}
		if (status === null) {
			setVisible(true);
		}
	}, []);

	if (!visible) {
		return null;
	}

	const handleAccept = () => {
		// Persist best-effort; even if storage is blocked, honor the in-memory
		// choice and initialize Sentry for this session.
		try {
			setConsentStatus("accepted");
		} catch {
			// ignore persistence failure
		}
		import("@/lib/sentry").then(({ initSentry }) => initSentry());
		setVisible(false);
	};

	const handleReject = () => {
		try {
			setConsentStatus("rejected");
		} catch {
			// ignore persistence failure
		}
		setVisible(false);
	};

	return (
		<MotionConfig reducedMotion="user">
			<motion.div
				initial={{ y: 100, opacity: 0 }}
				animate={{ y: 0, opacity: 1 }}
				transition={{ duration: 0.4, ease: "easeOut" }}
				className="fixed bottom-0 left-0 right-0 z-50 border-t border-secondary bg-[#1a1a1a] p-4"
			>
				<div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
					<p className="text-sm text-secondary-foreground text-center sm:text-left">
						We use <span className="font-semibold text-white">Sentry</span> for
						error tracking to improve app reliability. No personal workout data
						is collected. See our{" "}
						<Link
							to="/privacy"
							className="text-primary hover:text-accent underline"
						>
							Privacy Policy
						</Link>{" "}
						for details.
					</p>
					<div className="flex gap-3 shrink-0">
						<Button
							variant="outline"
							onClick={handleReject}
							className="min-w-[100px] border-secondary text-white"
						>
							Reject
						</Button>
						<Button
							variant="outline"
							onClick={handleAccept}
							className="min-w-[100px] border-primary text-primary"
						>
							Accept
						</Button>
					</div>
				</div>
			</motion.div>
		</MotionConfig>
	);
}
