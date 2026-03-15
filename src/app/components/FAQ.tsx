import {
	ArrowLeft,
	ExternalLink,
	HelpCircle,
	MessageSquare,
} from "lucide-react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/app/components/ui/accordion";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { PhoenixLogo } from "./PhoenixLogo";

interface FAQCategory {
	title: string;
	items: { question: string; answer: React.ReactNode }[];
}

const faqCategories: FAQCategory[] = [
	{
		title: "Getting Started",
		items: [
			{
				question: "What is Phoenix Portal?",
				answer: (
					<p>
						Phoenix Portal is a web companion dashboard for Project Phoenix, a
						community rescue project for Vitruvian Trainer workout machines. It
						provides a view-only interface for tracking your training data,
						analytics, and progress. All workout control happens in the mobile
						app — the portal gives you deeper insights on a larger screen.
					</p>
				),
			},
			{
				question: "How do I get started?",
				answer: (
					<p>
						Sign up for an account, connect your mobile app, and your workouts
						will sync automatically. Once linked, every session recorded on your
						Vitruvian Trainer appears in the portal within seconds.
					</p>
				),
			},
			{
				question: "What devices are supported?",
				answer: (
					<p>
						Phoenix Portal runs in any modern web browser on desktop, tablet, or
						phone. It&apos;s designed as a companion to the mobile app, giving
						you a full-screen view of your training data wherever you prefer to
						review it.
					</p>
				),
			},
		],
	},
	{
		title: "Subscriptions & Pricing",
		items: [
			{
				question: "What subscription tiers are available?",
				answer: (
					<p>
						We offer two tiers: <strong>Ember</strong> ($15/mo — cloud
						sync, unlimited history, community sharing, and third-party
						connections), and <strong>Inferno</strong> ($25/mo — everything
						in Ember plus advanced analytics, biomechanics, force curves,
						VBT zones, and session replay). Inferno is coming soon. See the{" "}
						<Link to="/pricing" className="text-primary hover:underline">
							Pricing page
						</Link>{" "}
						for full details.
					</p>
				),
			},
			{
				question: "Can I cancel my subscription?",
				answer: (
					<p>
						Yes, you can cancel anytime from your Profile settings. Your access
						continues until the end of the current billing period — no partial
						refunds, but no surprise charges either.
					</p>
				),
			},
			{
				question: "Is there a free trial?",
				answer: (
					<p>
						There is no time-limited trial, but the Free tier is available
						permanently with core tracking features. You can upgrade to a paid
						tier whenever you&apos;re ready for advanced analytics and premium
						features.
					</p>
				),
			},
		],
	},
	{
		title: "Data & Privacy",
		items: [
			{
				question: "How is my data stored?",
				answer: (
					<p>
						Your data is stored securely on Supabase (hosted in the AU region),
						encrypted at rest and in transit. We follow industry best practices
						for data protection. Read our{" "}
						<Link to="/privacy" className="text-primary hover:underline">
							Privacy Policy
						</Link>{" "}
						for full details on data handling and your rights.
					</p>
				),
			},
			{
				question: "Can I export my data?",
				answer: (
					<p>
						Yes. In compliance with GDPR, you can export all your personal data
						from Profile settings. The export generates a ZIP file containing
						your workouts, analytics, routines, and account information.
					</p>
				),
			},
			{
				question: "Can I delete my account?",
				answer: (
					<p>
						Yes. You can request account deletion from Profile settings.
						There&apos;s a 30-day grace period during which you can reverse the
						decision. After that, all your data is permanently removed from our
						systems.
					</p>
				),
			},
		],
	},
	{
		title: "Training & Features",
		items: [
			{
				question: "How does workout syncing work?",
				answer: (
					<p>
						When you complete a workout on your Vitruvian Trainer, the mobile
						app sends the data to Supabase. The portal picks up changes in
						real-time via broadcast, so your latest sessions appear almost
						instantly on the dashboard.
					</p>
				),
			},
			{
				question: "What analytics are available?",
				answer: (
					<p>
						Depending on your subscription tier, you can access force curves,
						velocity trends, muscle balance analysis, and progressive overload
						tracking. Premium tiers unlock biomechanics analysis and session
						replay for deeper training insights.
					</p>
				),
			},
			{
				question: "Can I share routines with the community?",
				answer: (
					<p>
						Yes! You can share your routines and training cycles in the
						Community section. Other users can browse, save, and adapt shared
						routines for their own training.
					</p>
				),
			},
		],
	},
	{
		title: "Troubleshooting",
		items: [
			{
				question: "My workouts aren't showing up",
				answer: (
					<p>
						First, check that the mobile app has an active connection to the
						internet. Ensure your account is linked between the app and the
						portal (same email address). Workout data syncs whenever the app has
						connectivity — if you trained offline, data will appear once
						you&apos;re back online.
					</p>
				),
			},
			{
				question: "I can't access premium features",
				answer: (
					<p>
						Verify your subscription status in Profile settings. If your
						subscription appears active but features are locked, try signing out
						and back in to refresh your session. If the issue persists, open a
						GitHub issue (see below).
					</p>
				),
			},
		],
	},
];

