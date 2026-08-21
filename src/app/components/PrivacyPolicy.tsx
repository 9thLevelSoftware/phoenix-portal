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
			<header className="sticky top-0 z-50 bg-surface-1 border-b border-secondary">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<PhoenixLogo size="sm" animated={false} />
							<span className="text-xl text-primary">Project Phoenix</span>
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
					<h1 className="text-display-1 mb-4 text-white">Privacy Policy</h1>
					<p className="text-xl text-muted-foreground mb-2">
						Project Phoenix - Phoenix fitness machine Companion App
					</p>
					<p className="text-sm text-muted-foreground mb-8">
						Effective Date: February 20, 2026
					</p>

					{/* Summary Box */}
					<div className="mb-12 p-6 rounded-lg bg-gradient-to-br from-primary/10 to-chart-2/10 border-2 border-primary/30">
						<p className="text-lg text-secondary-foreground">
							<span className="font-semibold text-primary">Summary:</span>{" "}
							Project Phoenix uses Supabase for authentication and cloud data
							storage, and Sentry for error monitoring. We collect only the data
							needed to power your fitness dashboard. We never sell your
							personal information.
						</p>
					</div>

					{/* Policy Sections */}
					<article className="space-y-8">
						<section>
							<h2 className="text-2xl mb-4 text-primary">1. Introduction</h2>
							<p className="text-secondary-foreground leading-relaxed">
								Project Phoenix ("we," "our," or "the App") is a
								community-developed companion application for Phoenix fitness
								machine fitness equipment. We are committed to protecting your
								privacy and being transparent about our data practices.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								This Privacy Policy explains what information the App accesses,
								how it is used, and your rights regarding your data.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">2. Data Controller</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								The data controller responsible for your personal data is:
							</p>
							<div className="p-4 rounded-lg bg-card/50 border border-secondary">
								<p className="text-secondary-foreground leading-relaxed">
									<span className="font-semibold">9th Level Software LLC</span>
									<br />
									Email:{" "}
									<a
										href="mailto:support@phoenix-portal.com"
										className="text-primary hover:text-accent underline"
									>
										support@phoenix-portal.com
									</a>
								</p>
							</div>
							<p className="text-secondary-foreground leading-relaxed mt-3 text-sm">
								We have not appointed a Data Protection Officer (DPO) as we are
								a small business that does not engage in large-scale systematic
								monitoring or processing of special category data. For any
								privacy inquiries, please contact us at the email above.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								3. Information We Collect
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
										Subscription tier and billing status (managed via Paddle,
										our payment processor)
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
										<span className="font-semibold">
											Custom Routines &amp; Training Cycles:
										</span>{" "}
										Workout routines and periodization plans you create
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Goals &amp; Challenges:
										</span>{" "}
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
								4. Legal Basis for Processing
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-4">
								Under the General Data Protection Regulation (GDPR), we process
								your personal data on the following legal bases:
							</p>
							<ul className="space-y-3 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Account data (email, display name, avatar):
										</span>{" "}
										Contract performance — necessary to provide you with the
										Service (Article 6(1)(b))
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Workout data (sets, reps, weight, velocity, power):
										</span>{" "}
										Contract performance — core functionality of the fitness
										dashboard you signed up for (Article 6(1)(b))
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Recovery and workload data (ACWR scores, fatigue metrics):
										</span>{" "}
										Legitimate interest — providing training insights that help
										you avoid overtraining and injury. You may object to this
										processing at any time (Article 6(1)(f))
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Payment and subscription data:
										</span>{" "}
										Contract performance — processed by Paddle (our Merchant of
										Record) as a data processor on our behalf. We do not store
										payment card details (Article 6(1)(b))
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											OAuth tokens (Strava, Fitbit, Garmin, Hevy):
										</span>{" "}
										Consent — you explicitly authorize each integration
										connection. You may withdraw consent by disconnecting the
										integration at any time (Article 6(1)(a))
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Error monitoring (Sentry):
										</span>{" "}
										Consent — only activated after you accept cookies via our
										consent banner. No personal workout data is included in
										error reports (Article 6(1)(a))
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								We do not collect usage analytics beyond Sentry error
								monitoring. We do not use advertising trackers or marketing
								analytics tools.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								5. Bluetooth Permissions
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								The App requires Bluetooth Low Energy (BLE) permissions to
								connect to your Phoenix fitness machine equipment. This
								connection is used exclusively for:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Discovering and connecting to your Phoenix machine
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
								6. Data Storage and Security
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
								7. Third-Party Services
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
										<span className="font-semibold">Paddle Billing:</span>{" "}
										Subscription payments are processed by Paddle, our merchant
										of record. We do not store payment card details.
										Subscription status is synced to the Portal via Paddle
										webhooks.
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Fitness Integrations (optional):
										</span>{" "}
										Strava, Fitbit, Garmin, and Hevy. When you connect these
										services, we import activity data (duration, distance, heart
										rate) to display alongside your Phoenix workouts. You can
										disconnect at any time.
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Mobile Health (optional):
										</span>{" "}
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
							<h2 className="text-2xl mb-4 text-primary">8. Data Sharing</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								<span className="font-semibold">We do not sell your data.</span>{" "}
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
										Subscription payments are processed through Paddle, our
										merchant of record
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
							<h2 className="text-2xl mb-4 text-primary">9. Data Retention</h2>
							<p className="text-secondary-foreground leading-relaxed mb-4">
								We retain your personal data only for as long as necessary to
								provide the Service and fulfill the purposes described in this
								policy. Specific retention periods are:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Account data:</span>{" "}
										Retained until you delete your account
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Workout data:</span>{" "}
										Retained until you delete your account or manually delete
										individual workouts. You may export your data as CSV before
										deletion
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Routines and training cycles:
										</span>{" "}
										Retained until you delete them individually or delete your
										account
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">OAuth tokens:</span>{" "}
										Retained until you disconnect the integration or delete your
										account
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Error logs (Sentry):</span>{" "}
										90 days (Sentry's default retention period)
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Rate limit records:</span>{" "}
										24 hours
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								When you delete your account, all associated data is permanently
								removed from our systems via a cascading deletion process. This
								action is irreversible.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								10. International Data Transfers
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								Your data may be transferred to and processed in countries
								outside your country of residence:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Supabase:</span> Data is
										stored and processed on infrastructure located in the United
										States. Supabase maintains appropriate technical and
										organizational measures and relies on Standard Contractual
										Clauses (SCCs) for transfers from the EEA/UK
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Paddle:</span> Payment
										processing is handled by Paddle, headquartered in the United
										Kingdom. The UK has received an adequacy decision from the
										European Commission. Paddle maintains its own GDPR
										compliance as the Merchant of Record
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Sentry:</span> Error
										monitoring data (when consented to) is processed on servers
										in the United States. Sentry relies on Standard Contractual
										Clauses for EEA/UK data transfers
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								Where your data is transferred outside the European Economic
								Area (EEA) or UK, we ensure appropriate safeguards are in place
								as required by applicable data protection law, including
								Standard Contractual Clauses approved by the European
								Commission.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								11. Your Rights and Data Control
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								You have control over your data. Under the GDPR and other
								applicable data protection laws, you have the following rights:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6 mb-4">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right of Access (Article 15):
										</span>{" "}
										All your data is visible within the App's history,
										analytics, and profile screens. You may also request a
										complete copy of your personal data by contacting us
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right to Data Portability (Article 20):
										</span>{" "}
										You can export your workout history and personal records as
										CSV files from your profile
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right to Erasure (Article 17):
										</span>{" "}
										You can delete individual workouts and routines within the
										App, or delete your account and all associated data from
										your profile settings
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right to Rectification (Article 16):
										</span>{" "}
										You can update your profile information (display name,
										avatar) at any time. For corrections to other data, contact
										us
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right to Restriction of Processing (Article 18):
										</span>{" "}
										You may request that we restrict the processing of your
										personal data in certain circumstances, such as when you
										contest the accuracy of the data
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right to Object (Article 21):
										</span>{" "}
										You may object to processing based on legitimate interest
										(such as recovery/workload analysis). We will cease
										processing unless we demonstrate compelling legitimate
										grounds
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">
											Right to Withdraw Consent (Article 7(3)):
										</span>{" "}
										Where processing is based on consent (fitness integrations,
										Sentry error monitoring), you may withdraw consent at any
										time. Disconnect integrations from the Integrations page, or
										manage cookie preferences to control Sentry. Withdrawal does
										not affect the lawfulness of processing before withdrawal
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Cookie Preferences:</span>{" "}
										You can manage your cookie preferences at any time. A
										consent banner appears on your first visit. To reset your
										preference, clear your browser's local storage for this site
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								To exercise any of these rights, contact us at{" "}
								<a
									href="mailto:support@phoenix-portal.com"
									className="text-primary hover:text-accent underline"
								>
									support@phoenix-portal.com
								</a>
								. We will respond to your request within 30 days as required by
								the GDPR.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								12. Right to Lodge a Complaint
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								If you believe that our processing of your personal data
								infringes data protection law, you have the right to lodge a
								complaint with a supervisory authority. You may do so in the EU
								Member State of your habitual residence, your place of work, or
								the place of the alleged infringement. A list of EU data
								protection authorities can be found on the{" "}
								<a
									href="https://edpb.europa.eu/about-edpb/about-edpb/members_en"
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:text-accent underline"
								>
									European Data Protection Board website
								</a>
								.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								We encourage you to contact us first so we have the opportunity
								to address your concern directly.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								13. Children's Privacy
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								The App is not directed at children under the age of 13. We do
								not knowingly collect any information from children. The App is
								designed for adult fitness enthusiasts using Phoenix fitness
								machine equipment.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								14. Changes to This Privacy Policy
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								We may update this Privacy Policy from time to time. Any changes
								will be reflected on this page with an updated effective date.
								We encourage you to review this Privacy Policy periodically.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">15. Open Source</h2>
							<p className="text-secondary-foreground leading-relaxed">
								Project Phoenix is an open-source, community-driven project. You
								can review our source code to verify our privacy practices at
								any time.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">16. Contact Us</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								If you have any questions about this Privacy Policy or the App's
								data practices, you can:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Email:{" "}
										<a
											href="mailto:support@phoenix-portal.com"
											className="text-primary hover:text-accent underline"
										>
											support@phoenix-portal.com
										</a>
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Open an issue on our GitHub repository</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Support the project:{" "}
										<a
											href="https://ko-fi.com/phoenixredux"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:text-accent underline"
										>
											ko-fi.com/phoenixredux
										</a>
									</span>
								</li>
							</ul>
						</section>
					</article>

					{/* Back Button */}
					<div className="mt-12 text-center">
						<Button onClick={() => navigate(-1)} variant="cta">
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to Home
						</Button>
					</div>
				</motion.div>
			</main>

			{/* Footer */}
			<footer className="border-t border-secondary py-8 mt-12">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
					<p className="text-muted-foreground text-sm">
						© 2026 9th Level Software LLC. All rights reserved.
					</p>
				</div>
			</footer>
		</div>
	);
}
