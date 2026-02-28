import type { LucideIcon } from "lucide-react";
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
	Users,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { TierBadge } from "@/app/components/TierBadge";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "@/app/components/ui/navigation-menu";
import { cn } from "@/app/components/ui/utils";
import { useAuth } from "@/app/hooks/useAuth";
import { PHOENIX } from "@/lib/colors";
import { useUIStore } from "@/stores/useUIStore";
import { PhoenixLogo } from "./PhoenixLogo";

interface NavItem {
	path: string;
	label: string;
	icon: LucideIcon;
}

interface NavGroup {
	label: string;
	items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
	{
		label: "Training",
		items: [
			{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
			{ path: "/history", label: "History", icon: History },
			{ path: "/analytics", label: "Analytics", icon: BarChart3 },
			{ path: "/records", label: "Records", icon: Award },
		],
	},
	{
		label: "Programs",
		items: [
			{ path: "/routines", label: "Routines", icon: Dumbbell },
			{ path: "/cycles", label: "Cycles", icon: Repeat },
			{ path: "/goals", label: "Goals", icon: Target },
			{ path: "/challenges", label: "Challenges", icon: Trophy },
		],
	},
	{
		label: "Body",
		items: [
			{ path: "/biomechanics", label: "Biomechanics", icon: Activity },
			{ path: "/recovery", label: "Recovery", icon: HeartPulse },
		],
	},
	{
		label: "Social",
		items: [
			{ path: "/community", label: "Community", icon: Users },
			{ path: "/integrations", label: "Integrations", icon: Link2 },
		],
	},
];

export function Navigation() {
	const { signOut } = useAuth();
	const streak = useUIStore((s) => s.streak);
	const [signingOut, setSigningOut] = useState(false);
	const location = useLocation();

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
					<NavigationMenu>
						<NavigationMenuList>
							{NAV_GROUPS.map((group) => {
								const isGroupActive = group.items.some(
									(item) =>
										location.pathname === item.path ||
										location.pathname.startsWith(item.path + "/"),
								);
								return (
									<NavigationMenuItem key={group.label}>
										<NavigationMenuTrigger
											className={cn(
												"bg-transparent text-secondary-foreground hover:bg-primary/10 hover:text-white data-[state=open]:bg-primary/10",
												isGroupActive && "text-white",
											)}
										>
											{group.label}
										</NavigationMenuTrigger>
										<NavigationMenuContent>
											<ul className="grid w-[240px] gap-1 p-2">
												{group.items.map((item) => (
													<li key={item.path}>
														<NavigationMenuLink asChild>
															<NavLink
																to={item.path}
																className={({ isActive }) =>
																	cn(
																		"flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
																		"text-secondary-foreground hover:bg-primary/10 hover:text-white",
																		isActive && "bg-primary/10 text-white",
																	)
																}
															>
																<item.icon className="w-4 h-4" />
																{item.label}
															</NavLink>
														</NavigationMenuLink>
													</li>
												))}
											</ul>
										</NavigationMenuContent>
									</NavigationMenuItem>
								);
							})}
						</NavigationMenuList>
					</NavigationMenu>

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
