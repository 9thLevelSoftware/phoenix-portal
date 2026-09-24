import { useQuery } from "@tanstack/react-query";
import {
	Award,
	BarChart3,
	ChevronDown,
	CreditCard,
	Dumbbell,
	Flame,
	HeartPulse,
	History,
	LayoutDashboard,
	Link2,
	LogOut,
	Repeat,
	Settings,
	Target,
	Trophy,
	User,
	Users,
} from "lucide-react";
import * as React from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";
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
import { profileOptions } from "@/queries/profile";
import { useUIStore } from "@/stores/useUIStore";
import { LocalProfileFilter } from "./LocalProfileFilter";
import { PhoenixLogo } from "./PhoenixLogo";
import { ThemeToggle } from "./ThemeToggle";
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
			{ path: "/leaderboard", label: "Leaderboard", icon: Award },
			{ path: "/community", label: "Community", icon: Users },
			{ path: "/challenges", label: "Challenges", icon: Trophy },
		],
	},
	{
		// In the scrollable content, not the footer: a tall footer squeezed
		// the nav into a scroll area on short (720px) viewports.
		label: "Account",
		items: [
			{ path: "/profile", label: "Profile", icon: User },
			{ path: "/profile?tab=settings", label: "Settings", icon: Settings },
			{ path: "/integrations", label: "Integrations", icon: Link2 },
			{ path: "/pricing", label: "Subscription", icon: CreditCard },
		],
	},
];

// ---------------------------------------------------------------------------
// Auto-collapse hook — collapses below 1280px, restores user preference above
// ---------------------------------------------------------------------------

const SIDEBAR_PREF_KEY = "phoenix-sidebar-preferred-open";
const NARROW_VIEWPORT = "(max-width: 1279px)";

function readOpenPreference(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_PREF_KEY) !== "false"; // default open
	} catch {
		return true;
	}
}

function writeOpenPreference(open: boolean) {
	try {
		localStorage.setItem(SIDEBAR_PREF_KEY, String(open));
	} catch {
		// Storage blocked: the preference just isn't remembered.
	}
}

/**
 * Collapse below 1280px and restore the user's own choice above it.
 *
 * The viewport logic runs on mount and on breakpoint changes only. It used to
 * be an effect keyed on shadcn's `setOpen`, whose identity changes with every
 * open/close, so each toggle re-applied the (not yet updated) stored
 * preference and the sidebar flipped back and forth: below 1280px it could
 * never be expanded, and above it Ctrl/Cmd+B oscillated.
 */
function useAutoCollapse() {
	const { open, setOpen } = useSidebar();
	const setOpenRef = React.useRef(setOpen);
	const openRef = React.useRef(open);
	// Set when the viewport, not the user, changed `open`, so that change is
	// not persisted as the user's preference.
	const autoChangeRef = React.useRef(false);

	React.useEffect(() => {
		setOpenRef.current = setOpen;
		openRef.current = open;
	});

	React.useEffect(() => {
		const mql = window.matchMedia(NARROW_VIEWPORT);
		const apply = (narrow: boolean) => {
			const next = narrow ? false : readOpenPreference();
			if (next === openRef.current) return;
			autoChangeRef.current = true;
			setOpenRef.current(next);
		};
		apply(mql.matches);
		const handleChange = (event: MediaQueryListEvent) => apply(event.matches);
		mql.addEventListener("change", handleChange);
		return () => mql.removeEventListener("change", handleChange);
	}, []);

	React.useEffect(() => {
		if (autoChangeRef.current) {
			autoChangeRef.current = false;
			return;
		}
		writeOpenPreference(open);
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
	const [trainOpen, setTrainOpen] = React.useState(true);

	useAutoCollapse();

	const userId = user?.id ?? "";
	const { data: profile } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});
	const displayName =
		profile?.display_name ?? user?.email?.split("@")[0] ?? "User";
	const initials = displayName
		.split(" ")
		.map((part: string) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
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
						{/* Link, not NavLink: NavLink ignores the query string and sets
						    aria-current itself when passed undefined, so /profile and
						    /profile?tab=settings would both claim the current page. */}
						<Link
							to={item.path}
							className="relative"
							aria-label={item.label}
							aria-current={isActive ? "page" : undefined}
						>
							<item.icon aria-hidden="true" className="shrink-0" />
							<span className="group-data-[collapsible=icon]:hidden">
								{item.label}
							</span>
							{isActive && (
								<span className="absolute left-0 top-1 bottom-1 w-[3px] bg-primary rounded-full group-data-[collapsible=icon]:hidden" />
							)}
						</Link>
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
							// In icon mode the label (and its toggle) is hidden, so the
							// group is forced open or its links would be unreachable.
							<Collapsible
								open={isCollapsed || trainOpen}
								onOpenChange={setTrainOpen}
								className="group/collapsible"
							>
								<SidebarGroup>
									<SidebarGroupLabel
										asChild
										className="eyebrow text-muted-foreground"
									>
										<CollapsibleTrigger className="w-full justify-between">
											{group.label}
											<ChevronDown
												aria-hidden="true"
												className="transition-transform group-data-[state=open]/collapsible:rotate-180"
											/>
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
				<Link
					to="/profile"
					aria-label={`${displayName} profile`}
					className="mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
				>
					<Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/40">
						<AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
							{initials}
						</AvatarFallback>
					</Avatar>
					<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 group-data-[collapsible=icon]:hidden">
						<span className="truncate font-medium text-sidebar-foreground">
							{displayName}
						</span>
						<div className="flex items-center gap-2">
							<TierBadge className="text-[10px] py-0 h-4" />
							{streak > 0 && (
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<Flame
										aria-hidden="true"
										className="h-3 w-3 text-primary fill-primary"
									/>
									{streak}
									<span className="sr-only">day streak</span>
								</span>
							)}
						</div>
					</div>
				</Link>
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
							<LogOut aria-hidden="true" className="shrink-0" />
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
