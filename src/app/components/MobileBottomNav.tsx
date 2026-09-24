import {
	Award,
	BarChart3,
	CreditCard,
	Dumbbell,
	Flame,
	HeartPulse,
	History,
	LayoutDashboard,
	Link2,
	type LucideIcon,
	MoreHorizontal,
	Repeat,
	Target,
	Trophy,
	User,
	Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/app/components/ui/drawer";
import { useUIStore } from "@/stores/useUIStore";

const primaryItems = [
	{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ path: "/history", label: "Workouts", icon: History },
	{ path: "/routines", label: "Routines", icon: Dumbbell },
	{ path: "/analytics", label: "Analytics", icon: BarChart3 },
];

// Every other destination the desktop sidebar offers. The bottom bar has room
// for four tabs plus "More", and the sidebar cannot be opened on phones, so
// anything missing here is unreachable on mobile.
const moreGroups: Array<{
	label: string;
	items: Array<{ path: string; label: string; icon: LucideIcon }>;
}> = [
	{
		label: "Training",
		items: [
			{ path: "/goals", label: "Goals", icon: Target },
			{ path: "/recovery", label: "Recovery", icon: HeartPulse },
			{ path: "/cycles", label: "Cycles", icon: Repeat },
		],
	},
	{
		label: "Social",
		items: [
			{ path: "/community", label: "Community", icon: Users },
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

const moreItemPaths = moreGroups.flatMap((g) => g.items.map((i) => i.path));

function matchesPath(pathname: string, path: string) {
	return (
		pathname === path ||
		(path !== "/dashboard" && pathname.startsWith(`${path}/`))
	);
}

function TabIndicator() {
	return (
		<>
			<motion.div
				layoutId="activeMobileTab"
				className="absolute top-0 left-0 right-0 h-0.5 bg-primary rounded-full"
				transition={{ type: "spring", stiffness: 500, damping: 30 }}
			/>
			<motion.div
				className="absolute inset-0 bg-primary/10 rounded-lg -z-10"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
			/>
		</>
	);
}

function TabLabel({ active, children }: { active: boolean; children: string }) {
	return (
		<motion.span
			className={`text-xs transition-colors ${
				active ? "text-primary font-medium" : "text-muted-foreground"
			}`}
			animate={{ opacity: active ? 1 : 0.8, y: active ? 0 : 1 }}
		>
			{children}
		</motion.span>
	);
}

const tabClassName =
	"relative flex min-h-11 flex-col items-center justify-center gap-1 py-2 px-3 min-w-[60px] transition-colors";

export function MobileBottomNav() {
	const [moreOpen, setMoreOpen] = useState(false);
	const location = useLocation();
	const streak = useUIStore((s) => s.streak);

	const isMoreActive = moreItemPaths.some((path) =>
		matchesPath(location.pathname, path),
	);

	// The browser back button closes the drawer instead of leaving the page.
	const handleDrawerChange = useCallback((open: boolean) => {
		if (open) {
			window.history.pushState({ moreDrawer: true }, "");
		} else if (window.history.state?.moreDrawer) {
			window.history.back();
		}
		setMoreOpen(open);
	}, []);

	useEffect(() => {
		if (!moreOpen) return;
		const onPopState = () => setMoreOpen(false);
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [moreOpen]);

	const closeDrawer = () => setMoreOpen(false);

	return (
		<nav
			aria-label="Primary"
			className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-1 border-t border-secondary pb-safe"
		>
			<div className="flex items-center justify-around px-2 py-2 max-w-screen-xl mx-auto">
				{primaryItems.map((item) => {
					const isActive = matchesPath(location.pathname, item.path);
					const Icon = item.icon;

					return (
						<NavLink
							key={item.path}
							to={item.path}
							aria-current={isActive ? "page" : undefined}
							className={tabClassName}
						>
							{isActive && <TabIndicator />}
							<div className="relative">
								<Icon
									aria-hidden="true"
									className={`w-6 h-6 transition-transform ${
										isActive
											? "text-primary scale-110"
											: "text-muted-foreground"
									}`}
								/>
								{item.path === "/dashboard" && streak > 0 && !isActive && (
									<motion.div
										className="absolute -top-2 -right-2"
										animate={{ scale: [1, 1.2, 1] }}
										transition={{
											duration: 2,
											repeat: Infinity,
											ease: "easeInOut",
										}}
									>
										<Flame
											aria-hidden="true"
											className="w-3 h-3 text-accent fill-primary"
										/>
									</motion.div>
								)}
							</div>
							<TabLabel active={isActive}>{item.label}</TabLabel>
						</NavLink>
					);
				})}

				<Drawer open={moreOpen} onOpenChange={handleDrawerChange}>
					<DrawerTrigger asChild>
						<button type="button" className={tabClassName}>
							{isMoreActive && <TabIndicator />}
							<MoreHorizontal
								aria-hidden="true"
								className={`w-6 h-6 transition-transform ${
									isMoreActive
										? "text-primary scale-110"
										: "text-muted-foreground"
								}`}
							/>
							<TabLabel active={isMoreActive}>More</TabLabel>
						</button>
					</DrawerTrigger>

					<DrawerContent className="bg-background border-secondary">
						<DrawerHeader>
							<DrawerTitle className="text-foreground">More</DrawerTitle>
							<DrawerDescription className="sr-only">
								Other pages and appearance settings
							</DrawerDescription>
						</DrawerHeader>
						<nav
							aria-label="More pages"
							className="max-h-[60vh] overflow-y-auto"
						>
							{moreGroups.map((group) => (
								<div key={group.label}>
									<p className="eyebrow text-muted-foreground px-4 pt-4 pb-1">
										{group.label}
									</p>
									{group.items.map((item) => {
										const Icon = item.icon;
										const isActive = matchesPath(location.pathname, item.path);
										return (
											<Link
												key={item.path}
												to={item.path}
												onClick={closeDrawer}
												aria-current={isActive ? "page" : undefined}
												className={`flex min-h-11 items-center gap-3 px-4 py-3 transition-colors ${
													isActive
														? "bg-primary/10 text-primary"
														: "text-secondary-foreground hover:bg-secondary"
												}`}
											>
												<Icon aria-hidden="true" className="h-5 w-5" />
												<span className="text-sm font-medium">
													{item.label}
												</span>
											</Link>
										);
									})}
								</div>
							))}
						</nav>
						<div className="flex items-center justify-between gap-3 border-t border-secondary px-4 pt-3 pb-8">
							<span className="text-sm text-muted-foreground">Theme</span>
							<ThemeToggle />
						</div>
					</DrawerContent>
				</Drawer>
			</div>

			<div className="h-safe-area-inset-bottom bg-background" />
		</nav>
	);
}
