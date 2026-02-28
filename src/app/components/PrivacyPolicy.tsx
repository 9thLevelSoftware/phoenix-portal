import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { Button } from "@/app/components/ui/button";
import { PhoenixLogo } from "./PhoenixLogo";

export function PrivacyPolicy() {
	const navigate = useNavigate();
	return (
		<div className="min-h-screen bg-background text-white">
			{/* Header */}
			<header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-secondary">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<PhoenixLogo size="sm" animated={false} />
							<span className="text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Project Phoenix
							</span>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate(-1)}
							className="border-primary text-primary hover:bg-primary/10"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back
						</Button>
					</div>
				</div>
			</header>

			{/* Content */}
			<main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5 }}
				>
					<h1 className="text-4xl sm:text-5xl mb-4">
						<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
							Privacy Policy
						</span>
					</h1>
					<p className="text-xl text-muted-foreground mb-2">
						Project Phoenix - Vitruvian Trainer Companion App
					</p>
					<p className="text-sm text-muted mb-8">
						Effective Date: February 20, 2026
					</p>

					{/* Summary Box */}
					<div className="mb-12 p-6 rounded-lg bg-gradient-to-br from-primary/10 to-chart-2/10 border-2 border-primary/30">
						<p className="text-lg text-secondary-foreground">
							<span className="font-semibold text-primary">Summary:</span>{" "}
							Project Phoenix uses Supabase for authentication and cloud data
							storage, and Sentry for error monitoring. We collect only the data
							needed to power your fitness dashboard. We never sell your personal
							information.
						</p>
					</div>

					{/* Policy Sections */}
					<div className="space-y-8">
						<section>
							<h2 className="text-2xl mb-4 text-primary">1. Introduction</h2>
							<p className="text-secondary-foreground leading-relaxed">
								Project Phoenix ("we," "our," or "the App") is a
								community-developed companion application for Vitruvian Trainer
								fitness equipment. We are committed to protecting your privacy
								and being transparent about our data practices.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								This Privacy Policy explains what information the App accesses,
								how it is used, and your rights regarding your data.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								2. Information We Collect
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-4">
								Project Phoenix requires an account to use. When you sign up and
								use the App, we collect and store the following information on
								our cloud servers (hosted by Supabase):
							</p>
							<p className="text-secondary-foreground leading-relaxed mb-3 font-semibold">
								Account Information:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Email address, display name, and avatar (used for
										authentication and your profile)
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Subscription tier and billing status (managed via Stripe)
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mb-3 font-semibold">
								Fitness Data:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Workout Data:</span>{" "}
										Exercise sessions, sets, reps, weights, and timestamps
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Performance Metrics:</span>{" "}
										Real-time machine data during workouts (position, velocity,
										load, power)
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Personal Records:</span>{" "}
										Your best lifts and calculated one-rep max estimates
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Custom Routines &amp; Training Cycles:</span>{" "}
										Workout routines and periodization plans you create
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Goals &amp; Challenges:</span>{" "}
										Fitness goals and community challenge participation
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">App Preferences:</span> Your
										settings such as weight unit preference (kg/lb) and
										notification preferences
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								<span className="font-semibold">
									Biometric-Adjacent Data Notice:
								</span>{" "}
								Performance metrics derived from machine sensors — including
								velocity, power output, force curves, and rep timing data — may
								qualify as biometric-adjacent data in some jurisdictions. We
								collect and store this data to provide training insights and are
								transparent about its nature.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								3. Bluetooth Permissions
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								The App requires Bluetooth Low Energy (BLE) permissions to
								connect to your Vitruvian Trainer equipment. This connection is
								used exclusively for:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Discovering and connecting to your Vitruvian machine
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Sending workout commands (weight, mode settings)</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Receiving real-time workout metrics from the machine
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed">
								Bluetooth data is processed in real-time and relevant metrics
								are stored locally. No Bluetooth data is transmitted to external
								parties.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								4. Data Storage and Security
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-4">
								Your data is stored securely on Supabase, a cloud database
								platform. Supabase provides row-level security (RLS) to ensure
								you can only access your own data.
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Encrypted in Transit:</span>{" "}
										All data is transmitted over HTTPS/TLS
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Encrypted at Rest:</span>{" "}
										Supabase encrypts data at rest using AES-256
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Row-Level Security:</span>{" "}
										Database policies ensure each user can only read and modify
										their own records
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Authentication:</span>{" "}
										Supabase Auth manages sessions with secure JWT tokens
									</span>
								</li>
							</ul>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								5. Third-Party Services
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								The App integrates with the following third-party services:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Supabase:</span> Cloud
										database, authentication, and file storage
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Stripe:</span> Payment
										processing for subscriptions (we do not store card details)
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Fitness Integrations (optional):</span>{" "}
										Strava, Fitbit, Garmin, and Hevy. When you connect these
										services, we import activity data (duration, distance,
										heart rate) to display alongside your Vitruvian workouts.
										You can disconnect at any time.
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Mobile Health (optional):</span>{" "}
										Apple Health and Google Health Connect, synced via the
										Phoenix mobile app
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Sentry:</span> Error
										monitoring and crash reporting. When errors occur, Sentry
										collects browser type, operating system, error messages, and
										stack traces to help us diagnose and fix issues. No personal
										workout data is included in error reports.
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Google &amp; Apple Sign-In:
										</span>{" "}
										When you use Google or Apple to sign in, the authentication
										provider shares your email address and display name with us
										to create your account. We do not receive or store your
										Google/Apple password.
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								We do <span className="font-semibold">not</span> use:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Marketing analytics or advertising trackers (Google
										Analytics, Facebook Pixel, etc.)
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Advertising networks</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Social media SDKs</span>
								</li>
							</ul>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">6. Data Sharing</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								<span className="font-semibold">
									We do not sell your data.
								</span>{" "}
								Your data is shared only with the third-party services listed
								above, and only as needed to provide the App's functionality:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Supabase processes and stores your data on our behalf
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Stripe processes payment information for subscriptions
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Connected fitness services share activity data that you
										authorize
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mt-3">
								Community features (challenges, leaderboards) may display your
								display name and workout statistics to other users. You can
								control this in your profile privacy settings.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								7. Your Rights and Data Control
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								You have control over your data:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Access:</span> All your data
										is visible within the App's history, analytics, and profile
										screens
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Export:</span> You can
										export your workout history and personal records as CSV
										files from your profile
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Deletion:</span> You can
										delete individual workouts and routines within the App, or
										contact us to delete your account and all associated data
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Disconnect:</span> You can
										disconnect third-party fitness integrations at any time from
										the Integrations page
									</span>
								</li>
							</ul>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								8. Children's Privacy
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								The App is not directed at children under the age of 13. We do
								not knowingly collect any information from children. The App is
								designed for adult fitness enthusiasts using Vitruvian Trainer
								equipment.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								9. Changes to This Privacy Policy
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								We may update this Privacy Policy from time to time. Any changes
								will be reflected on this page with an updated effective date.
								We encourage you to review this Privacy Policy periodically.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">10. Open Source</h2>
							<p className="text-secondary-foreground leading-relaxed">
								Project Phoenix is an open-source, community-driven project. You
								can review our source code to verify our privacy practices at
								any time.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">11. Contact Us</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								If you have any questions about this Privacy Policy or the App's
								data practices, you can:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Open an issue on our GitHub repository</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Support the project:{" "}
										<a
											href="https://ko-fi.com/vitruvianredux"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:text-accent underline"
										>
											ko-fi.com/vitruvianredux
										</a>
									</span>
								</li>
							</ul>
						</section>
					</div>

					{/* Back Button */}
					<div className="mt-12 text-center">
						<Button
							onClick={() => navigate(-1)}
							className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to Home
						</Button>
					</div>
				</motion.div>
			</main>

			{/* Footer */}
			<footer className="border-t border-secondary py-8 mt-12">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
					<p className="text-muted text-sm">
						© 2026 9th Level Software LLC. All rights reserved.
					</p>
				</div>
			</footer>
		</div>
	);
}
