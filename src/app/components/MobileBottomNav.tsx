import {
	Activity,
	Award,
	BarChart3,
	Dumbbell,
	Flame,
	History,
	LayoutDashboard,
	Link2,
	MoreHorizontal,
	Repeat,
	Trophy,
	User,
	Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/app/components/ui/drawer";
import { useUIStore } from "@/stores/useUIStore";
import { PHOENIX } from "@/lib/colors";

const primaryItems = [
	{ path: "/dashboard", label: "Home", icon: LayoutDashboard },
	{ path: "/history", label: "History", icon: History },
	{ path: "/analytics", label: "Analytics", icon: BarChart3 },
	{ path: "/profile", label: "Profile", icon: User },
];

const moreItems = [
	{ path: "/records", label: "Records", icon: Award },
	{ path: "/biomechanics", label: "Biomechanics", icon: Activity },
	{ path: "/challenges", label: "Challenges", icon: Trophy },
	{ path: "/community", label: "Community", icon: Users },
	{ path: "/routines", label: "Routines", icon: Dumbbell },
	{ path: "/cycles", label: "Cycles", icon: Repeat },
	{ path: "/integrations", label: "Integrations", icon: Link2 },
];

export function MobileBottomNav() {
	const [moreOpen, setMoreOpen] = useState(false);
	const location = useLocation();
	const streak = useUIStore((s) => s.streak);
	const notifications = useUIStore((s) => s.notifications);

	const isMoreActive = moreItems.some(
		(item) => location.pathname === item.path,
	);

	return (
		<nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-secondary pb-safe">
			<div className="flex items-center justify-around px-2 py-2 max-w-screen-xl mx-auto">
				{primaryItems.map((item) => (
					<NavLink
						key={item.path}
						to={item.path}
						className="relative flex flex-col items-center gap-1 py-2 px-3 min-w-[60px] transition-colors"
					>
						{({ isActive }) => {
							const Icon = item.icon;
							const hasNotification =
								(item.path === "/challenges" && notifications.challenges) ||
								(item.path === "/community" && notifications.community);

							return (
								<>
									{/* Active indicator line */}
									{isActive && (
										<motion.div
											layoutId="activeMobileTab"
											className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-chart-2 rounded-full"
											transition={{
												type: "spring",
												stiffness: 500,
												damping: 30,
											}}
										/>
									)}

									{/* Icon with notification badge */}
									<div className="relative">
										<Icon
											className={`w-6 h-6 transition-all ${
												isActive ? "text-primary scale-110" : "text-muted-foreground"
											}`}
										/>

										{/* Notification badge */}
										{hasNotification && (
											<motion.span
												initial={{ scale: 0 }}
												animate={{ scale: 1 }}
												className="absolute -top-1 -right-1 w-4 h-4 bg-chart-2 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
											>
												{item.path === "/challenges" && notifications.challenges
													? notifications.challenges
													: notifications.community}
											</motion.span>
										)}

										{/* Streak indicator on dashboard */}
										{item.path === "/dashboard" && streak > 0 && !isActive && (
											<motion.div
												className="absolute -top-2 -right-2"
												animate={{
													scale: [1, 1.2, 1],
												}}
												transition={{
													duration: 2,
													repeat: Infinity,
													ease: "easeInOut",
												}}
											>
												<Flame
													className="w-3 h-3 text-accent"
													fill={PHOENIX.ember}
												/>
											</motion.div>
										)}
									</div>

									{/* Label */}
									<motion.span
										className={`text-xs transition-all ${
											isActive ? "text-primary font-medium" : "text-muted-foreground"
										}`}
										animate={{
											opacity: isActive ? 1 : 0.8,
											y: isActive ? 0 : 1,
										}}
									>
										{item.label}
									</motion.span>

									{/* Active glow effect */}
									{isActive && (
										<motion.div
											className="absolute inset-0 bg-primary/10 rounded-lg -z-10"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
										/>
									)}
								</>
							);
						}}
					</NavLink>
				))}

				{/* More button with drawer */}
				<Drawer open={moreOpen} onOpenChange={setMoreOpen}>
					<DrawerTrigger asChild>
						<button className="relative flex flex-col items-center gap-1 py-2 px-3 min-w-[60px] transition-colors">
							{/* Active indicator line when a "more" page is active */}
							{isMoreActive && (
								<motion.div
									layoutId="activeMobileTab"
									className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-chart-2 rounded-full"
									transition={{ type: "spring", stiffness: 500, damping: 30 }}
								/>
							)}

							<div className="relative">
								<MoreHorizontal
									className={`w-6 h-6 transition-all ${
										isMoreActive ? "text-primary scale-110" : "text-muted-foreground"
									}`}
								/>
							</div>

							<motion.span
								className={`text-xs transition-all ${
									isMoreActive ? "text-primary font-medium" : "text-muted-foreground"
								}`}
								animate={{
									opacity: isMoreActive ? 1 : 0.8,
									y: isMoreActive ? 0 : 1,
								}}
							>
								More
							</motion.span>

							{isMoreActive && (
								<motion.div
									className="absolute inset-0 bg-primary/10 rounded-lg -z-10"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
								/>
							)}
						</button>
					</DrawerTrigger>

					<DrawerContent className="bg-background border-secondary">
						<DrawerHeader>
							<DrawerTitle className="text-white">More Pages</DrawerTitle>
						</DrawerHeader>
						<div className="px-4 pb-6 flex flex-col gap-1">
							{moreItems.map((item) => {
								const hasNotification =
									(item.path === "/challenges" && notifications.challenges) ||
									(item.path === "/community" && notifications.community);

								return (
									<Link
										key={item.path}
										to={item.path}
										onClick={() => setMoreOpen(false)}
										className={`flex items-center gap-3 px-4 py-3 rounded-lg ${
											location.pathname === item.path
												? "bg-primary/10 text-primary"
												: "text-secondary-foreground hover:bg-secondary"
										}`}
									>
										<item.icon className="w-5 h-5" />
										<span className="text-sm font-medium">{item.label}</span>
										{hasNotification && (
											<span className="ml-auto w-5 h-5 bg-chart-2 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
												{item.path === "/challenges"
													? notifications.challenges
													: notifications.community}
											</span>
										)}
									</Link>
								);
							})}
						</div>
					</DrawerContent>
				</Drawer>
			</div>

			{/* Safe area for devices with notches/home indicators */}
			<div className="h-safe-area-inset-bottom bg-background" />
		</nav>
	);
}
