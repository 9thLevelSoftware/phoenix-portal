import { zodResolver } from "@hookform/resolvers/zod";
import {
	Apple,
	ArrowRight,
	BarChart3,
	Calendar,
	Check,
	Chrome,
	Loader2,
	Mail,
	Share2,
	Trophy,
	Users,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/app/hooks/useAuth";
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

export function LandingPage() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	const [showAuthDialog, setShowAuthDialog] = useState(false);
	const [authLoading, setAuthLoading] = useState(false);
	const [showForgotPassword, setShowForgotPassword] = useState(false);
	const [resetEmail, setResetEmail] = useState("");

	// Redirect authenticated users to dashboard
	useEffect(() => {
		if (!loading && user) {
			navigate("/dashboard", { replace: true });
		}
	}, [user, loading, navigate]);

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

	const features = [
		{
			icon: BarChart3,
			title: "Real-time Analytics",
			description:
				"Track every rep, set, and workout with comprehensive data visualization.",
		},
		{
			icon: Trophy,
			title: "Personal Records",
			description:
				"Celebrate your victories with automatic PR detection and tracking.",
		},
		{
			icon: Calendar,
			title: "Training Cycles",
			description:
				"Plan and execute periodized training programs with precision.",
		},
		{
			icon: Users,
			title: "Community Challenges",
			description:
				"Compete with athletes worldwide in dynamic fitness challenges.",
		},
		{
			icon: Share2,
			title: "Routine Sharing",
			description:
				"Discover and share proven workout routines with the community.",
		},
		{
			icon: Zap,
			title: "Multi-App Sync",
			description:
				"Seamlessly integrate with your favorite fitness apps and wearables.",
		},
	];

	const pricingTiers = [
		{
			name: "Free",
			price: "$0",
			period: "forever",
			features: [
				"Basic workout tracking",
				"30-day history",
				"Community access",
				"Routine sharing",
			],
			cta: "Get Started",
			highlight: false,
		},
		{
			name: "Phoenix",
			price: "$9.99",
			period: "per month",
			features: [
				"Unlimited workout history",
				"Advanced analytics",
				"Training cycles",
				"Priority challenges",
				"All integrations",
				"Export data",
			],
			cta: "Rise Now",
			highlight: true,
		},
		{
			name: "Elite",
			price: "$19.99",
			period: "per month",
			features: [
				"Everything in Phoenix",
				"AI-powered insights",
				"Personal coaching",
				"Custom badge creation",
				"API access",
				"Priority support",
			],
			cta: "Forge Ahead",
			highlight: false,
		},
	];

	// Auth dialog using Radix Dialog for accessibility (focus trap, ARIA, keyboard nav)
	const authDialog = (
		<Dialog
			open={showAuthDialog}
			onOpenChange={(open) => {
				setShowAuthDialog(open);
				if (!open) {
					setShowForgotPassword(false);
					setResetEmail("");
				}
			}}
		>
			<DialogContent className="bg-surface-2 border-secondary max-w-md p-6">
				<DialogTitle className="sr-only">Sign in to Phoenix Portal</DialogTitle>
				<DialogDescription className="sr-only">
					Enter your credentials to access the dashboard
				</DialogDescription>

				<div className="flex items-center justify-center gap-2 mb-6">
					<PhoenixLogo size="sm" animated={false} />
					<span className="text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent font-semibold">
						Project Phoenix
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

			{/* Hero Section */}
			<section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.8 }}
					className="text-center z-10 flex flex-col items-center"
				>
					<PhoenixLogo size="xl" animated />

					<motion.h1
						className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
						style={{ fontFamily: "Inter, system-ui, sans-serif" }}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.2 }}
					>
						<span className="block bg-gradient-to-r from-primary via-chart-2 to-accent bg-clip-text text-transparent">
							Project Phoenix
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
						className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.6 }}
					>
						Community-driven analytics for Vitruvian Trainer
					</motion.p>

					<motion.div
						className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.8 }}
					>
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
						<Button
							size="lg"
							variant="outline"
							className="border-2 border-primary text-primary hover:bg-primary/10 hover:border-chart-2"
						>
							View Features
						</Button>
					</motion.div>
				</motion.div>

				<motion.div
					className="absolute bottom-10 animate-bounce"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 1.2 }}
				>
					<div className="w-6 h-10 border-2 border-primary rounded-full flex items-start justify-center p-2">
						<div className="w-1.5 h-1.5 bg-primary rounded-full" />
					</div>
				</motion.div>
			</section>

			{/* Features Section */}
			<section className="relative py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-surface-2">
				<div className="max-w-7xl mx-auto">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						className="text-center mb-16"
					>
						<h2 className="text-4xl sm:text-5xl mb-4">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Elevate Your Training
							</span>
						</h2>
						<p className="text-xl text-muted">
							Everything you need to reach your fitness goals
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
								<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all duration-300 group cursor-pointer h-full">
									<div className="mb-4 w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
										<feature.icon className="w-6 h-6 text-white" />
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
			<section className="relative py-24 px-4 sm:px-6 lg:px-8">
				<div className="max-w-7xl mx-auto">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						className="text-center mb-16"
					>
						<h2 className="text-4xl sm:text-5xl mb-4">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Choose Your Path
							</span>
						</h2>
						<p className="text-xl text-muted">
							Select the plan that fits your journey
						</p>
					</motion.div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
									<h3 className="text-2xl mb-2 text-white text-center">
										{tier.name}
									</h3>
									<div className="text-center mb-6">
										<span className="text-5xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
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
												<Check className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
												<span>{feature}</span>
											</li>
										))}
									</ul>
									<Button
										size="lg"
										onClick={openAuth}
										className={
											tier.highlight
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
			<section className="relative py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-surface-2 to-background">
				<div className="max-w-4xl mx-auto text-center">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
					>
						<h2 className="text-4xl sm:text-5xl mb-6">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Ready to Transform?
							</span>
						</h2>
						<p className="text-xl text-secondary-foreground mb-8">
							Join thousands of athletes who are already rising stronger
						</p>
						<Button
							size="lg"
							onClick={openAuth}
							className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 text-lg px-8 py-6"
						>
							<span className="flex items-center gap-2">
								Start Your Journey
								<ArrowRight className="w-5 h-5" />
							</span>
						</Button>
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
								<span className="text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
									Project Phoenix
								</span>
							</div>
							<p className="text-muted-foreground text-sm">
								Rise From the Ashes. Forge Your Strength.
							</p>
						</div>
						<div>
							<h4 className="text-white mb-4">Product</h4>
							<ul className="space-y-2 text-muted-foreground text-sm">
								<li className="hover:text-primary cursor-pointer">Features</li>
								<li className="hover:text-primary cursor-pointer">Pricing</li>
								<li className="hover:text-primary cursor-pointer">
									Integrations
								</li>
								<li className="hover:text-primary cursor-pointer">Roadmap</li>
							</ul>
						</div>
						<div>
							<h4 className="text-white mb-4">Company</h4>
							<ul className="space-y-2 text-muted-foreground text-sm">
								<li className="hover:text-primary cursor-pointer">About</li>
								<li className="hover:text-primary cursor-pointer">Blog</li>
								<li className="hover:text-primary cursor-pointer">Careers</li>
								<li className="hover:text-primary cursor-pointer">Contact</li>
							</ul>
						</div>
						<div>
							<h4 className="text-white mb-4">Legal</h4>
							<ul className="space-y-2 text-muted-foreground text-sm">
								<li>
									<Link
										to="/privacy"
										className="hover:text-primary cursor-pointer"
									>
										Privacy
									</Link>
								</li>
								<li className="hover:text-primary cursor-pointer">Terms</li>
								<li className="hover:text-primary cursor-pointer">Security</li>
							</ul>
						</div>
					</div>
					<div className="pt-8 border-t border-secondary text-center space-y-3">
						<p className="text-muted-foreground text-sm">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent font-semibold">
								Project Phoenix
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
								By downloading or using Project Phoenix, you agree to our Terms
								of Service, which includes important safety warnings and
								liability disclaimers.
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
