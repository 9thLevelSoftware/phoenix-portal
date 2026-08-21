import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/app/components/ui/button";
import { PhoenixLogo } from "./PhoenixLogo";

export function TermsOfService() {
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
					<h1 className="text-display-1 mb-4">
						<span className="text-primary">Terms of Service</span>
					</h1>
					<p className="text-xl text-muted-foreground mb-2">
						Project Phoenix - Phoenix fitness machine Companion App
					</p>
					<p className="text-sm text-muted-foreground mb-8">
						Effective Date: February 27, 2026
					</p>

					{/* Summary Box */}
					<div className="mb-12 p-6 rounded-lg bg-gradient-to-br from-primary/10 to-chart-2/10 border-2 border-primary/30">
						<p className="text-lg text-secondary-foreground">
							<span className="font-semibold text-primary">Summary:</span> These
							terms govern your use of Phoenix Portal, a community-developed
							companion dashboard for Phoenix fitness machine workout machines.
							By using the service, you agree to these terms.
						</p>
					</div>

					{/* Terms Sections */}
					<article className="space-y-8">
						<section>
							<h2 className="text-2xl mb-4 text-primary">
								1. Acceptance of Terms
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								By accessing or using Phoenix Portal ("the Service"), you agree
								to be bound by these Terms of Service and our{" "}
								<Link
									to="/privacy"
									className="text-primary hover:text-accent underline"
								>
									Privacy Policy
								</Link>
								. If you do not agree to these terms, please do not use the
								Service.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								These terms apply to all users of the Service, including
								visitors, registered users, and subscribers. We may update these
								terms from time to time, and your continued use constitutes
								acceptance of any changes.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								2. Description of Service
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								Phoenix Portal is a companion web dashboard for Project Phoenix,
								a community rescue project for Phoenix fitness machine workout
								machines. The portal provides workout data visualization,
								analytics, community features, and training tools.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								All workout control happens via the mobile app -- the web portal
								is a view-only companion for reviewing your training data. The
								Service is provided on a best-effort basis by the community and
								is not affiliated with or endorsed by Phoenix.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								3. Account Registration
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								To use Phoenix Portal, you must create an account. You agree to:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Provide accurate and complete information during
										registration
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Maintain the security of your account credentials</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Maintain only one account per person</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Accept responsibility for all activity under your account
									</span>
								</li>
							</ul>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								We reserve the right to suspend or terminate accounts that
								violate these terms or engage in fraudulent activity.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								4. Subscription Terms
							</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								Phoenix Portal offers three paid subscription tiers: Ember,
								Flame, and Inferno.
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Billing:</span> Paid
										subscriptions are billed monthly or annually through Paddle,
										our payment processor and merchant of record. Paddle handles
										all payment processing, tax collection, and invoicing on our
										behalf
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Cancellation:</span> You can
										cancel anytime through the portal's subscription management
										page. Your access continues until the end of the current
										billing period
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Refunds:</span> Refund
										requests are handled by Paddle in accordance with their
										refund policy. To request a refund, contact Paddle support
										or use the subscription management link in your confirmation
										email. Refunds are generally available within 14 days of
										purchase
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Price Changes:</span> We may
										change pricing with 30 days notice to existing subscribers
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Portal Access:</span> All
										subscription management — signup, upgrades, downgrades, and
										cancellations — is handled directly on the Phoenix Portal
										website
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										<span className="font-semibold">Merchant of Record:</span>{" "}
										Paddle.com is the Merchant of Record for all subscription
										transactions. For tax, billing, and payment inquiries,
										Paddle's terms of service apply alongside these terms
									</span>
								</li>
							</ul>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">5. Acceptable Use</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								You agree not to:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Reverse engineer, decompile, or disassemble the Service
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Distribute malware or harmful code through the Service
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Impersonate other users or entities</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Post harmful, illegal, or abusive content</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Attempt unauthorized access to the Service or its systems
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Abuse API rate limits or overload the Service</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>
										Use the Service for commercial purposes without permission
									</span>
								</li>
							</ul>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								6. Community Content
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								You retain ownership of content you post, including workout
								shares, comments, and routine templates. By posting content, you
								grant Phoenix Portal a non-exclusive, royalty-free license to
								display your content within the Service.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								You can delete your content at any time. All content must comply
								with the Acceptable Use policy above. We reserve the right to
								remove content that violates these terms.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								7. Intellectual Property
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								The Phoenix Portal service, its design, code, and branding are
								the property of 9th Level Software LLC. The Phoenix fitness
								machine name and trademarks belong to their respective owners.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								Project Phoenix is a community project and is not affiliated
						Project Phoenix is a community project and is not affiliated
						with or endorsed by Vitruvian Investments Pty Ltd.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								8. Limitation of Liability
							</h2>
							<div className="p-4 rounded-lg bg-chart-1/10 border border-chart-1/30 mb-4">
								<p className="text-secondary-foreground leading-relaxed font-semibold uppercase text-sm">
									This is a community project. The Service is provided "as is"
									without warranties of any kind, either express or implied.
								</p>
							</div>
							<p className="text-secondary-foreground leading-relaxed">
								9th Level Software LLC is not liable for any damages arising
								from your use of the Service, including but not limited to
								direct, indirect, incidental, or consequential damages.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								We do not guarantee uptime, data accuracy, or fitness outcomes.
								Use workout data at your own risk. Consult a healthcare provider
								before making fitness decisions based on data from the portal.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">9. Termination</h2>
							<p className="text-secondary-foreground leading-relaxed">
								We may terminate or suspend your account at any time for
								violations of these Terms. You may terminate your account by
								deleting it from your profile settings.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								Upon termination, your data will be handled per our{" "}
								<Link
									to="/privacy"
									className="text-primary hover:text-accent underline"
								>
									Privacy Policy
								</Link>{" "}
								and data retention practices.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">
								10. Changes to Terms
							</h2>
							<p className="text-secondary-foreground leading-relaxed">
								We may update these Terms from time to time. Significant changes
								will be communicated through the Service. Continued use after
								changes are posted constitutes acceptance of the updated terms.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">11. Governing Law</h2>
							<p className="text-secondary-foreground leading-relaxed">
								These Terms are governed by the laws of the State of Florida,
								United States, without regard to conflict of law principles. Any
								disputes arising from these terms will be resolved through
								good-faith negotiation before any formal legal proceedings.
							</p>
							<p className="text-secondary-foreground leading-relaxed mt-4">
								Nothing in these Terms affects your rights as a consumer under
								mandatory consumer protection laws of your country of residence,
								including rights under the General Data Protection Regulation
								(GDPR) for EU/EEA residents and the UK GDPR for UK residents.
							</p>
						</section>

						<section>
							<h2 className="text-2xl mb-4 text-primary">12. Contact</h2>
							<p className="text-secondary-foreground leading-relaxed mb-3">
								Questions about these Terms? You can reach us through:
							</p>
							<ul className="space-y-2 text-secondary-foreground ml-6">
								<li className="flex items-start gap-2">
									<span className="text-primary mt-1">•</span>
									<span>Our GitHub repository (open an issue)</span>
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
						&copy; 2026 9th Level Software LLC. All rights reserved.
					</p>
				</div>
			</footer>
		</div>
	);
}
