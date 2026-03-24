import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
	Award,
	Bell,
	Calendar,
	Camera,
	CreditCard,
	Dumbbell,
	Flame,
	Globe,
	Loader2,
	LogOut,
	Shield,
	Trophy,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PageShell } from "@/app/components/PageShell";
import { DangerZone } from "@/app/components/profile/DangerZone";
import { ExportSection } from "@/app/components/profile/ExportSection";
import { TierBadge } from "@/app/components/TierBadge";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/app/components/ui/avatar";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Switch } from "@/app/components/ui/switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useAuth } from "@/app/hooks/useAuth";
import { useStreak } from "@/hooks/useStreak";
import { useSubscription } from "@/hooks/useSubscription";
import { PHOENIX } from "@/lib/colors";
import { supabase } from "@/lib/supabase";
import { formatVolume } from "@/lib/units";
import { useUpdateProfile } from "@/mutations/profile";
import { integrationsOptions } from "@/queries/integrations";
import { queryKeys } from "@/queries/keys";
import {
	earnedBadgesOptions,
	gamificationStatsOptions,
	profileOptions,
	profileStatsOptions,
	rpgAttributesOptions,
	topExercisesOptions,
} from "@/queries/profile";
import { workoutListOptions } from "@/queries/workouts";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

const PLAN_LABELS: Record<string, string> = {
	FREE: "No Active Subscription",
	EMBER: "Ember Plan",
	INFERNO: "Inferno Plan",
};

/** Provider display config for integrations tab */
const PROVIDER_META: Record<string, { label: string; logo: string }> = {
	strava: { label: "Strava", logo: "S" },
	fitbit: { label: "Fitbit", logo: "F" },
	garmin: { label: "Garmin Connect", logo: "G" },
	hevy: { label: "Hevy", logo: "H" },
	strong: { label: "Strong", logo: "S" },
	apple_health: { label: "Apple Health", logo: "A" },
};

/** Get initials from a display name or email */
function getInitials(name: string | null | undefined): string {
	if (!name) return "?";
	const parts = name.trim().split(/\s+/);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}
	return name.slice(0, 2).toUpperCase();
}

