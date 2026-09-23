import {
	BarChart3,
	ChevronDown,
	Dumbbell,
	HeartPulse,
	History,
	LayoutDashboard,
	Repeat,
	Settings,
	Target,
	Trophy,
	User,
	Users,
} from "lucide-react";
import * as React from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
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
import { LocalProfileFilter } from "./LocalProfileFilter";
import { PhoenixLogo } from "./PhoenixLogo";
import { ThemeToggle } from "./ThemeToggle";

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
	collapsible?: boolean;
};

const navGroups: NavGroup[] = [
	{
		label: "Train",
		collapsible: true,
		items: [
			{ path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
			{ path: "/history", label: "Workouts", icon: History },
			{ path: "/routines", label: "Routines", icon: Dumbbell },
			{ path: "/cycles", label: "Training Cycles", icon: Repeat },
			{ path: "/goals", label: "Goals", icon: Target },
			{ path: "/recovery", label: "Recovery", icon: HeartPulse },
		],
	},
	{
		label: "Explore",
		items: [
			{ path: "/analytics", label: "Analytics", icon: BarChart3 },
			{ path: "/leaderboard", label: "Leaderboard", icon: Trophy },
			{ path: "/community", label: "Community", icon: Users },
			{ path: "/challenges", label: "Challenges", icon: Trophy },
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
	}, [setOpen]);

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
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";

	useAutoCollapse();

	const userId = user?.id ?? "";
	const isNavItemActive = (item: NavItem) => {
		const fullPath = `${location.pathname}${location.search}`;

		// Exact match on path+search — most specific wins
		if (item.path.includes("?")) {
			return fullPath === item.path;
		}

		if (location.pathname !== item.path) {
			// Prefix-match for nested routes (not /dashboard itself)
			return (
				item.path !== "/dashboard" &&
				location.pathname.startsWith(`${item.path}/`)
			);
		}

		// The specific Settings link owns this profile query state.
		if (item.path === "/profile" && location.search === "?tab=settings") {
			return false;
		}

		return true;
	};

	const renderNavItems = (items: NavItem[]) =>
		items.map((item) => {
			const isActive = isNavItemActive(item);
			return (
				<SidebarMenuItem key={item.path}>
					<SidebarMenuButton
						asChild
						isActive={isActive}
						tooltip={item.label}
						size="lg"
						className={
							isActive
								? "group-data-[collapsible=icon]:ring-1 group-data-[collapsible=icon]:ring-primary/20"
								: undefined
						}
					>
						<NavLink
							to={item.path}
							className="relative"
							aria-label={item.label}
							aria-current={isActive ? "page" : undefined}
						>
							<item.icon className="shrink-0" />
							<span className="group-data-[collapsible=icon]:hidden">
								{item.label}
							</span>
							{isActive && (
								<span className="absolute left-0 top-1 bottom-1 w-[3px] bg-primary rounded-full group-data-[collapsible=icon]:hidden" />
							)}
						</NavLink>
					</SidebarMenuButton>
				</SidebarMenuItem>
			);
		});

	return (
		<Sidebar collapsible="icon" className="border-r border-sidebar-border">
			{/* ----------------------------------------------------------------- */}
			{/* Header: Logo + wordmark                                            */}
			{/* ----------------------------------------------------------------- */}
			<SidebarHeader className="px-3 py-4 group-data-[collapsible=icon]:px-0">
				<div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
					<NavLink
						to="/dashboard"
						className="flex items-center gap-3 cursor-pointer"
					>
						<PhoenixLogo size="sm" animated={false} />
						<span className="text-base font-semibold text-primary group-data-[collapsible=icon]:hidden whitespace-nowrap">
							Phoenix Portal
						</span>
					</NavLink>
					<SidebarTrigger className="ml-auto text-muted-foreground hover:text-primary transition-colors group-data-[collapsible=icon]:hidden" />
				</div>
				<div className="hidden group-data-[collapsible=icon]:flex justify-center mt-1">
					<SidebarTrigger className="text-muted-foreground hover:text-primary transition-colors" />
				</div>
			</SidebarHeader>

			{/* ----------------------------------------------------------------- */}
			{/* Profile filter (hidden when collapsed — unusable at icon size)     */}
			{/* ----------------------------------------------------------------- */}
			{userId && !isCollapsed && <LocalProfileFilter userId={userId} />}

			{/* ----------------------------------------------------------------- */}
			{/* Nav groups                                                         */}
			{/* ----------------------------------------------------------------- */}
			<SidebarContent>
				{navGroups.map((group, groupIndex) => (
					<React.Fragment key={group.label}>
						{groupIndex > 0 && (
							<SidebarSeparator className="sidebar-separator-phoenix" />
						)}
						{group.collapsible ? (
							<Collapsible defaultOpen>
								<SidebarGroup>
									<SidebarGroupLabel
										asChild
										className="eyebrow text-muted-foreground"
									>
										<CollapsibleTrigger className="w-full justify-between">
											{group.label}
											<ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
										</CollapsibleTrigger>
									</SidebarGroupLabel>
									<CollapsibleContent>
										<SidebarMenu>{renderNavItems(group.items)}</SidebarMenu>
									</CollapsibleContent>
								</SidebarGroup>
							</Collapsible>
						) : (
							<SidebarGroup>
								<SidebarGroupLabel className="eyebrow text-muted-foreground">
									{group.label}
								</SidebarGroupLabel>
								<SidebarMenu>{renderNavItems(group.items)}</SidebarMenu>
							</SidebarGroup>
						)}
					</React.Fragment>
				))}
			</SidebarContent>

			{/* ----------------------------------------------------------------- */}
			{/* Footer: account navigation, theme controls, and sign out             */}
			{/* ----------------------------------------------------------------- */}
			<SidebarFooter className="gap-1 pb-3 group-data-[collapsible=icon]:px-0">
				<SidebarSeparator className="sidebar-separator-phoenix" />
				<SidebarGroup className="p-2">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={isNavItemActive({
									path: "/profile",
									label: "Profile",
									icon: User,
								})}
								tooltip="Profile"
								size="lg"
							>
								<Link
									to="/profile"
									aria-label="Profile"
									aria-current={
										isNavItemActive({
											path: "/profile",
											label: "Profile",
											icon: User,
										})
											? "page"
											: undefined
									}
								>
									<User className="shrink-0" />
									<span className="group-data-[collapsible=icon]:hidden">
										Profile
									</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={isNavItemActive({
									path: "/profile?tab=settings",
									label: "Settings",
									icon: Settings,
								})}
								tooltip="Settings"
								size="lg"
							>
								<NavLink
									to="/profile?tab=settings"
									aria-label="Settings"
									aria-current={
										isNavItemActive({
											path: "/profile?tab=settings",
											label: "Settings",
											icon: Settings,
										})
											? "page"
											: undefined
									}
								>
									<Settings className="shrink-0" />
									<span className="group-data-[collapsible=icon]:hidden">
										Settings
									</span>
								</NavLink>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				<div className="flex items-center justify-between px-2 py-1 group-data-[collapsible=icon]:hidden">
					<span className="text-sm text-muted-foreground">Theme</span>
					<ThemeToggle />
				</div>
				<SidebarMenu className="px-2">
					<SidebarMenuItem>
						<SidebarMenuButton
							type="button"
							size="lg"
							onClick={() => signOut()}
							tooltip="Sign out"
							className="text-destructive hover:text-destructive"
						>
							<span className="group-data-[collapsible=icon]:hidden">
								Sign out
							</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
