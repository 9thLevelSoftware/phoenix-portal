import { zodResolver } from "@hookform/resolvers/zod";
import {
	Activity,
	Apple,
	ArrowRight,
	BarChart3,
	Chrome,
	ExternalLink,
	Flame,
	Loader2,
	Mail,
	Play,
	Share2,
	Target,
	Trophy,
} from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useAuth } from "@/app/hooks/useAuth";
import { breathing, tap } from "@/lib/animations";
import { TIER_PRICING } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
import { EmberParticles } from "./EmberParticles";
import { PhoenixLogo } from "./PhoenixLogo";

// Validation schemas
const signInSchema = z.object({
	email: z.string().min(1, "Email is required").email("Invalid email address"),
	password: z.string().min(1, "Password is required"),
});

const signUpSchema = z
	.object({
		email: z
			.string()
			.min(1, "Email is required")
			.email("Invalid email address"),
		password: z.string().min(6, "Password must be at least 6 characters"),
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type SignInFormData = z.infer<typeof signInSchema>;
type SignUpFormData = z.infer<typeof signUpSchema>;

const TIER_BADGE_STYLES: Record<string, string> = {
	PHOENIX: "bg-primary/20 text-primary border-primary/30",
	ELITE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

export function LandingPage() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	const [showAuthDialog, setShowAuthDialog] = useState(false);
	const [authLoading, setAuthLoading] = useState(false);
	const [showForgotPassword, setShowForgotPassword] = useState(false);
	const [resetEmail, setResetEmail] = useState("");
	const [scrolled, setScrolled] = useState(false);

	// Scroll parallax for hero content
	const { scrollY } = useScroll();
	const heroY = useTransform(scrollY, [0, 500], [0, -80]);
	const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);

	// Redirect authenticated users to dashboard
	useEffect(() => {
		if (!loading && user) {
			navigate("/dashboard", { replace: true });
		}
	}, [user, loading, navigate]);

	// Track scroll for sticky nav
	useEffect(() => {
		const handleScroll = () => setScrolled(window.scrollY > 20);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	const handleResetPassword = async () => {
		if (!resetEmail) {
			toast.error("Please enter your email address");
			return;
		}
		setAuthLoading(true);
		try {
			const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
				redirectTo: `${window.location.origin}/auth/reset-password`,
			});
			if (error) {
				toast.error(error.message);
			} else {
				toast.success("Password reset link sent. Check your email.");
				setShowForgotPassword(false);
				setResetEmail("");
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setAuthLoading(false);
		}
	};

	const signInForm = useForm<SignInFormData>({
		resolver: zodResolver(signInSchema),
		defaultValues: { email: "", password: "" },
	});

	const signUpForm = useForm<SignUpFormData>({
		resolver: zodResolver(signUpSchema),
		defaultValues: { email: "", password: "", confirmPassword: "" },
	});

	const handleSignIn = async (data: SignInFormData) => {
		setAuthLoading(true);
		try {
			const { error } = await supabase.auth.signInWithPassword({
				email: data.email,
				password: data.password,
			});
			if (error) {
				toast.error(error.message);
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setAuthLoading(false);
		}
	};

	const handleSignUp = async (data: SignUpFormData) => {
		setAuthLoading(true);
		try {
			const { error } = await supabase.auth.signUp({
				email: data.email,
				password: data.password,
			});
			if (error) {
				toast.error(error.message);
			} else {
				toast.success(
					"Account created! Check your email for a confirmation link.",
				);
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setAuthLoading(false);
		}
	};

	const handleOAuthSignIn = async (provider: "google" | "apple") => {
		setAuthLoading(true);
		try {
			const { error } = await supabase.auth.signInWithOAuth({
				provider,
				options: { redirectTo: window.location.origin },
			});
			if (error) {
				toast.error(error.message);
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setAuthLoading(false);
		}
	};

	const openAuth = () => setShowAuthDialog(true);

	const scrollToSection = (id: string) => {
		document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
	};

	const features = [
		{
			icon: Share2,
			title: "Community Hub",
			badge: "EMBER",
			description:
				"Share routines, vote on workouts, follow featured creators, and discover proven programs from the Vitruvian community.",
		},
		{
			icon: Trophy,
			title: "Challenges & Leaderboards",
			badge: "EMBER",
			description:
				"Compete in community challenges, climb leaderboards, and earn badges. See how you stack up against other Vitruvian athletes.",
		},
		{
			icon: Activity,
			title: "Force Curve Analysis",
			badge: "INFERNO",
			description:
				"Visualize concentric and eccentric force output with LTTB-downsampled curves. See exactly where you're strongest — and where you stall.",
		},
		{
			icon: BarChart3,
			title: "VBT & Power Analytics",
			badge: "INFERNO",
			description:
				"Velocity-based training zones classify every rep into strength, power, or speed. Track power output and ROM trends over time.",
		},
		{
			icon: Target,
			title: "Asymmetry Detection",
			badge: "INFERNO",
			description:
				"L/R force threshold flagging catches muscle imbalances before they become injuries. Full biomechanics dashboard with muscle heatmap.",
		},
		{
			icon: Play,
			title: "Session Replay",
			badge: "INFERNO",
			description:
				"Relive every workout with Canvas 2D telemetry playback at 50Hz. Scrub through sets, analyze rep quality, and detect fatigue.",
		},
	];

	const pricingTiers = TIER_PRICING.map((t) => ({
		name: t.name,
		price: t.monthlyPrice,
		period: "per month",
		features: t.features,
		cta: t.comingSoon ? "Coming Soon" : "Rise Now",
		highlight: t.tier === "EMBER",
		comingSoon: t.comingSoon,
	}));

	// Auth dialog using Radix Dialog for accessibility (focus trap, ARIA, keyboard nav)
	const authDialog = (
		<Dialog
			open={showAuthDialog}
			onOpenChange={(open) => {
				setShowAuthDialog(open);
				if (!open) {
					signInForm.reset();
					signUpForm.reset();
					setAuthLoading(false);
					setShowForgotPassword(false);
					setResetEmail("");
				}
			}}
		>
			<DialogContent className="bg-surface-2/80 backdrop-blur-xl border border-primary/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),0_0_40px_rgba(0,0,0,0.6)] max-w-md p-6">
				<DialogTitle className="sr-only">Sign in to Phoenix Portal</DialogTitle>
				<DialogDescription className="sr-only">
					Enter your credentials to access the dashboard
				</DialogDescription>

				<div className="flex items-center justify-center gap-2 mb-6">
					<span className="text-xl text-primary font-semibold">
						Phoenix Portal
					</span>
				</div>

				{showForgotPassword ? (
					<div className="space-y-4">
						<div className="text-center mb-4">
							<h3 className="text-lg font-semibold text-white mb-1">
								Reset your password
							</h3>
							<p className="text-sm text-muted-foreground">
								Enter your email and we will send you a reset link
							</p>
						</div>
						<div className="space-y-2">
							<Label
								htmlFor="reset-email"
								className="text-secondary-foreground"
							>
								Email
							</Label>
							<Input
								id="reset-email"
								type="email"
								placeholder="you@example.com"
								value={resetEmail}
								onChange={(e) => setResetEmail(e.target.value)}
								className="bg-background border-secondary text-white placeholder:text-muted"
							/>
						</div>
						<Button
							type="button"
							disabled={authLoading}
							onClick={handleResetPassword}
							className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
						>
							{authLoading ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : (
								<Mail className="w-4 h-4 mr-2" />
							)}
							Send Reset Link
						</Button>
						<button
							type="button"
							onClick={() => {
								setShowForgotPassword(false);
								setResetEmail("");
							}}
							className="w-full text-sm text-muted-foreground hover:text-white transition-colors"
						>
							Back to sign in
						</button>
					</div>
				) : (
					<Tabs defaultValue="signin" className="w-full">
						<TabsList className="w-full mb-4">
							<TabsTrigger value="signin" className="flex-1">
								Sign In
							</TabsTrigger>
							<TabsTrigger value="signup" className="flex-1">
								Sign Up
							</TabsTrigger>
						</TabsList>

						<TabsContent value="signin">
							<form
								onSubmit={signInForm.handleSubmit(handleSignIn)}
								className="space-y-4"
							>
								<div className="space-y-2">
									<Label
										htmlFor="signin-email"
										className="text-secondary-foreground"
									>
										Email
									</Label>
									<Input
										id="signin-email"
										type="email"
										placeholder="you@example.com"
										className="bg-background border-secondary text-white placeholder:text-muted"
										{...signInForm.register("email")}
									/>
									{signInForm.formState.errors.email && (
										<p className="text-sm text-red-400">
											{signInForm.formState.errors.email.message}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label
										htmlFor="signin-password"
										className="text-secondary-foreground"
									>
										Password
									</Label>
									<Input
										id="signin-password"
										type="password"
										placeholder="Enter your password"
										className="bg-background border-secondary text-white placeholder:text-muted"
										{...signInForm.register("password")}
									/>
									{signInForm.formState.errors.password && (
										<p className="text-sm text-red-400">
											{signInForm.formState.errors.password.message}
										</p>
									)}
								</div>
								<div className="flex justify-end">
									<button
										type="button"
										onClick={() => setShowForgotPassword(true)}
										className="text-sm text-primary hover:text-accent transition-colors"
									>
										Forgot password?
									</button>
								</div>
								<Button
									type="submit"
									disabled={authLoading}
									className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
								>
									{authLoading ? (
										<Loader2 className="w-4 h-4 animate-spin mr-2" />
									) : (
										<Mail className="w-4 h-4 mr-2" />
									)}
									Sign In
								</Button>
							</form>
						</TabsContent>

						<TabsContent value="signup">
							<form
								onSubmit={signUpForm.handleSubmit(handleSignUp)}
								className="space-y-4"
							>
								<div className="space-y-2">
									<Label
										htmlFor="signup-email"
										className="text-secondary-foreground"
									>
										Email
									</Label>
									<Input
										id="signup-email"
										type="email"
										placeholder="you@example.com"
										className="bg-background border-secondary text-white placeholder:text-muted"
										{...signUpForm.register("email")}
									/>
									{signUpForm.formState.errors.email && (
										<p className="text-sm text-red-400">
											{signUpForm.formState.errors.email.message}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label
										htmlFor="signup-password"
										className="text-secondary-foreground"
									>
										Password
									</Label>
									<Input
										id="signup-password"
										type="password"
										placeholder="At least 6 characters"
										className="bg-background border-secondary text-white placeholder:text-muted"
										{...signUpForm.register("password")}
									/>
									{signUpForm.formState.errors.password && (
										<p className="text-sm text-red-400">
											{signUpForm.formState.errors.password.message}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label
										htmlFor="signup-confirm"
										className="text-secondary-foreground"
									>
										Confirm Password
									</Label>
									<Input
										id="signup-confirm"
										type="password"
										placeholder="Confirm your password"
										className="bg-background border-secondary text-white placeholder:text-muted"
										{...signUpForm.register("confirmPassword")}
									/>
									{signUpForm.formState.errors.confirmPassword && (
										<p className="text-sm text-red-400">
											{signUpForm.formState.errors.confirmPassword.message}
										</p>
									)}
								</div>
								<Button
									type="submit"
									disabled={authLoading}
									className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
								>
									{authLoading ? (
										<Loader2 className="w-4 h-4 animate-spin mr-2" />
									) : (
										<Mail className="w-4 h-4 mr-2" />
									)}
									Create Account
								</Button>
							</form>
						</TabsContent>

						{/* OAuth divider */}
						<div className="relative my-6">
							<div className="absolute inset-0 flex items-center">
								<div className="w-full border-t border-secondary" />
							</div>
							<div className="relative flex justify-center text-sm">
								<span className="bg-surface-2 px-2 text-muted">
									or continue with
								</span>
							</div>
						</div>

						{/* OAuth buttons */}
						<div className="flex flex-col gap-3">
							<Button
								type="button"
								variant="outline"
								disabled={authLoading}
								onClick={() => handleOAuthSignIn("google")}
								className="w-full border-secondary text-secondary-foreground hover:bg-secondary/50 hover:text-white"
							>
								<Chrome className="w-4 h-4 mr-2" />
								Continue with Google
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={authLoading}
								onClick={() => handleOAuthSignIn("apple")}
								className="w-full border-secondary text-secondary-foreground hover:bg-secondary/50 hover:text-white"
							>
								<Apple className="w-4 h-4 mr-2" />
								Continue with Apple
							</Button>
						</div>
					</Tabs>
				)}
			</DialogContent>
		</Dialog>
	);

	return (
		<div className="min-h-screen bg-background text-white overflow-x-hidden">
			<EmberParticles />

			{authDialog}

			{/* Sticky Nav Header */}
			<nav
				className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
					scrolled
						? "bg-background/80 backdrop-blur-lg border-b border-secondary/50"
						: "bg-transparent"
				}`}
			>
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
					<div className="flex items-center gap-2">
						<PhoenixLogo size="sm" animated={false} />
						<span className="text-lg font-semibold text-primary">
							Phoenix Portal
						</span>
					</div>
					<div className="hidden sm:flex items-center gap-6">
						<button
							type="button"
							onClick={() => scrollToSection("features")}
							className="text-sm text-muted-foreground hover:text-white transition-colors"
						>
							Features
						</button>
						<button
							type="button"
							onClick={() => scrollToSection("pricing")}
							className="text-sm text-muted-foreground hover:text-white transition-colors"
						>
							Pricing
						</button>
						<a
							href="https://ko-fi.com/vitruvianredux"
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm text-muted-foreground hover:text-white transition-colors"
						>
							Support
						</a>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={openAuth}
						className="border-primary/50 text-primary hover:bg-primary/10"
					>
						Sign In
					</Button>
				</div>
			</nav>

			{/* Hero Section */}
			<section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
				{/* Phoenix hero background */}
				<div className="absolute inset-0 overflow-hidden">
					<img
						src="/phoenix-hero.png"
						alt=""
						className="absolute inset-0 w-full h-full object-cover opacity-30"
					/>
					<div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
				</div>

				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.8 }}
					style={{ y: heroY, opacity: heroOpacity }}
					className="text-center z-10 flex flex-col items-center"
				>
					

					<motion.h1
						className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.2 }}
					>
						<span className="block bg-gradient-to-r from-primary via-chart-2 to-accent bg-clip-text text-transparent">
							Your workouts, unlocked.
						</span>
					</motion.h1>

					<motion.p
						className="mt-6 text-xl sm:text-2xl md:text-3xl text-secondary-foreground"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.4 }}
					>
						Rise From the Ashes. Forge Your Strength.
					</motion.p>

					<motion.p
						className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.6 }}
					>
						Phoenix Portal turns your Vitruvian Force data into force curves,
						biomechanics insights, recovery readiness scores, and a community of
						athletes — all synced from the Project Phoenix app.
					</motion.p>

					<motion.div
						className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.8 }}
					>
						<motion.div whileTap={tap.press} className="inline-flex">
							<Button
								size="lg"
								onClick={openAuth}
								className="relative group bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 transition-all duration-300"
							>
								<span className="relative z-10 flex items-center gap-2">
									Get Started
									<ArrowRight className="w-5 h-5" />
								</span>
							</Button>
						</motion.div>
						<Button
							size="lg"
							variant="outline"
							onClick={() => scrollToSection("pricing")}
							className="border-2 border-primary text-primary hover:bg-primary/10 hover:border-chart-2"
						>
							View Plans
						</Button>
					</motion.div>

					<motion.p
						className="mt-4 text-sm text-muted"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 1.0 }}
					>
						Requires the Project Phoenix mobile app for workout data sync
					</motion.p>
				</motion.div>

				<motion.div
					className="absolute bottom-10"
					initial={{ opacity: 0 }}
					animate={breathing.animate}
				>
					<div className="w-6 h-10 border-2 border-primary rounded-full flex items-start justify-center p-2">
						<div className="w-1.5 h-1.5 bg-primary rounded-full" />
					</div>
				</motion.div>
			</section>

			{/* Features Section */}
			<section
				id="features"
				className="relative py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-surface-2"
			>
				<div className="max-w-7xl mx-auto">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						className="text-center mb-16"
					>
						<h2 className="text-4xl sm:text-5xl mb-4 text-white">
							Built for serious athletes.
						</h2>
						<p className="text-xl text-muted max-w-2xl mx-auto">
							The insights your Vitruvian machine captures but never shows you —
							from force output to recovery readiness.
						</p>
					</motion.div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
						{features.map((feature, index) => (
							<motion.div
								key={feature.title}
								initial={{ opacity: 0, y: 20 }}
								whileInView={{ opacity: 1, y: 0 }}
								viewport={{ once: true }}
								transition={{ delay: index * 0.1 }}
							>
								<Card className="p-6 card-landing-feature group cursor-pointer h-full">
									<div className="flex items-center justify-between mb-4">
										<div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
											<feature.icon className="w-5 h-5 text-primary" />
										</div>
										<span
											className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TIER_BADGE_STYLES[feature.badge]}`}
										>
											{feature.badge}
										</span>
									</div>
									<h3 className="text-xl mb-2 text-white">{feature.title}</h3>
									<p className="text-muted-foreground">{feature.description}</p>
								</Card>
							</motion.div>
						))}
					</div>
				</div>
			</section>

			{/* Pricing Section */}
			<section
				id="pricing"
				className="relative py-24 px-4 sm:px-6 lg:px-8"
			>
				<div className="max-w-7xl mx-auto">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						className="text-center mb-16"
					>
						<h2 className="text-4xl sm:text-5xl mb-4 text-white">
							Choose Your Path
						</h2>
						<p className="text-xl text-muted">
							Select the plan that fits your journey
						</p>
					</motion.div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
						{pricingTiers.map((tier, index) => (
							<motion.div
								key={tier.name}
								initial={{ opacity: 0, y: 20 }}
								whileInView={{ opacity: 1, y: 0 }}
								viewport={{ once: true }}
								transition={{ delay: index * 0.1 }}
								className={tier.highlight ? "md:-mt-4 md:mb-4" : ""}
							>
								<Card
									className={`p-8 h-full flex flex-col ${
										tier.highlight
											? "bg-gradient-to-br from-primary/20 to-chart-2/20 border-primary border-2 ring-4 ring-primary/20"
											: "bg-gradient-to-br from-surface-2 to-background border-secondary"
									}`}
								>
									{tier.highlight && (
										<div className="mb-4 px-4 py-1 bg-gradient-to-r from-primary to-chart-2 rounded-full text-sm text-center w-fit mx-auto">
											RECOMMENDED
										</div>
									)}
									{tier.comingSoon && (
										<div className="mb-4 px-4 py-1 bg-accent/20 text-accent border border-accent/30 rounded-full text-sm text-center w-fit mx-auto">
											Coming Soon
										</div>
									)}
									<h3 className="text-2xl mb-2 text-white text-center">
										{tier.name}
									</h3>
									<div className="text-center mb-6">
										<span className="text-5xl text-primary">
											{tier.price}
										</span>
										<span className="text-muted-foreground ml-2">
											/ {tier.period}
										</span>
									</div>
									<ul className="space-y-3 mb-8 flex-1">
										{tier.features.map((feature) => (
											<li
												key={feature}
												className="flex items-start gap-2 text-secondary-foreground"
											>
												<svg
													className="w-5 h-5 text-success flex-shrink-0 mt-0.5"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
													strokeWidth={2}
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														d="M5 13l4 4L19 7"
													/>
												</svg>
												<span>{feature}</span>
											</li>
										))}
									</ul>
									<Button
										size="lg"
										onClick={tier.comingSoon ? undefined : openAuth}
										disabled={tier.comingSoon}
										className={
											tier.comingSoon
												? "w-full border-2 border-accent/30 bg-transparent text-accent/60 cursor-not-allowed"
												: tier.highlight
													? "w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0 shadow-lg shadow-primary/50"
													: "w-full border-2 border-primary bg-transparent text-primary hover:bg-primary/10"
										}
									>
										{tier.cta}
									</Button>
								</Card>
							</motion.div>
						))}
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="relative py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-amber-900/20 via-background to-background">
				<div className="max-w-4xl mx-auto text-center">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
					>
						<Flame className="w-12 h-12 text-primary mx-auto mb-6" />
						<h2 className="text-4xl sm:text-5xl mb-6 text-white">
							Rise from the ashes.
						</h2>
						<p className="text-xl text-secondary-foreground mb-8 max-w-2xl mx-auto">
							Your Vitruvian machine captures incredible data every rep. Phoenix
							Portal finally lets you see it all — force curves, biomechanics,
							recovery, and a community that trains like you do.
						</p>
						<div className="flex flex-col sm:flex-row gap-4 justify-center">
							<motion.div whileTap={tap.press} className="inline-flex">
								<Button
									size="lg"
									onClick={openAuth}
									className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 text-lg px-8 py-6"
								>
									<span className="flex items-center gap-2">
										Get Started
										<ArrowRight className="w-5 h-5" />
									</span>
								</Button>
							</motion.div>
							<a
								href="https://ko-fi.com/vitruvianredux"
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button
									size="lg"
									variant="outline"
									className="border-2 border-primary text-primary hover:bg-primary/10 text-lg px-8 py-6"
								>
									<span className="flex items-center gap-2">
										Support on Ko-fi
										<ExternalLink className="w-4 h-4" />
									</span>
								</Button>
							</a>
						</div>
					</motion.div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative py-12 px-4 sm:px-6 lg:px-8 border-t border-secondary">
				<div className="max-w-7xl mx-auto">
					<div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
						<div>
							<div className="flex items-center gap-2 mb-4">
								<PhoenixLogo size="sm" animated={false} />
								<span className="text-xl text-primary">
									Phoenix Portal
								</span>
							</div>
							<p className="text-muted-foreground text-sm">
								Rise From the Ashes. Forge Your Strength.
							</p>
						</div>
						<div>
							<h4 className="text-white mb-4">Product</h4>
							<ul className="space-y-2 text-muted-foreground text-sm">
								<li>
									<button
										type="button"
										onClick={() => scrollToSection("features")}
										className="hover:text-primary"
									>
										Features
									</button>
								</li>
								<li>
									<button
										type="button"
										onClick={() => scrollToSection("pricing")}
										className="hover:text-primary"
									>
										Pricing
									</button>
								</li>
							</ul>
						</div>
						<div>
							<h4 className="text-white mb-4">Project</h4>
							<ul className="space-y-2 text-muted-foreground text-sm">
								<li>
									<a
										href="https://ko-fi.com/vitruvianredux"
										target="_blank"
										rel="noopener noreferrer"
										className="hover:text-primary"
									>
										Ko-fi
									</a>
								</li>
								<li>
									<Link to="/faq" className="hover:text-primary">
										FAQ & Contact
									</Link>
								</li>
							</ul>
						</div>
						<div>
							<h4 className="text-white mb-4">Legal</h4>
							<ul className="space-y-2 text-muted-foreground text-sm">
								<li>
									<Link
										to="/privacy"
										className="hover:text-primary transition-colors"
									>
										Privacy
									</Link>
								</li>
								<li>
									<Link
										to="/terms"
										className="hover:text-primary transition-colors"
									>
										Terms of Service
									</Link>
								</li>
							</ul>
						</div>
					</div>
					<div className="pt-8 border-t border-secondary text-center space-y-3">
						<p className="text-muted-foreground text-sm">
							<span className="text-primary font-semibold">
								Phoenix Portal
							</span>{" "}
							is a community preservation project by{" "}
							<span className="text-white font-semibold">
								9th Level Software LLC
							</span>
						</p>
						<div className="text-muted text-xs max-w-3xl mx-auto space-y-2">
							<p className="font-semibold text-muted-foreground">
								Legal Notice
							</p>
							<p>
								Project Phoenix is an independent, community-developed
								application and is not affiliated with, endorsed by, sponsored
								by, or supported by Vitruvian Investments Pty Ltd (in
								Liquidation), managed by Merchants Advisory. Vitruvian and
								related marks are trademarks of their respective owners.
							</p>
							<p>
								By downloading or using Project Phoenix, you agree to our{" "}
								<Link
									to="/terms"
									className="text-primary underline underline-offset-4 decoration-current hover:no-underline"
								>
									Terms of Service
								</Link>
								, which includes important safety warnings and liability
								disclaimers.
							</p>
						</div>
						<p className="text-muted text-xs">
							&copy; 2026 9th Level Software LLC. All rights reserved.
						</p>
					</div>
				</div>
			</footer>
		</div>
	);
}
