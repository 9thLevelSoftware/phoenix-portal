import {
	Award,
	BarChart3,
	CreditCard,
	Dumbbell,
	Flame,
	History,
	LayoutDashboard,
	Link2,
	Repeat,
	Trophy,
	User,
	Users,
} from "lucide-react";
import * as React from "react";
import { NavLink, useLocation } from "react-router";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
} from "@/app/components/ui/sidebar";
import { useAuth } from "@/app/hooks/useAuth";
import { PHOENIX } from "@/lib/colors";
import { useUIStore } from "@/stores/useUIStore";
import { PhoenixLogo } from "./PhoenixLogo";
import { TierBadge } from "./TierBadge";

// ---------------------------------------------------------------------------
// Nav group definitions
// ---------------------------------------------------------------------------

type NavItem = {
	path: string;
	label: string;
	icon: React.ElementType;
};

type NavGroup = {
	label: string;
	items: NavItem[];
};

const navGroups: NavGroup[] = [
	{
		label: "Training",
		items: [
			{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
			{ path: "/history", label: "Workouts", icon: History },
			{ path: "/analytics", label: "Analytics", icon: BarChart3 },
			{ path: "/routines", label: "Routines", icon: Dumbbell },
			{ path: "/cycles", label: "Cycles", icon: Repeat },
		],
	},
	{
		label: "Social",
		items: [
			{ path: "/community", label: "Community", icon: Users },
			{ path: "/challenges", label: "Challenges", icon: Trophy },
			{ path: "/records", label: "Leaderboard", icon: Award },
		],
	},
	{
		label: "Account",
		items: [
			{ path: "/profile", label: "Profile", icon: User },
			{ path: "/integrations", label: "Settings", icon: Link2 },
			{ path: "/pricing", label: "Subscription", icon: CreditCard },
		],
	},
];

// ---------------------------------------------------------------------------
// Auto-collapse hook — collapses below 1280px, restores user preference above
// ---------------------------------------------------------------------------

const SIDEBAR_PREF_KEY = "phoenix-sidebar-preferred-open";

function useAutoCollapse() {
	const { open, setOpen } = useSidebar();
	const isAutoCollapsingRef = React.useRef(false);

	// On mount: read stored preference and apply viewport-driven override
	React.useEffect(() => {
		const storedPref = localStorage.getItem(SIDEBAR_PREF_KEY);
		const userPrefersOpen = storedPref !== "false"; // default true

		const belowBreakpoint = window.matchMedia("(max-width: 1279px)").matches;
		if (belowBreakpoint) {
			isAutoCollapsingRef.current = true;
			setOpen(false);
			isAutoCollapsingRef.current = false;
		} else {
			// Restore user preference on large viewports
			isAutoCollapsingRef.current = true;
			setOpen(userPrefersOpen);
			isAutoCollapsingRef.current = false;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Watch viewport changes crossing 1280px boundary
	React.useEffect(() => {
		const mql = window.matchMedia("(max-width: 1279px)");
		const handleChange = (e: MediaQueryListEvent) => {
			if (e.matches) {
				// Dropped below 1280px — auto-collapse
				isAutoCollapsingRef.current = true;
				setOpen(false);
				isAutoCollapsingRef.current = false;
			} else {
				// Crossed above 1280px — restore preference
				const storedPref = localStorage.getItem(SIDEBAR_PREF_KEY);
				const userPrefersOpen = storedPref !== "false";
				isAutoCollapsingRef.current = true;
				setOpen(userPrefersOpen);
				isAutoCollapsingRef.current = false;
			}
		};
		mql.addEventListener("change", handleChange);
		return () => mql.removeEventListener("change", handleChange);
	}, [setOpen]);

	// Persist user preference when `open` changes — but NOT during auto-collapse
	React.useEffect(() => {
		if (!isAutoCollapsingRef.current) {
			localStorage.setItem(SIDEBAR_PREF_KEY, String(open));
		}
	}, [open]);
}

// ---------------------------------------------------------------------------
// AppSidebar
// ---------------------------------------------------------------------------

export function AppSidebar() {
	const location = useLocation();
	const { user, signOut } = useAuth();
	const streak = useUIStore((s) => s.streak);
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";

	useAutoCollapse();

	// Derive user initials from email or display name
	const displayName =
		user?.user_metadata?.full_name ??
		user?.email?.split("@")[0] ??
		"User";
	const initials = displayName
		.split(" ")
		.map((n: string) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

	return (
		<Sidebar collapsible="icon" className="border-r border-sidebar-border">
			{/* ----------------------------------------------------------------- */}
			{/* Header: Logo + wordmark                                            */}
			{/* ----------------------------------------------------------------- */}
			<SidebarHeader className="px-3 py-4">
				<NavLink
					to="/dashboard"
					className="flex items-center gap-3 cursor-pointer"
				>
					<PhoenixLogo size="sm" animated={false} />
					<span className="text-base font-semibold text-primary group-data-[collapsible=icon]:hidden whitespace-nowrap">
						Phoenix Portal
					</span>
				</NavLink>
			</SidebarHeader>

			{/* ----------------------------------------------------------------- */}
			{/* Nav groups                                                         */}
			{/* ----------------------------------------------------------------- */}
			<SidebarContent>
				{navGroups.map((group, groupIndex) => (
					<React.Fragment key={group.label}>
						{groupIndex > 0 && <SidebarSeparator />}
						<SidebarGroup>
							<SidebarGroupLabel className="eyebrow text-muted-foreground">
								{group.label}
							</SidebarGroupLabel>
							<SidebarMenu>
								{group.items.map((item) => {
									const isActive =
										location.pathname === item.path ||
										(item.path !== "/dashboard" &&
											location.pathname.startsWith(item.path));
									return (
										<SidebarMenuItem key={item.path}>
											<SidebarMenuButton
												asChild
												isActive={isActive}
												tooltip={item.label}
												size="lg"
											>
												<NavLink
													to={item.path}
													className="relative"
												>
													<item.icon className="shrink-0" />
													<span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
													{isActive && (
														<span className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-full group-data-[collapsible=icon]:hidden" />
													)}
												</NavLink>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroup>
					</React.Fragment>
				))}
			</SidebarContent>

			{/* ----------------------------------------------------------------- */}
			{/* Footer: Avatar dropdown + collapse toggle                          */}
			{/* ----------------------------------------------------------------- */}
			<SidebarFooter className="gap-1 pb-3">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors outline-none"
						>
							<Avatar className="h-8 w-8 shrink-0 ring-1 ring-primary/30">
								<AvatarFallback className="bg-gradient-to-br from-primary to-chart-2 text-white text-xs font-semibold">
									{initials}
								</AvatarFallback>
							</Avatar>

							{!isCollapsed && (
								<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 group-data-[collapsible=icon]:hidden">
									<span className="truncate font-medium text-sidebar-foreground text-sm">
										{displayName}
									</span>
									<div className="flex items-center gap-2">
										<TierBadge className="text-[10px] py-0 h-4" />
										{streak > 0 && (
											<span className="flex items-center gap-1 text-xs text-muted-foreground">
												<Flame
													className="h-3 w-3"
													color={PHOENIX.ember}
													fill={PHOENIX.ember}
												/>
												{streak}
											</span>
										)}
									</div>
								</div>
							)}
						</button>
					</DropdownMenuTrigger>

					<DropdownMenuContent
						side="right"
						align="end"
						sideOffset={8}
						className="w-48"
					>
						<DropdownMenuItem asChild>
							<NavLink to="/profile" className="cursor-pointer">
								<User className="mr-2 h-4 w-4" />
								Profile
							</NavLink>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<NavLink to="/integrations" className="cursor-pointer">
								<Link2 className="mr-2 h-4 w-4" />
								Settings
							</NavLink>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<NavLink to="/pricing" className="cursor-pointer">
								<CreditCard className="mr-2 h-4 w-4" />
								Subscription
							</NavLink>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => signOut()}
							className="text-destructive focus:text-destructive cursor-pointer"
						>
							Logout
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Collapse toggle */}
				<div className="flex justify-center">
					<SidebarTrigger className="text-muted-foreground hover:text-foreground" />
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
