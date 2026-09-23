import {
	BarChart3,
	Dumbbell,
	Flame,
	History,
	LayoutDashboard,
	User,
} from "lucide-react";
import { motion } from "motion/react";
import { NavLink, useLocation } from "react-router";
import { PHOENIX } from "@/lib/colors";
import { useUIStore } from "@/stores/useUIStore";

const primaryItems = [
	{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ path: "/history", label: "Workouts", icon: History },
	{ path: "/routines", label: "Routines", icon: Dumbbell },
	{ path: "/analytics", label: "Analytics", icon: BarChart3 },
	{ path: "/profile", label: "Profile", icon: User },
];

export function MobileBottomNav() {
	const location = useLocation();
	const streak = useUIStore((s) => s.streak);

	const isItemActive = (path: string) =>
		location.pathname === path ||
		(path !== "/dashboard" && location.pathname.startsWith(`${path}/`));

	return (
		<nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-1 border-t border-secondary pb-safe">
			<div className="flex items-center justify-around px-2 py-2 max-w-screen-xl mx-auto">
				{primaryItems.map((item) => {
					const isActive = isItemActive(item.path);
					const Icon = item.icon;

					return (
						<NavLink
							key={item.path}
							to={item.path}
							aria-current={isActive ? "page" : undefined}
							className="relative flex min-h-11 flex-col items-center justify-center gap-1 py-2 px-3 min-w-[60px] transition-colors"
						>
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
									aria-hidden="true"
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
											aria-hidden="true"
											className="w-3 h-3 text-accent"
											fill={PHOENIX().ember}
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
						</NavLink>
					);
				})}
			</div>

			{/* Safe area for devices with notches/home indicators */}
			<div className="h-safe-area-inset-bottom bg-background" />
		</nav>
	);
}