export function Profile() {
	const { user, signOut } = useAuth();
	const userId = user?.id ?? "";
	const {
		tier,
		status: subStatus,
		currentPeriodEnd,
		cancelAtPeriodEnd,
	} = useSubscription();
	const { activeProfileId } = useProfileFilterStore();
	const queryClient = useQueryClient();
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [isCanceling, setIsCanceling] = useState(false);

	const handleCancelSubscription = async () => {
		setIsCanceling(true);
		try {
			const { error } = await supabase.functions.invoke(
				"paddle-cancel-subscription",
			);
			if (error) {
				toast.error(error.message || "Failed to cancel subscription");
				return;
			}
			toast.success(
				"Subscription canceled. You'll retain access until the end of your billing period.",
			);
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setIsCanceling(false);
			setConfirmCancel(false);
		}
	};

	const canCancel =
		tier !== "FREE" &&
		!cancelAtPeriodEnd &&
		(subStatus === "active" || subStatus === "trialing");

	// Real data queries
	const { data: profile, isPending: profileLoading } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});
	const { data: stats, isPending: statsLoading } = useQuery({
		...profileStatsOptions(userId, activeProfileId),
		enabled: !!userId,
	});
	const { data: workouts } = useQuery(workoutListOptions(userId));
	const { data: topExercises, isPending: exercisesLoading } = useQuery({
		...topExercisesOptions(userId, activeProfileId),
		enabled: !!userId,
	});
	const { data: integrations, isPending: integrationsLoading } = useQuery({
		...integrationsOptions(userId),
		enabled: !!userId,
	});
	const { data: earnedBadges, isPending: badgesLoading } = useQuery({
		...earnedBadgesOptions(userId),
		enabled: !!userId,
	});
	const { data: rpgAttributes } = useQuery({
		...rpgAttributesOptions(userId),
		enabled: !!userId,
	});
	const { data: gamificationStats } = useQuery({
		...gamificationStatsOptions(userId),
		enabled: !!userId,
	});

	const streak = useStreak(workouts);
	const updateProfile = useUpdateProfile(userId || undefined);

	// Avatar upload state
	const avatarInputRef = useRef<HTMLInputElement>(null);
	const [avatarUploading, setAvatarUploading] = useState(false);

	const handleAvatarUpload = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file || !userId) return;

			// Validate file type and size (max 2 MB)
			if (!file.type.startsWith("image/")) {
				toast.error("Please select an image file.");
				return;
			}
			if (file.size > 2 * 1024 * 1024) {
				toast.error("Image must be under 2 MB.");
				return;
			}

			setAvatarUploading(true);
			try {
				const ext = file.name.split(".").pop() ?? "jpg";
				const path = `${userId}/avatar.${ext}`;

				const { error: uploadError } = await supabase.storage
					.from("avatars")
					.upload(path, file, { upsert: true });
				if (uploadError) throw uploadError;

				const {
					data: { publicUrl },
				} = supabase.storage.from("avatars").getPublicUrl(path);

				// Append cache-buster so the browser picks up the new image
				const avatarUrl = `${publicUrl}?t=${Date.now()}`;
				updateProfile.mutate({ avatar_url: avatarUrl });
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Avatar upload failed.",
				);
			} finally {
				setAvatarUploading(false);
				// Reset input so re-selecting the same file triggers onChange
				if (avatarInputRef.current) avatarInputRef.current.value = "";
			}
		},
		[userId, updateProfile],
	);

	// Local settings state, initialized from profile query
	const [editDisplayName, setEditDisplayName] = useState("");
	const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
	const [emailDigests, setEmailDigests] = useState(true);
	const [pushNotifications, setPushNotifications] = useState(true);
	const [streakReminders, setStreakReminders] = useState(true);
	const [challengeUpdates, setChallengeUpdates] = useState(true);
	const [profileVisible, setProfileVisible] = useState(true);
	const [leaderboardParticipation, setLeaderboardParticipation] =
		useState(true);

	// Sync local state when profile data loads
	useEffect(() => {
		if (profile) {
			setEditDisplayName(profile.display_name ?? "");
			setWeightUnit(profile.weight_unit === "lbs" ? "lbs" : "kg");
			setEmailDigests(profile.email_digests ?? true);
			setPushNotifications(profile.push_notifications ?? true);
			setStreakReminders(profile.streak_reminders ?? true);
			setChallengeUpdates(profile.challenge_updates ?? true);
			setProfileVisible(profile.profile_visible ?? true);
			setLeaderboardParticipation(profile.leaderboard_participation ?? true);
		}
	}, [profile]);

	// Derived profile data
	const displayName =
		profile?.display_name ?? user?.email?.split("@")[0] ?? "Athlete";
	const initials = getInitials(
		profile?.display_name ?? user?.email?.split("@")[0],
	);
	const memberSince = profile?.created_at
		? format(new Date(profile.created_at), "MMMM yyyy")
		: null;

	// Real stats for header grid
	const userStats = [
		{
			label: "Total Workouts",
			value: statsLoading ? "..." : String(stats?.totalWorkouts ?? 0),
			icon: Calendar,
		},
		{
			label: "Personal Records",
			value: statsLoading ? "..." : String(stats?.prCount ?? 0),
			icon: Trophy,
		},
		{
			label: "Current Streak",
			value: `${streak}d`,
			icon: Flame,
		},
		{
			label: "Total Volume",
			value: statsLoading
				? "..."
				: formatVolume(stats?.totalVolume ?? 0, weightUnit),
			icon: Dumbbell,
		},
	];

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			<PageShell>
				{/* Profile Header */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					className="mb-8"
				>
					<Card className="p-8 bg-surface-2 border-secondary relative overflow-hidden">
						{/* Background Effect */}
						<div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-chart-2/10 opacity-50" />

						<div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
							{/* Avatar with upload overlay */}
							<div className="relative group">
								<Avatar className="w-24 h-24 ring-4 ring-primary ring-offset-4 ring-offset-background">
									{profile?.avatar_url ? (
										<AvatarImage src={profile.avatar_url} alt={displayName} />
									) : null}
									<AvatarFallback className="bg-primary text-white text-3xl">
										{profileLoading ? "..." : initials}
									</AvatarFallback>
								</Avatar>
								<button
									type="button"
									className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed"
									disabled={avatarUploading}
									onClick={() => avatarInputRef.current?.click()}
									aria-label="Change avatar"
								>
									{avatarUploading ? (
										<Loader2 className="w-6 h-6 text-white animate-spin" />
									) : (
										<Camera className="w-6 h-6 text-white" />
									)}
								</button>
								<input
									ref={avatarInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleAvatarUpload}
								/>
							</div>

							{/* Info */}
							<div className="flex-1 text-center md:text-left">
								{profileLoading ? (
									<>
										<Skeleton className="h-9 w-48 mb-2 mx-auto md:mx-0" />
										<Skeleton className="h-5 w-36 mb-4 mx-auto md:mx-0" />
									</>
								) : (
									<>
										<h1 className="text-display-2 text-white mb-2">{displayName}</h1>
										<p className="text-muted-foreground mb-4">
											{memberSince ? `Member since ${memberSince}` : "Member"}
										</p>
									</>
								)}
								<div className="flex items-center justify-center md:justify-start gap-2 mb-4">
									<Flame className="w-5 h-5 text-accent" fill={PHOENIX.ember} />
									<span className="text-white font-data">{streak} day streak</span>
								</div>
								<div className="flex flex-wrap gap-2 justify-center md:justify-start">
									<TierBadge className="text-sm px-3 py-1" />
								</div>
							</div>

							{/* Stats Grid */}
							<div className="grid grid-cols-2 gap-4">
								{userStats.map((stat) => (
									<div
										key={stat.label}
										className="text-center p-4 bg-background rounded-lg border border-secondary"
									>
										<stat.icon className="w-5 h-5 text-primary mx-auto mb-2" />
										<div className="text-2xl text-white mb-1 font-data">{stat.value}</div>
										<div className="text-xs text-muted-foreground">
											{stat.label}
										</div>
									</div>
								))}
							</div>
						</div>
					</Card>
				</motion.div>

				{/* Subscription Card */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
					className="mb-8"
				>
					<Card className="p-6 bg-surface-2 border-secondary">
						<h3 className="text-xl text-white mb-4 flex items-center gap-2">
							<CreditCard className="w-5 h-5 text-primary" />
							Subscription
						</h3>
						<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
							<div className="flex items-center gap-3">
								<TierBadge />
								<div>
									<div className="text-white font-medium">
										{PLAN_LABELS[tier]}
									</div>
									{tier !== "FREE" && currentPeriodEnd && (
										<div className="text-sm text-muted-foreground">
											{cancelAtPeriodEnd ? "Cancels" : "Renews"}{" "}
											{format(new Date(currentPeriodEnd), "MMM d, yyyy")}
										</div>
									)}
								</div>
							</div>
							<div className="flex gap-2 flex-wrap items-center">
								{tier === "FREE" ? (
									<Button
										asChild
										variant="cta"
									>
										<Link to="/pricing">Subscribe</Link>
									</Button>
								) : (
									<>
										<Button asChild variant="outline" size="sm">
											<Link to="/pricing">Manage Plan</Link>
										</Button>
										{canCancel && (
											<Button
												variant="ghost"
												size="sm"
												className="text-muted-foreground hover:text-destructive"
												onClick={() => setConfirmCancel(true)}
											>
												Cancel Subscription
											</Button>
										)}
									</>
								)}
							</div>
						</div>
					</Card>
				</motion.div>

				{/* Main Content */}
				<Tabs defaultValue="stats" className="space-y-6">
					<TabsList variant="panel">
						<TabsTrigger value="stats">
							Public Stats
						</TabsTrigger>
						<TabsTrigger value="badges">
							Badges
						</TabsTrigger>
						<TabsTrigger value="integrations">
							Integrations
						</TabsTrigger>
						<TabsTrigger value="settings">
							Settings
						</TabsTrigger>
					</TabsList>

					{/* Stats Tab */}
					<TabsContent value="stats" className="space-y-6">
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
							{/* Top Exercises */}
							<Card className="p-6 bg-surface-2 border-secondary">
								<h3 className="text-xl text-white mb-6">Top Exercises</h3>
								{exercisesLoading ? (
									<div className="space-y-4">
										{Array.from({ length: 5 }).map((_, i) => (
											<div
												key={i}
												className="flex items-center justify-between p-3 bg-background rounded-lg border border-secondary"
											>
												<Skeleton className="h-5 w-32" />
												<Skeleton className="h-5 w-16" />
											</div>
										))}
									</div>
								) : !topExercises || topExercises.length === 0 ? (
									<div className="flex flex-col items-center justify-center py-8 text-center">
										<Dumbbell className="w-10 h-10 text-secondary mb-3" />
										<p className="text-muted-foreground mb-1">
											No exercises yet
										</p>
										<p className="text-sm text-muted-foreground">
											Complete workouts to see your top exercises here
										</p>
									</div>
								) : (
									<div className="space-y-4">
										{topExercises.map((exercise, index) => (
											<div
												key={exercise.name}
												className="flex items-center justify-between p-3 bg-background rounded-lg border border-secondary"
											>
												<div className="flex items-center gap-3">
													<span className="text-sm text-muted-foreground w-5">
														#{index + 1}
													</span>
													<div className="text-white">{exercise.name}</div>
												</div>
												<div className="text-right">
													<div className="text-primary font-data">
														{exercise.count} times
													</div>
												</div>
											</div>
										))}
									</div>
								)}
							</Card>

							{/* Achievement Summary */}
							<Card className="p-6 bg-surface-2 border-secondary">
								<h3 className="text-xl text-white mb-6">Achievement Summary</h3>
								<div className="space-y-4">
									<div className="p-4 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg">
										<div className="text-sm text-muted-foreground mb-1">
											Total Volume Lifted
										</div>
										<div className="text-3xl text-primary font-data">
											{statsLoading
												? "..."
												: formatVolume(stats?.totalVolume ?? 0, weightUnit)}
										</div>
									</div>
									<div className="p-4 bg-gradient-to-br from-success/10 to-emerald-600/10 border border-success/30 rounded-lg">
										<div className="text-sm text-muted-foreground mb-1">
											Best Streak
										</div>
										<div className="text-3xl text-success font-data">
											{statsLoading ? "..." : `${stats?.bestStreak ?? 0} days`}
										</div>
									</div>
									<div className="p-4 bg-gradient-to-br from-accent/10 to-warning/10 border border-accent/30 rounded-lg">
										<div className="text-sm text-muted-foreground mb-1">
											Personal Records
										</div>
										<div className="text-3xl text-accent font-data">
											{statsLoading ? "..." : (stats?.prCount ?? 0)}
										</div>
									</div>
								</div>
							</Card>
						</div>
					</TabsContent>

					{/* Badges Tab */}
					<TabsContent value="badges" className="space-y-6">
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
							<Card className="p-6 bg-surface-2 border-secondary">
								<h3 className="text-xl text-white mb-4 flex items-center gap-2">
									<Award className="w-5 h-5 text-primary" />
									Badge Summary
								</h3>
								<div className="space-y-4">
									<div className="p-4 bg-background rounded-lg border border-secondary">
										<div className="text-sm text-muted-foreground">
											Badges Earned
										</div>
										<div className="text-3xl text-white font-data">
											{badgesLoading ? "..." : (earnedBadges?.length ?? 0)}
										</div>
									</div>
									<div className="p-4 bg-background rounded-lg border border-secondary">
										<div className="text-sm text-muted-foreground">
											Current Streak
										</div>
										<div className="text-3xl text-primary font-data">
											{gamificationStats?.current_streak ?? streak} days
										</div>
									</div>
									<div className="p-4 bg-background rounded-lg border border-secondary">
										<div className="text-sm text-muted-foreground">
											Longest Streak
										</div>
										<div className="text-3xl text-success font-data">
											{gamificationStats?.longest_streak ??
												stats?.bestStreak ??
												0}{" "}
											days
										</div>
									</div>
								</div>
							</Card>

							<Card className="p-6 bg-surface-2 border-secondary">
								<h3 className="text-xl text-white mb-4 flex items-center gap-2">
									<Shield className="w-5 h-5 text-accent" />
									RPG Attributes
								</h3>
								{rpgAttributes ? (
									<div className="space-y-3">
										<div className="flex items-center justify-between text-sm">
											<span className="text-muted-foreground">Class</span>
											<span className="text-white">
												{rpgAttributes.character_class ?? "PHOENIX"}
											</span>
										</div>
										{[
											["Strength", rpgAttributes.strength],
											["Power", rpgAttributes.power],
											["Stamina", rpgAttributes.stamina],
											["Consistency", rpgAttributes.consistency],
											["Mastery", rpgAttributes.mastery],
										].map(([label, value]) => (
											<div key={label as string}>
												<div className="flex items-center justify-between text-sm mb-1">
													<span className="text-muted-foreground">{label}</span>
													<span className="text-white font-data">{value as number}</span>
												</div>
												<div className="h-2 rounded-full bg-background overflow-hidden">
													<div
														className="h-full bg-primary"
														style={{
															width: `${Math.min(value as number, 100)}%`,
														}}
													/>
												</div>
											</div>
										))}
									</div>
								) : (
									<div className="flex flex-col items-center justify-center py-8 text-center">
										<Shield className="w-10 h-10 text-secondary mb-3" />
										<p className="text-muted-foreground mb-1">
											No RPG profile yet
										</p>
										<p className="text-sm text-muted-foreground">
											Train and sync from the mobile app to generate your class
											and attributes
										</p>
									</div>
								)}
							</Card>

							<Card className="p-6 bg-surface-2 border-secondary">
								<h3 className="text-xl text-white mb-4 flex items-center gap-2">
									<Flame className="w-5 h-5 text-warning" />
									Gamification
								</h3>
								<div className="space-y-4">
									<div className="flex items-center justify-between py-2 border-b border-secondary">
										<span className="text-muted-foreground">
											Total Workouts
										</span>
										<span className="text-white font-data">
											{gamificationStats?.total_workouts ??
												stats?.totalWorkouts ??
												0}
										</span>
									</div>
									<div className="flex items-center justify-between py-2 border-b border-secondary">
										<span className="text-muted-foreground">Total Reps</span>
										<span className="text-white font-data">
											{gamificationStats?.total_reps ?? 0}
										</span>
									</div>
									<div className="flex items-center justify-between py-2">
										<span className="text-muted-foreground">Total Volume</span>
										<span className="text-primary font-data">
											{formatVolume(
												gamificationStats?.total_volume_kg ??
													stats?.totalVolume ??
													0,
												weightUnit,
											)}
										</span>
									</div>
								</div>
							</Card>
						</div>

						<Card className="p-6 bg-surface-2 border-secondary">
							<div className="flex items-center justify-between mb-6">
								<h3 className="text-xl text-white">Earned Badges</h3>
								{earnedBadges && earnedBadges.length > 0 && (
									<Badge className="bg-primary/20 text-primary border-primary/30">
										{earnedBadges.length} total
									</Badge>
								)}
							</div>
							{badgesLoading ? (
								<div className="space-y-3">
									{Array.from({ length: 4 }).map((_, i) => (
										<div
											key={i}
											className="flex items-center justify-between p-4 bg-background rounded-lg border border-secondary"
										>
											<Skeleton className="h-5 w-32" />
											<Skeleton className="h-5 w-16" />
										</div>
									))}
								</div>
							) : !earnedBadges || earnedBadges.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<Award className="w-12 h-12 text-secondary mb-3" />
									<p className="text-muted-foreground mb-1">
										No badges earned yet
									</p>
									<p className="text-sm text-muted-foreground">
										Complete workouts in the mobile app to start earning badges
									</p>
								</div>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									{earnedBadges.map((badge) => (
										<div
											key={`${badge.badge_id}-${badge.earned_at.toISOString()}`}
											className="p-4 bg-background rounded-lg border border-secondary"
										>
											<div className="flex items-start justify-between gap-3">
												<div>
													<div className="text-white">{badge.badge_name}</div>
													<div className="text-sm text-muted-foreground">
														{badge.badge_description ?? badge.badge_id}
													</div>
													<div className="text-xs text-muted-foreground mt-2">
														Earned {format(badge.earned_at, "MMM d, yyyy")}
													</div>
												</div>
												<Badge className="bg-accent/20 text-accent border-accent/30 uppercase">
													{badge.badge_tier}
												</Badge>
											</div>
										</div>
									))}
								</div>
							)}
						</Card>
					</TabsContent>

					{/* Integrations Tab */}
					<TabsContent value="integrations" className="space-y-6">
						<Card className="p-6 bg-surface-2 border-secondary">
							<h3 className="text-xl text-white mb-6">Connected Apps</h3>
							{integrationsLoading ? (
								<div className="space-y-4">
									{Array.from({ length: 3 }).map((_, i) => (
										<div
											key={i}
											className="flex items-center justify-between p-4 bg-background rounded-lg border border-secondary"
										>
											<div className="flex items-center gap-4">
												<Skeleton className="w-12 h-12 rounded-lg" />
												<div>
													<Skeleton className="h-5 w-24 mb-1" />
													<Skeleton className="h-4 w-32" />
												</div>
											</div>
											<Skeleton className="h-9 w-24" />
										</div>
									))}
								</div>
							) : !integrations || integrations.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-8 text-center">
									<Globe className="w-10 h-10 text-secondary mb-3" />
									<p className="text-muted-foreground mb-1">
										No connected apps
									</p>
									<p className="text-sm text-muted-foreground mb-4">
										Connect your fitness apps to sync data
									</p>
									<Button
										variant="cta"
										asChild
									>
										<Link to="/integrations">Manage Integrations</Link>
									</Button>
								</div>
							) : (
								<>
									<div className="space-y-4">
										{integrations.map((integration) => {
											const meta = PROVIDER_META[integration.provider] ?? {
												label: integration.provider,
												logo: integration.provider[0]?.toUpperCase() ?? "?",
											};
											const isConnected = integration.status === "connected";
											return (
												<div
													key={integration.id}
													className="flex items-center justify-between p-4 bg-background rounded-lg border border-secondary"
												>
													<div className="flex items-center gap-4">
														<div className="w-12 h-12 bg-secondary rounded-lg flex items-center justify-center text-xl font-bold text-white">
															{meta.logo}
														</div>
														<div>
															<div className="text-white">{meta.label}</div>
															<div className="text-sm text-muted-foreground">
																{isConnected
																	? `Connected${
																			integration.last_sync_at
																				? ` - Last sync: ${format(new Date(integration.last_sync_at), "MMM d, h:mm a")}`
																				: ""
																		}`
																	: "Disconnected"}
															</div>
														</div>
													</div>
													<Badge
														className={
															isConnected
																? "bg-success/20 text-success border-success/30"
																: "bg-secondary text-muted-foreground border-secondary"
														}
													>
														{isConnected ? "Connected" : "Disconnected"}
													</Badge>
												</div>
											);
										})}
									</div>
									<Button
										variant="outline"
										className="w-full mt-4 border-primary text-primary hover:bg-primary/10"
										asChild
									>
										<Link to="/integrations">Manage All Integrations</Link>
									</Button>
								</>
							)}
						</Card>
					</TabsContent>

					{/* Settings Tab */}
					<TabsContent value="settings" className="space-y-6">
						<Card className="p-6 bg-surface-2 border-secondary">
							<h3 className="text-xl text-white mb-6 flex items-center gap-2">
								<Bell className="w-5 h-5" />
								Notification Settings
							</h3>
							<p className="text-sm text-muted-foreground mb-4 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
								Notification delivery is not yet active. These preferences are
								saved and will take effect once the notification system is live.
							</p>
							<div className="space-y-4">
								<div className="flex items-center justify-between py-3 border-b border-secondary">
									<div>
										<div className="text-white">Email digests</div>
										<div className="text-sm text-muted-foreground">
											Weekly summary of your progress
										</div>
									</div>
									<Switch
										checked={emailDigests}
										disabled={updateProfile.isPending}
										onCheckedChange={(checked) => {
											setEmailDigests(checked);
											updateProfile.mutate({
												email_digests: checked,
											});
										}}
									/>
								</div>
								<div className="flex items-center justify-between py-3 border-b border-secondary">
									<div>
										<div className="text-white">Push notifications</div>
										<div className="text-sm text-muted-foreground">
											Get notified of challenges and PRs
										</div>
									</div>
									<Switch
										checked={pushNotifications}
										disabled={updateProfile.isPending}
										onCheckedChange={(checked) => {
											setPushNotifications(checked);
											updateProfile.mutate({
												push_notifications: checked,
											});
										}}
									/>
								</div>
								<div className="flex items-center justify-between py-3 border-b border-secondary">
									<div>
										<div className="text-white">Streak reminders</div>
										<div className="text-sm text-muted-foreground">
											Don't break your streak!
										</div>
									</div>
									<Switch
										checked={streakReminders}
										disabled={updateProfile.isPending}
										onCheckedChange={(checked) => {
											setStreakReminders(checked);
											updateProfile.mutate({
												streak_reminders: checked,
											});
										}}
									/>
								</div>
								<div className="flex items-center justify-between py-3 border-b border-secondary">
									<div>
										<div className="text-white">Challenge updates</div>
										<div className="text-sm text-muted-foreground">
											Updates on active challenges
										</div>
									</div>
									<Switch
										checked={challengeUpdates}
										disabled={updateProfile.isPending}
										onCheckedChange={(checked) => {
											setChallengeUpdates(checked);
											updateProfile.mutate({
												challenge_updates: checked,
											});
										}}
									/>
								</div>
							</div>
						</Card>

						<Card className="p-6 bg-surface-2 border-secondary">
							<h3 className="text-xl text-white mb-6 flex items-center gap-2">
								<Globe className="w-5 h-5" />
								General Settings
							</h3>
							<div className="space-y-4">
								<div>
									<Label className="text-white mb-2 block">Display Name</Label>
									<div className="flex gap-2">
										<Input
											type="text"
											value={editDisplayName}
											onChange={(e) => setEditDisplayName(e.target.value)}
											placeholder="Enter your display name..."
											className="flex-1 bg-background border-secondary text-white"
											onKeyDown={(e) => {
												if (
													e.key === "Enter" &&
													editDisplayName.trim() &&
													editDisplayName !== profile?.display_name
												) {
													updateProfile.mutate({
														display_name: editDisplayName.trim(),
													});
												}
											}}
										/>
										<Button
											variant="outline"
											className="border-secondary text-white hover:bg-primary hover:border-primary"
											disabled={
												updateProfile.isPending ||
												!editDisplayName.trim() ||
												editDisplayName === profile?.display_name
											}
											onClick={() =>
												updateProfile.mutate({
													display_name: editDisplayName.trim(),
												})
											}
										>
											{updateProfile.isPending ? "Saving..." : "Save"}
										</Button>
									</div>
								</div>
								<div>
									<Label className="text-white mb-2 block">Weight Unit</Label>
									<div className="flex gap-2">
										<Button
											className={
												weightUnit === "kg"
													? "flex-1 bg-primary border-0"
													: "flex-1 border-secondary text-muted-foreground"
											}
											variant={weightUnit === "kg" ? "default" : "outline"}
											disabled={updateProfile.isPending}
											onClick={() => {
												setWeightUnit("kg");
												updateProfile.mutate({
													weight_unit: "kg",
												});
											}}
										>
											Kilograms (kg)
										</Button>
										<Button
											className={
												weightUnit === "lbs"
													? "flex-1 bg-primary border-0"
													: "flex-1 border-secondary text-muted-foreground"
											}
											variant={weightUnit === "lbs" ? "default" : "outline"}
											disabled={updateProfile.isPending}
											onClick={() => {
												setWeightUnit("lbs");
												updateProfile.mutate({
													weight_unit: "lbs",
												});
											}}
										>
											Pounds (lbs)
										</Button>
									</div>
								</div>
							</div>
						</Card>

						<Card className="p-6 bg-surface-2 border-secondary">
							<h3 className="text-xl text-white mb-6 flex items-center gap-2">
								<Shield className="w-5 h-5" />
								Privacy & Security
							</h3>
							<div className="space-y-4">
								<div className="flex items-center justify-between py-3 border-b border-secondary">
									<div>
										<div className="text-white">Profile visibility</div>
										<div className="text-sm text-muted-foreground">
											Make your profile visible to others
										</div>
										<div className="text-xs text-amber-400 mt-1">
											Coming soon -- your preference is saved
										</div>
									</div>
									<Switch
										checked={profileVisible}
										disabled={updateProfile.isPending}
										onCheckedChange={(checked) => {
											setProfileVisible(checked);
											updateProfile.mutate({
												profile_visible: checked,
											});
										}}
									/>
								</div>
								<div className="flex items-center justify-between py-3 border-b border-secondary">
									<div>
										<div className="text-white">Leaderboard participation</div>
										<div className="text-sm text-muted-foreground">
											Appear on public leaderboards
										</div>
										<div className="text-xs text-amber-400 mt-1">
											Coming soon -- your preference is saved
										</div>
									</div>
									<Switch
										checked={leaderboardParticipation}
										disabled={updateProfile.isPending}
										onCheckedChange={(checked) => {
											setLeaderboardParticipation(checked);
											updateProfile.mutate({
												leaderboard_participation: checked,
											});
										}}
									/>
								</div>
							</div>
						</Card>

						{/* Data Export - available to all tiers (no SubscriptionGate) */}
						<ExportSection />

						{/* Account Deletion - available to all tiers (GDPR right to erasure) */}
						<DangerZone />

						<Card className="p-6 bg-surface-2 border-secondary">
							<h3 className="text-xl text-white mb-6 flex items-center gap-2">
								<LogOut className="w-5 h-5" />
								Account
							</h3>
							<div className="space-y-4">
								<p className="text-sm text-muted-foreground">
									Sign out of your account on this device
								</p>
								<Button
									className="w-full bg-chart-2 hover:bg-chart-2/80 text-white border-0"
									onClick={async () => {
										await signOut();
									}}
								>
									<LogOut className="w-4 h-4 mr-2" />
									Sign Out
								</Button>
							</div>
						</Card>
					</TabsContent>
				</Tabs>
			</PageShell>

			{/* Cancel Subscription Confirmation */}
			<AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
				<AlertDialogContent className="bg-surface-2 border-destructive/30">
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
						<AlertDialogDescription>
							Your subscription will remain active until the end of your current
							billing period
							{currentPeriodEnd
								? ` (${format(new Date(currentPeriodEnd), "MMM d, yyyy")})`
								: ""}
							. After that, you'll be downgraded to the Free plan.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep subscription</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground"
							onClick={handleCancelSubscription}
							disabled={isCanceling}
						>
							{isCanceling ? "Canceling..." : "Yes, cancel"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