export function FAQ() {
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
					{/* Page heading */}
					<div className="flex items-center gap-3 mb-2">
						<HelpCircle className="w-8 h-8 text-primary" />
						<h1 className="text-4xl sm:text-5xl">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Frequently Asked Questions
							</span>
						</h1>
					</div>
					<p className="text-xl text-muted-foreground mb-12">
						Find answers to common questions about Phoenix Portal, your training
						data, and account management.
					</p>

					{/* FAQ categories */}
					<div className="space-y-10">
						{faqCategories.map((category) => (
							<section key={category.title}>
								<h2 className="text-2xl font-semibold text-white mb-4">
									{category.title}
								</h2>
								<Accordion type="single" collapsible className="w-full">
									{category.items.map((item, index) => (
										<AccordionItem
											key={`${category.title}-${index}`}
											value={`${category.title}-${index}`}
										>
											<AccordionTrigger className="text-base">
												{item.question}
											</AccordionTrigger>
											<AccordionContent className="text-muted-foreground leading-relaxed">
												{item.answer}
											</AccordionContent>
										</AccordionItem>
									))}
								</Accordion>
							</section>
						))}
					</div>

					{/* Contact section */}
					<div className="mt-16">
						<Card className="border-primary/20 bg-card/50">
							<CardHeader>
								<div className="flex items-center gap-3">
									<MessageSquare className="w-6 h-6 text-primary" />
									<CardTitle className="text-2xl font-semibold">
										Still Need Help?
									</CardTitle>
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-3">
									<div className="flex items-start gap-3">
										<ExternalLink className="w-5 h-5 text-primary mt-0.5 shrink-0" />
										<div>
											<p className="font-medium text-white">GitHub Issues</p>
											<p className="text-muted-foreground text-sm">
												For bug reports, feature requests, and technical
												support, open an issue on our GitHub repository. This is
												the primary support channel.
											</p>
											<a
												href="https://github.com/dasBlueworker/phoenix-portal/issues"
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 text-primary hover:underline text-sm mt-1"
											>
												Open an issue on GitHub
												<ExternalLink className="w-3.5 h-3.5" />
											</a>
										</div>
									</div>

									<div className="flex items-start gap-3">
										<MessageSquare className="w-5 h-5 text-primary mt-0.5 shrink-0" />
										<div>
											<p className="font-medium text-white">Community</p>
											<p className="text-muted-foreground text-sm">
												For workout-related questions, training advice, and
												routine sharing, check out the Community section inside
												the app. Fellow Phoenix users are happy to help.
											</p>
										</div>
									</div>
								</div>

								<p className="text-xs text-muted-foreground pt-2 border-t border-border">
									Phoenix Portal is a solo-developer community project. GitHub
									issues are monitored regularly and are the fastest way to get
									a response.
								</p>
							</CardContent>
						</Card>
					</div>
				</motion.div>
			</main>
		</div>
	);
}
