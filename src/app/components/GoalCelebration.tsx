import { Award, Target, TrendingUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Card } from "@/app/components/ui/card";

interface GoalCelebrationProps {
	isOpen: boolean;
	onClose: () => void;
	goalData: {
		goalType: "frequency" | "volume" | "pr";
		description: string;
		achievedValue: string;
	};
}

const goalIcons = {
	frequency: Target,
	volume: TrendingUp,
	pr: Award,
};

export function GoalCelebration({
	isOpen,
	onClose,
	goalData,
}: GoalCelebrationProps) {
	const [phase, setPhase] = useState(0);

	useEffect(() => {
		if (!isOpen) {
			setPhase(0);
			return;
		}

		const timers = [
			setTimeout(() => setPhase(1), 300),
			setTimeout(() => setPhase(2), 1500),
			setTimeout(() => setPhase(3), 2000),
			setTimeout(() => setPhase(4), 3000),
		];

		return () => timers.forEach(clearTimeout);
	}, [isOpen]);

	const handleDismiss = () => {
		setPhase(0);
		onClose();
	};

	const Icon = goalIcons[goalData.goalType];

	return (
		<AnimatePresence>
			{isOpen && (
				<>
					{/* Dark Overlay */}
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						onClick={handleDismiss}
						className="fixed inset-0 bg-background/95 z-[100] backdrop-blur-sm"
						style={{
							background:
								"radial-gradient(circle at center, rgba(255, 107, 53, 0.1) 0%, rgba(13, 13, 13, 0.95) 70%)",
						}}
					/>

					{/* Particle Burst */}
					<AnimatePresence>
						{phase >= 2 && phase < 3 && <GoalParticleBurst />}
					</AnimatePresence>

					{/* Goal Card */}
					<AnimatePresence>
						{phase >= 3 && (
							<motion.div
								initial={{ scale: 0.8, opacity: 0 }}
								animate={{ scale: 1, opacity: 1 }}
								exit={{ scale: 0.8, opacity: 0 }}
								transition={{ type: "spring", duration: 0.5 }}
								className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[102] w-full max-w-md px-4"
								onClick={handleDismiss}
							>
								<Card className="relative p-8 bg-gradient-to-br from-surface-2 to-background border-2 border-primary overflow-hidden">
									{/* Animated gradient border */}
									<motion.div
										className="absolute inset-0 opacity-50"
										style={{
											background:
												"linear-gradient(90deg, #FF6B35, #DC2626, #F59E0B, #FF6B35)",
											backgroundSize: "200% 100%",
										}}
										animate={{
											backgroundPosition: ["0% 0%", "200% 0%"],
										}}
										transition={{
											duration: 2,
											repeat: Infinity,
											ease: "linear",
										}}
									/>

									{/* Pulse glow */}
									<motion.div
										className="absolute inset-0 bg-primary/20 blur-xl"
										animate={{
											opacity: [0.3, 0.6, 0.3],
											scale: [1, 1.05, 1],
										}}
										transition={{
											duration: 2,
											repeat: Infinity,
											ease: "easeInOut",
										}}
									/>

									<div className="relative z-10 text-center">
										<div className="flex items-center justify-center mb-4">
											<Icon className="w-12 h-12 text-accent" />
										</div>

										<h2 className="text-2xl font-bold mb-4 text-white">
											GOAL ACHIEVED!
										</h2>

										<p className="text-lg text-white mb-2">
											{goalData.description}
										</p>

										<motion.div
											className="text-3xl font-bold text-accent mb-6"
											animate={{ scale: [1, 1.1, 1] }}
											transition={{ duration: 0.5, delay: 0.2 }}
										>
											{goalData.achievedValue}
										</motion.div>

										<p className="text-xs text-muted mt-4">
											Tap anywhere to continue
										</p>
									</div>
								</Card>
							</motion.div>
						)}
					</AnimatePresence>
				</>
			)}
		</AnimatePresence>
	);
}

function GoalParticleBurst() {
	const particles = Array.from({ length: 60 });
	const colors = [
		"rgba(255, 107, 53, 0.8)",
		"rgba(220, 38, 38, 0.7)",
		"rgba(245, 158, 11, 0.9)",
	];

	return (
		<div className="fixed inset-0 z-[101] pointer-events-none">
			{particles.map((_, i) => {
				const angle = (Math.PI * 2 * i) / particles.length;
				const distance = 200 + Math.random() * 150;
				const x = Math.cos(angle) * distance;
				const y = Math.sin(angle) * distance;

				return (
					<motion.div
						key={i}
						className="absolute w-2 h-2 rounded-full"
						style={{
							left: "50%",
							top: "50%",
							backgroundColor:
								colors[Math.floor(Math.random() * colors.length)],
							boxShadow: `0 0 10px ${colors[Math.floor(Math.random() * colors.length)]}`,
						}}
						initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
						animate={{
							x,
							y,
							opacity: 0,
							scale: 0,
						}}
						transition={{
							duration: 1 + Math.random() * 0.5,
							ease: "easeOut",
						}}
					/>
				);
			})}
		</div>
	);
}
