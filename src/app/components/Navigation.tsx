// DEPRECATED: Replaced by AppSidebar in Phase 15. Safe to delete after Phase 15 verification.
// No files import this component directly anymore — kept to prevent accidental import errors during development.

import {
	Activity,
	Award,
	BarChart3,
	Bell,
	Dumbbell,
	Flame,
	HeartPulse,
	History,
	LayoutDashboard,
	Link2,
	Loader2,
	LogOut,
	Repeat,
	Target,
	Trophy,
	User,
	Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link, NavLink } from "react-router";
import { TierBadge } from "@/app/components/TierBadge";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import { useAuth } from "@/app/hooks/useAuth";
import { PHOENIX } from "@/lib/colors";
import { useUIStore } from "@/stores/useUIStore";
import { PhoenixLogo } from "./PhoenixLogo";

const navItems = [
	{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ path: "/history", label: "History", icon: History },
	{ path: "/records", label: "Records", icon: Award },
	{ path: "/analytics", label: "Analytics", icon: BarChart3 },
	{ path: "/biomechanics", label: "Biomechanics", icon: Activity },
	{ path: "/challenges", label: "Challenges", icon: Trophy },
	{ path: "/goals", label: "Goals", icon: Target },
	{ path: "/recovery", label: "Recovery", icon: HeartPulse },
	{ path: "/community", label: "Community", icon: Users },
	{ path: "/routines", label: "Routines", icon: Dumbbell },
	{ path: "/cycles", label: "Cycles", icon: Repeat },
	{ path: "/integrations", label: "Integrations", icon: Link2 },
	{ path: "/profile", label: "Profile", icon: User },
];

export function Navigation() {
	const { signOut } = useAuth();
	const streak = useUIStore((s) => s.streak);
	const [signingOut, setSigningOut] = useState(false);

	return (
		<nav className="hidden md:block sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b border-secondary">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex items-center justify-between h-16">
					{/* Logo */}
					<Link
						to="/dashboard"
						className="flex items-center gap-3 cursor-pointer"
					>
						<PhoenixLogo size="sm" />
						<span className="text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
							Project Phoenix
						</span>
					</Link>

					{/* Navigation Items */}
					<div className="flex items-center gap-1">
						{navItems.map((item) => (
							<NavLink
								key={item.path}
								to={item.path}
								className={({ isActive }) =>
									`relative inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-secondary-foreground hover:text-white hover:bg-primary/10 ${
										isActive ? "text-white" : ""
									}`
								}
							>
								{({ isActive }) => (
									<>
										<item.icon className="w-4 h-4 mr-2" />
										{item.label}
										{isActive && (
											<motion.div
												layoutId="activeTab"
												className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-chart-2"
											/>
										)}
									</>
								)}
							</NavLink>
						))}
					</div>

					{/* Right Side */}
					<div className="flex items-center gap-4">
						{/* Notification Bell */}
						<Button
							variant="ghost"
							size="icon"
							aria-label="Notifications"
							className="relative hover:bg-primary/10"
						>
							<Bell className="w-5 h-5 text-secondary-foreground" />
							<span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
						</Button>

						{/* Streak Indicator */}
						<div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-primary/20 to-chart-2/20 border border-primary/50 rounded-full">
							<Flame className="w-4 h-4 text-accent" fill={PHOENIX.ember} />
							<span className="text-sm text-white">{streak} day streak</span>
						</div>

						{/* Tier Badge */}
						<TierBadge />

						{/* User Avatar */}
						<Link to="/profile">
							<Avatar className="cursor-pointer ring-2 ring-primary ring-offset-2 ring-offset-background">
								<AvatarFallback className="bg-gradient-to-br from-primary to-chart-2 text-white">
									JD
								</AvatarFallback>
							</Avatar>
						</Link>

						{/* Logout */}
						<Button
							variant="ghost"
							size="icon"
							title="Sign out"
							disabled={signingOut}
							className="hover:bg-chart-2/10 hover:text-chart-2"
							onClick={async () => {
								setSigningOut(true);
								try {
									await signOut();
								} finally {
									setSigningOut(false);
								}
							}}
						>
							{signingOut ? (
								<Loader2 className="w-5 h-5 text-secondary-foreground animate-spin" />
							) : (
								<LogOut className="w-5 h-5 text-secondary-foreground" />
							)}
						</Button>
					</div>
				</div>
			</div>
		</nav>
	);
}
