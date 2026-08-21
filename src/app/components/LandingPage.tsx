import { zodResolver } from "@hookform/resolvers/zod";
import {
	Activity,
	Cloud,
	Loader2,
	Mail,
	Play,
	Share2,
	Target,
	Trophy,
} from "lucide-react";
import { motion } from "motion/react";
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
import {
	buildAndroidChromeIntentUrl,
	detectInAppBrowser,
	getInAppBrowserLabel,
	type InAppBrowserDetection,
} from "@/lib/in-app-browser";
import { TIER_PRICING } from "@/lib/pricing";
import {
	buildSocialAuthRedirectUrl,
	GOOGLE_OAUTH_SCOPES,
	getSocialAuthAvailability,
	type SocialAuthAvailability,
	type SocialAuthProvider,
	supabase,
} from "@/lib/supabase";
import { ForceCurveDemo } from "./landing/ForceCurveDemo";
import { ProductShowcase } from "./landing/ProductShowcase";
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
type SocialAuthAvailabilityStatus = "pending" | "loaded" | "failed";

const TIER_BADGE_STYLES: Record<string, string> = {
	EMBER: "bg-primary/20 text-primary border-primary/30",
	FLAME: "bg-red-500/20 text-red-400 border-red-500/30",
	INFERNO: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

export function LandingPage() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	const [showAuthDialog, setShowAuthDialog] = useState(false);
	const [authLoading, setAuthLoading] = useState(false);
	const [showForgotPassword, setShowForgotPassword] = useState(false);
	const [resetEmail, setResetEmail] = useState("");
	const [authAlertMessage, setAuthAlertMessage] = useState<string | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const [socialAuthAvailability, setSocialAuthAvailability] =
		useState<SocialAuthAvailability | null>(null);
	const [socialAuthAvailabilityStatus, setSocialAuthAvailabilityStatus] =
		useState<SocialAuthAvailabilityStatus>("pending");
	const [inAppBrowser, setInAppBrowser] = useState<InAppBrowserDetection>({
		isInAppBrowser: false,
		browser: null,
		platform: "other",
	});

	const isSocialAuthProviderVisible = (provider: SocialAuthProvider) =>
		socialAuthAvailabilityStatus === "failed" ||
		socialAuthAvailability?.[provider] === true;
	const hasSocialAuthOptions =
		isSocialAuthProviderVisible("google") ||
		isSocialAuthProviderVisible("apple");

	// Redirect authenticated users to dashboard
	useEffect(() => {
		if (!loading && user) {
			navigate("/dashboard", { replace: true });
		}
	}, [user, loading, navigate]);

	// Lazy-load Space Grotesk font for landing page
	useEffect(() => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href =
			"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap";
		document.head.appendChild(link);
		return () => {
			document.head.removeChild(link);
		};
	}, []);

	// Track scroll for sticky nav
	useEffect(() => {
		const handleScroll = () => setScrolled(window.scrollY > 20);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	useEffect(() => {
		setInAppBrowser(detectInAppBrowser());
	}, []);

	useEffect(() => {
		let isActive = true;

		void getSocialAuthAvailability()
			.then((availability) => {
				if (isActive) {
					setSocialAuthAvailability(availability);
					setSocialAuthAvailabilityStatus("loaded");
				}
			})
			.catch(() => {
				if (isActive) {
					setSocialAuthAvailability(null);
					setSocialAuthAvailabilityStatus("failed");
				}
			});

		return () => {
			isActive = false;
		};
	}, []);

	const handleResetPassword = async () => {
		if (!resetEmail) {
			toast.error("Please enter your email address");
			return;
		}
		setAuthLoading(true);
		setAuthAlertMessage(null);
		try {
			const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
				redirectTo: `${window.location.origin}/auth/reset-password`,
			});
			if (error) {
				setAuthAlertMessage(error.message);
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
		setAuthAlertMessage(null);
		try {
			const { error } = await supabase.auth.signInWithPassword({
				email: data.email,
				password: data.password,
			});
			if (error) {
				setAuthAlertMessage(error.message);
				toast.error(error.message);
			}
		} catch {
			const msg = "An unexpected error occurred";
			setAuthAlertMessage(msg);
			toast.error(msg);
		} finally {
			setAuthLoading(false);
		}
	};

	const handleSignUp = async (data: SignUpFormData) => {
		setAuthLoading(true);
		setAuthAlertMessage(null);
		try {
			const { error } = await supabase.auth.signUp({
				email: data.email,
				password: data.password,
			});
			if (error) {
				setAuthAlertMessage(error.message);
				toast.error(error.message);
			} else {
				toast.success(
					"Account created! Check your email for a confirmation link.",
				);
			}
		} catch {
			const msg = "An unexpected error occurred";
			setAuthAlertMessage(msg);
			toast.error(msg);
		} finally {
			setAuthLoading(false);
		}
	};

	const handleOAuthSignIn = async (provider: SocialAuthProvider) => {
		if (
			socialAuthAvailabilityStatus !== "failed" &&
			socialAuthAvailability?.[provider] !== true
		) {
			const providerLabel = provider === "apple" ? "Apple" : "Google";
			const msg = `${providerLabel} sign-in is not configured right now.`;
			setAuthAlertMessage(msg);
			toast.error(msg);
			return;
		}

		if (inAppBrowser.isInAppBrowser) {
			const providerLabel = provider === "apple" ? "Apple" : "Google";
			const hostLabel = inAppBrowser.browser
				? getInAppBrowserLabel(inAppBrowser.browser)
				: "this app";
			const msg = `${providerLabel} blocks sign-in from ${hostLabel}'s in-app browser. Open phoenix-portal.com in your device browser (Chrome/Safari) and try again.`;
			setAuthAlertMessage(msg);
			toast.error(msg);
			return;
		}

		setAuthLoading(true);
		setAuthAlertMessage(null);
		try {
			const { error } = await supabase.auth.signInWithOAuth({
				provider,
				options: {
					redirectTo: buildSocialAuthRedirectUrl(provider),
					...(provider === "google" ? { scopes: GOOGLE_OAUTH_SCOPES } : {}),
				},
			});
			if (error) {
				setAuthAlertMessage(error.message);
				toast.error(error.message);
			}
		} catch {
			const msg = "An unexpected error occurred";
			setAuthAlertMessage(msg);
			toast.error(msg);
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
			icon: Cloud,
			title: "Sync & Backup",
			badge: "EMBER",
			description:
				"Workouts sync from the Project Phoenix mobile app automatically. Full history, searchable, exportable. Never lose a session.",
		},
		{
			icon: Trophy,
			title: "Records & Leaderboards",
			badge: "EMBER",
			description:
				"Personal records tracked per exercise, phase, and weight. See where you rank against other Vitruvian athletes on community leaderboards.",
		},
		{
			icon: Share2,
			title: "Routines & Cycles",
			badge: "FLAME",
			description:
				"Build training routines with supersets, AMRAP, and PR scaling. Organize into periodized cycles. Share with the community.",
		},
		{
			icon: Activity,
			title: "Analytics & Trends",
			badge: "FLAME",
			description:
				"Volume trends, muscle group distribution, training load, and progressive overload tracking across every exercise and time period.",
		},
		{
			icon: Target,
			title: "Biomechanics & Asymmetry",
			badge: "INFERNO",
			description:
				"Cable A/B force comparison catches left-right imbalances at the 2% threshold. Full biomechanics dashboard with velocity-based training zones.",
		},
		{
			icon: Play,
			title: "Session Replay",
			badge: "INFERNO",
			description:
				"50Hz telemetry playback of every rep. Scrub through sets on a Canvas timeline, overlay force curves, and spot fatigue patterns.",
		},
	];

	const pricingTiers = TIER_PRICING.map((t) => ({
		name: t.name,
		price: t.monthlyPrice,
		period: "per month",
		features: t.features,
		cta: t.comingSoon ? "Coming Soon" : "Subscribe",
		highlight: t.tier === "FLAME",
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
					setAuthAlertMessage(null);
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
							variant="cta"
							className="w-full"
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
							<TabsTrigger value="signin">Sign In</TabsTrigger>
							<TabsTrigger value="signup">Sign Up</TabsTrigger>
						</TabsList>

						{authAlertMessage ? (
							<div
								role="alert"
								className="mb-4 rounded border border-red-500/30 bg-red-950/40 p-3 text-sm text-red-300"
							>
								{authAlertMessage}
							</div>
						) : null}

						<TabsContent value="signin">
							<form
								noValidate
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
										<p className="text-sm text-red-400" role="alert">
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
										<p className="text-sm text-red-400" role="alert">
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
									variant="cta"
									className="w-full"
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
								noValidate
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
										<p className="text-sm text-red-400" role="alert">
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
										<p className="text-sm text-red-400" role="alert">
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
										<p className="text-sm text-red-400" role="alert">
											{signUpForm.formState.errors.confirmPassword.message}
										</p>
									)}
								</div>
								<Button
									type="submit"
									disabled={authLoading}
									variant="cta"
									className="w-full"
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

						{hasSocialAuthOptions ? (
							<>
								{/* OAuth divider */}
								<div className="relative my-6">
									<div className="absolute inset-0 flex items-center">
										<div className="w-full border-t border-secondary" />
									</div>
									<div className="relative flex justify-center text-sm">
										<span className="bg-surface-2 px-2 text-muted-foreground">
											or continue with
										</span>
									</div>
								</div>

								{inAppBrowser.isInAppBrowser ? (
									<div
										role="alert"
										className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
									>
										<p className="font-medium">
											Google and Apple block sign-in from in-app browsers.
										</p>
										<p className="mt-1 text-amber-200/90">
											{inAppBrowser.platform === "ios"
												? "Tap the ••• menu above and choose \u201COpen in Safari\u201D, then try again. Or use email and password below."
												: inAppBrowser.platform === "android"
													? "Tap the ••• menu above and choose \u201COpen in browser\u201D, then try again."
													: "Open phoenix-portal.com in Chrome or Safari, then try again."}
										</p>
										{inAppBrowser.platform === "android" ? (
											<a
												href={
													buildAndroidChromeIntentUrl() ??
													"https://phoenix-portal.com"
												}
												className="mt-2 inline-flex items-center text-amber-100 underline underline-offset-2 hover:text-white"
											>
												Open in Chrome
											</a>
										) : null}
									</div>
								) : null}

								{/* OAuth buttons — brand-compliant per Google/Apple guidelines */}
								<div className="flex flex-col gap-3">
									{isSocialAuthProviderVisible("google") ? (
										<button
											type="button"
											disabled={authLoading}
											onClick={() => handleOAuthSignIn("google")}
											className="flex items-center justify-center gap-3 w-full h-11 px-4 rounded-md bg-white hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors"
										>
											<svg
												viewBox="0 0 24 24"
												width="20"
												height="20"
												aria-hidden="true"
											>
												<path
													d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
													fill="#4285F4"
												/>
												<path
													d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
													fill="#34A853"
												/>
												<path
													d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
													fill="#FBBC05"
												/>
												<path
													d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
													fill="#EA4335"
												/>
											</svg>
											<span className="text-sm font-medium text-gray-700">
												Sign in with Google
											</span>
										</button>
									) : null}
									{isSocialAuthProviderVisible("apple") ? (
										<button
											type="button"
											disabled={authLoading}
											onClick={() => handleOAuthSignIn("apple")}
											className="flex items-center justify-center gap-3 w-full h-11 px-4 rounded-md bg-white hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors"
										>
											<svg
												viewBox="0 0 24 24"
												width="20"
												height="20"
												fill="#000"
												aria-hidden="true"
											>
												<path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
											</svg>
											<span className="text-sm font-medium text-gray-700">
												Sign in with Apple
											</span>
										</button>
									) : null}
								</div>
							</>
						) : null}
					</Tabs>
				)}
			</DialogContent>
		</Dialog>
	);

	return (
		<div className="min-h-screen bg-background text-white overflow-x-hidden">
			{authDialog}

			{/* Sticky Nav Header */}
			<nav
				className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
					scrolled
						? "bg-surface-1 border-b border-primary/15 shadow-[0_1px_12px_rgba(255,107,53,0.06)]"
						: "bg-transparent"
				}`}
			>
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16 relative">
					<div className="flex items-center gap-2">
						<PhoenixLogo size="sm" animated={false} />
						<span className="text-lg font-semibold text-primary">
							Phoenix Portal
						</span>
					</div>
					<div className="hidden sm:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
						<button
							type="button"
							onClick={() => scrollToSection("features")}
							className="text-base font-medium text-muted-foreground hover:text-white transition-colors nav-link-landing"
						>
							Features
						</button>
						<button
							type="button"
							onClick={() => scrollToSection("pricing")}
							className="text-base font-medium text-muted-foreground hover:text-white transition-colors nav-link-landing"
						>
							Pricing
						</button>
						<a
							href="https://ko-fi.com/vitruvianredux"
							target="_blank"
							rel="noopener noreferrer"
							className="text-base font-medium text-muted-foreground hover:text-white transition-colors nav-link-landing"
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
			<section className="relative min-h-[80svh] md:min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 pt-24">
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
					className="text-center z-10 flex flex-col items-center max-w-4xl mx-auto"
				>
					<motion.h1
						className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight font-family-display"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.2 }}
					>
						<span className="block text-primary">Your workouts, unlocked.</span>
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
						className="mt-8 flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.8 }}
					>
						<Button
							size="lg"
							onClick={openAuth}
							variant="cta"
							className="w-full sm:w-auto"
						>
							Preview dashboard
						</Button>
						<Button
							asChild
							size="lg"
							variant="outline"
							className="w-full sm:w-auto border border-white/15 text-white hover:bg-white/5"
						>
							<a
								href="https://github.com/nicholascross/ProjectPhoenix"
								target="_blank"
								rel="noopener noreferrer"
							>
								Get the mobile app
							</a>
						</Button>
					</motion.div>
				</motion.div>

				{/* Product showcase panels */}
				<motion.div
					className="mt-12 md:mt-16 w-full max-w-lg z-10"
					initial={{ opacity: 0, y: 24 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.9, duration: 0.6 }}
				>
					<ProductShowcase />
				</motion.div>
			</section>

			{/* Data-focused value proposition */}
			<section className="relative py-24 px-4 sm:px-6 lg:px-8">
				<div className="max-w-4xl mx-auto text-center">
					<motion.h2
						className="text-4xl sm:text-5xl md:text-6xl tracking-tight font-family-display text-white"
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
					>
						See every rep as data.
					</motion.h2>
					<motion.p
						className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
						initial={{ opacity: 0, y: 16 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						transition={{ delay: 0.15 }}
					>
						Force curves, recovery signals, PR trends, and session analysis —
						synced from the Project Phoenix app.
					</motion.p>
					<motion.div
						className="mt-8 flex items-center justify-center gap-4 sm:gap-6 text-sm text-muted-foreground"
						initial={{ opacity: 0 }}
						whileInView={{ opacity: 1 }}
						viewport={{ once: true }}
						transition={{ delay: 0.3 }}
					>
						{["Force curves", "Recovery signals", "Records", "Replay"].map(
							(item) => (
								<span key={item} className="flex items-center gap-1.5">
									<span
										className="w-1 h-1 rounded-full bg-primary"
										aria-hidden="true"
									/>
									{item}
								</span>
							),
						)}
					</motion.div>
				</div>
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
						<p className="eyebrow text-primary mb-3">WHAT YOU GET</p>
						<h2 className="text-3xl sm:text-4xl mb-4 text-white font-family-display">
							What your machine captures — finally visible.
						</h2>
						<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
							Every rep generates force, velocity, and timing data. Phoenix
							Portal turns it into actionable training intelligence.
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
								<Card className="p-5 card-landing-feature group cursor-pointer h-full">
									<div className="flex items-center justify-between mb-3">
										<div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center ring-1 ring-primary/25">
											<feature.icon className="w-5 h-5 text-primary" />
										</div>
										<span
											className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TIER_BADGE_STYLES[feature.badge]}`}
										>
											{feature.badge}
										</span>
									</div>
									<h3 className="text-lg font-semibold mb-1.5 text-white">
										{feature.title}
									</h3>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{feature.description}
									</p>
								</Card>
							</motion.div>
						))}
					</div>
				</div>
			</section>

			{/* Interactive Demo Section */}
			<section className="relative py-20 px-4 sm:px-6 lg:px-8">
				<div className="max-w-7xl mx-auto">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						className="text-center mb-10"
					>
						<p className="eyebrow text-primary mb-3">TRY IT</p>
						<h2 className="text-3xl sm:text-4xl mb-3 text-white font-family-display">
							Explore a real force curve.
						</h2>
						<p className="text-lg text-muted-foreground max-w-xl mx-auto">
							This is one rep of sample data. The full portal shows every set,
							every session, with velocity zones and fatigue detection.
						</p>
					</motion.div>
					<motion.div
						initial={{ opacity: 0, y: 16 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						transition={{ delay: 0.15 }}
					>
						<ForceCurveDemo />
					</motion.div>
				</div>
			</section>

			{/* Pricing Section */}
			<section id="pricing" className="relative py-24 px-4 sm:px-6 lg:px-8">
				<div className="max-w-7xl mx-auto">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						className="text-center mb-16"
					>
						<p className="eyebrow text-primary mb-3">PRICING</p>
						<h2 className="text-3xl sm:text-4xl mb-4 text-white font-family-display">
							Plans
						</h2>
						<p className="text-lg text-muted-foreground">
							Each tier unlocks deeper analysis.
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
											? "bg-surface-2 border-primary border ring-1 ring-primary/20"
											: "bg-surface-1 border-white/[0.06]"
									}`}
								>
									{tier.highlight && (
										<div className="mb-4 px-3 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded-full text-center w-fit mx-auto border border-primary/25">
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
										<span className="text-5xl text-primary font-family-display font-bold tabular-nums">
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
													aria-hidden="true"
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
													? "w-full bg-primary hover:bg-primary/90 border-0"
													: "w-full border border-white/15 text-white hover:bg-white/5"
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
			<section className="relative py-24 px-4 sm:px-6 lg:px-8">
				<div className="max-w-3xl mx-auto text-center">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
					>
						<h2 className="text-3xl sm:text-4xl mb-4 text-white font-family-display">
							Start syncing workouts.
						</h2>
						<p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
							Connect the Project Phoenix mobile app, complete a workout, and
							your data flows here automatically. Force curves, recovery,
							records — everything updates in real time.
						</p>
						<div className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
							<Button
								asChild
								size="lg"
								className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white border-0"
							>
								<a
									href="https://github.com/nicholascross/ProjectPhoenix"
									target="_blank"
									rel="noopener noreferrer"
								>
									Get the mobile app
								</a>
							</Button>
							<Button
								size="lg"
								variant="outline"
								onClick={openAuth}
								className="w-full sm:w-auto border border-white/15 text-white hover:bg-white/5"
							>
								Preview dashboard
							</Button>
						</div>
						<div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
							<a
								href="https://ko-fi.com/vitruvianredux"
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-primary transition-colors"
							>
								Support on Ko-fi
							</a>
						</div>
					</motion.div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative pt-16 pb-12 px-4 sm:px-6 lg:px-8 border-t border-primary/10">
				<div className="max-w-7xl mx-auto">
					<div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
						<div>
							<div className="flex items-center gap-2 mb-4">
								<PhoenixLogo size="sm" animated={false} />
								<span className="text-xl text-primary">Phoenix Portal</span>
							</div>
							<p className="text-muted-foreground text-sm">
								Performance data for Vitruvian athletes.
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
								<li>
									<a
										href="https://github.com/9thLevelSoftware/phoenix-portal/blob/main/ATTRIBUTIONS.md"
										target="_blank"
										rel="noopener noreferrer"
										className="hover:text-primary transition-colors"
									>
										Licenses
									</a>
								</li>
							</ul>
						</div>
					</div>
					<div className="pt-8 border-t border-secondary text-center space-y-3">
						<p className="text-muted-foreground text-sm">
							<span className="text-primary font-semibold">Phoenix Portal</span>{" "}
							is a community preservation project by{" "}
							<span className="text-white font-semibold">
								9th Level Software LLC
							</span>
						</p>
						<div className="text-muted-foreground text-[11px] max-w-3xl mx-auto space-y-1.5 leading-relaxed">
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
						<p className="text-muted-foreground text-xs">
							&copy; 2026 9th Level Software LLC. All rights reserved.
						</p>
					</div>
				</div>
			</footer>
		</div>
	);
}
