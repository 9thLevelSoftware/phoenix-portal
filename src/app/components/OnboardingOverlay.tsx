import {
	BarChart3,
	Flame,
	LayoutDashboard,
	Rocket,
	Trophy,
	Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";

interface OnboardingOverlayProps {
	onComplete: () => void;
}

const steps = [
	{
		title: "Welcome to Phoenix Portal",
		description:
			"Your companion dashboard for tracking, analyzing, and sharing your Vitruvian training journey. Everything you need to train smarter is right here.",
		features: [
			{
				icon: BarChart3,
				label: "Deep Analytics",
				detail: "Force curves, velocity trends, muscle balance",
			},
			{
				icon: Users,
				label: "Community",
				detail: "Share routines, vote on workouts",
			},
			{
				icon: Trophy,
				label: "Session Replay",
				detail: "Relive every set with detailed telemetry",
			},
		],
	},
	{
		title: "Your Training Dashboard",
		description:
			"All your training data from the Vitruvian app syncs here automatically. Explore your progress and discover insights.",
		features: [
			{
				icon: LayoutDashboard,
				label: "Workout History",
				detail: "Every session with full exercise detail",
			},
			{
				icon: Trophy,
				label: "Personal Records",
				detail: "Track PRs across all exercises",
			},
			{
				icon: BarChart3,
				label: "Analytics Charts",
				detail: "Volume, frequency, and trend analysis",
			},
		],
	},
	{
		title: "Ready to Rise",
		description:
			"Your Phoenix journey begins now. Explore your dashboard, check out the community, and see what your training data reveals.",
		features: [],
	},
];

/**
 * 3-step onboarding Dialog overlay for brand-new users.
 * Uses Radix Dialog (modal) with AnimatePresence for step transitions.
 * Each step is skippable. Completion persists via completeOnboarding mutation.
 */
export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
	const [currentStep, setCurrentStep] = useState(0);
	const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward

	const isLastStep = currentStep === steps.length - 1;
	const step = steps[currentStep];

	function handleNext() {
		if (isLastStep) {
			onComplete();
		} else {
			setDirection(1);
			setCurrentStep((prev) => prev + 1);
		}
	}

	function handleSkip() {
		onComplete();
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onComplete()}>
			<DialogContent className="sm:max-w-md border-primary/30 bg-surface-2 overflow-hidden">
				<AnimatePresence mode="wait" custom={direction}>
					<motion.div
						key={currentStep}
						custom={direction}
						initial={{ x: direction * 100, opacity: 0 }}
						animate={{ x: 0, opacity: 1 }}
						exit={{ x: direction * -100, opacity: 0 }}
						transition={{ duration: 0.25, ease: "easeInOut" }}
					>
						<DialogHeader>
							{currentStep === 0 && (
								<div className="flex justify-center mb-4">
									<motion.div
										className="relative"
										animate={{
											filter: [
												"brightness(1)",
												"brightness(1.3)",
												"brightness(1)",
											],
										}}
										transition={{
											duration: 2,
											repeat: Number.POSITIVE_INFINITY,
											ease: "easeInOut",
										}}
									>
										<Flame className="size-16 text-primary" />
									</motion.div>
								</div>
							)}
							{currentStep === 2 && (
								<div className="flex justify-center mb-4">
									<Rocket className="size-16 text-accent" />
								</div>
							)}
							<DialogTitle className="text-xl text-center text-white">
								{step.title}
							</DialogTitle>
							<DialogDescription className="text-center text-muted-foreground">
								{step.description}
							</DialogDescription>
						</DialogHeader>

						{step.features.length > 0 && (
							<div className="grid gap-3 py-4">
								{step.features.map((feature) => (
									<div
										key={feature.label}
										className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
									>
										<feature.icon className="size-5 shrink-0 text-primary mt-0.5" />
										<div>
											<p className="text-sm font-medium text-white">
												{feature.label}
											</p>
											<p className="text-xs text-muted-foreground">
												{feature.detail}
											</p>
										</div>
									</div>
								))}
							</div>
						)}
					</motion.div>
				</AnimatePresence>

				<DialogFooter className="flex-row items-center justify-between sm:justify-between">
					{/* Progress dots */}
					<div className="flex gap-1.5">
						{steps.map((_, i) => (
							<button
								key={`step-dot-${i}`}
								type="button"
								aria-label={`Go to step ${i + 1}`}
								onClick={() => {
									setDirection(i > currentStep ? 1 : -1);
									setCurrentStep(i);
								}}
								className={`size-2 rounded-full transition-colors cursor-pointer hover:scale-150 ${
									i === currentStep
										? "bg-primary"
										: i < currentStep
											? "bg-primary/50"
											: "bg-white/20"
								}`}
							/>
						))}
					</div>

					<div className="flex gap-2">
						{!isLastStep && (
							<Button variant="ghost" size="sm" onClick={handleSkip}>
								Skip
							</Button>
						)}
						<Button size="sm" onClick={handleNext}>
							{isLastStep ? "Go to Dashboard" : "Next"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
