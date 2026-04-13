import {
	Award,
	BarChart3,
	CreditCard,
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
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/app/components/ui/drawer";
import { PHOENIX } from "@/lib/colors";
import { useUIStore } from "@/stores/useUIStore";

const primaryItems = [
	{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ path: "/history", label: "Workouts", icon: History },
	{ path: "/analytics", label: "Analytics", icon: BarChart3 },
	{ path: "/community", label: "Community", icon: Users },
];

const moreGroups = [
	{
		label: "Training",
		items: [
			{ path: "/routines", label: "Routines", icon: Dumbbell },
			{ path: "/cycles", label: "Cycles", icon: Repeat },
		],
	},
	{
		label: "Social",
		items: [
			{ path: "/challenges", label: "Challenges", icon: Trophy },
			{ path: "/leaderboard", label: "Leaderboard", icon: Award },
		],
	},
	{
		label: "Account",
		items: [
			{ path: "/profile", label: "Profile", icon: User },
			{ path: "/integrations", label: "Integrations", icon: Link2 },
			{ path: "/pricing", label: "Subscription", icon: CreditCard },
		],
	},
];

// Flat list of all "more" paths for active state detection
const moreItemPaths = moreGroups.flatMap((g) => g.items.map((i) => i.path));

export function MobileBottomNav() {
	const [moreOpen, setMoreOpen] = useState(false);
	const location = useLocation();
	const streak = useUIStore((s) => s.streak);

	const isMoreActive = moreItemPaths.some((path) => location.pathname === path);

	// Handle browser back button to close drawer
	const handleDrawerChange = useCallback((open: boolean) => {
		if (open) {
			// Push a history entry so the back button can close the drawer
			window.history.pushState({ moreDrawer: true }, "");
		} else {
			// If closing programmatically (not via popstate), clean up the history entry
			if (window.history.state?.moreDrawer) {
				window.history.back();
			}
		}
		setMoreOpen(open);
	}, []);

	useEffect(() => {
		function onPopState() {
			if (moreOpen) {
				setMoreOpen(false);
			}
		}

		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [moreOpen]);

	const closeDrawer = () => setMoreOpen(false);

	return (
		<nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-1 border-t border-secondary pb-safe">
			<div className="flex items-center justify-around px-2 py-2 max-w-screen-xl mx-auto">
				{primaryItems.map((item) => (
					<NavLink
						key={item.path}
						to={item.path}
						className="relative flex flex-col items-center gap-1 py-2 px-3 min-w-[60px] transition-colors"
					>
						{({ isActive }) => {
							const Icon = item.icon;

							return (
								<>
									{/* Active indicator line */}
									{isActive && (
										<motion.div
											layoutId="activeMobileTab"
											className="absolute top-0 left-0 right-0 h-0.5 bg-primary rounded-full"
											transition={{
												type: "spring",
												stiffness: 500,
												damping: 30,
											}}
										/>
									)}

									{/* Icon */}
									<div className="relative">
										<Icon
											className={`w-6 h-6 transition-all ${
												isActive
													? "text-primary scale-110"
													: "text-muted-foreground"
											}`}
										/>

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
											isActive
												? "text-primary font-medium"
												: "text-muted-foreground"
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
				<Drawer open={moreOpen} onOpenChange={handleDrawerChange}>
					<DrawerTrigger asChild>
						<button className="relative flex flex-col items-center gap-1 py-2 px-3 min-w-[60px] transition-colors">
							{/* Active indicator line when a "more" page is active */}
							{isMoreActive && (
								<motion.div
									layoutId="activeMobileTab"
									className="absolute top-0 left-0 right-0 h-0.5 bg-primary rounded-full"
									transition={{ type: "spring", stiffness: 500, damping: 30 }}
								/>
							)}

							<div className="relative">
								<MoreHorizontal
									className={`w-6 h-6 transition-all ${
										isMoreActive
											? "text-primary scale-110"
											: "text-muted-foreground"
									}`}
								/>
							</div>

							<motion.span
								className={`text-xs transition-all ${
									isMoreActive
										? "text-primary font-medium"
										: "text-muted-foreground"
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
							<DrawerTitle className="text-white">More</DrawerTitle>
						</DrawerHeader>
						<div className="pb-8">
							{moreGroups.map((group) => (
								<div key={group.label}>
									<p className="eyebrow text-muted-foreground px-4 pt-4 pb-1">
										{group.label}
									</p>
									{group.items.map((item) => {
										const Icon = item.icon;
										const isActive = location.pathname === item.path;
										return (
											<Link
												key={item.path}
												to={item.path}
												onClick={closeDrawer}
												className={`flex items-center gap-3 px-4 py-3 transition-colors ${
													isActive
														? "bg-primary/10 text-primary"
														: "text-secondary-foreground hover:bg-secondary"
												}`}
											>
												<Icon className="h-5 w-5" />
												<span className="text-sm font-medium">
													{item.label}
												</span>
											</Link>
										);
									})}
								</div>
							))}
						</div>
					</DrawerContent>
				</Drawer>
			</div>

			{/* Safe area for devices with notches/home indicators */}
			<div className="h-safe-area-inset-bottom bg-background" />
		</nav>
	);
}
