import { useQuery } from "@tanstack/react-query";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import { localProfilesOptions } from "@/queries/localProfiles";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

// Profile color palette (indexes 0-7 match mobile's ProfileSidePanel color array)
const PROFILE_COLORS = [
	"var(--primary)", // Ember (0)
	"var(--cable-b)", // Blue (1)
	"var(--success)", // Green (2)
	"var(--accent)", // Gold (3)
	"var(--chart-5)", // Purple (4)
	"var(--chart-5)", // Pink (5)
	"var(--success)", // Teal (6)
	"var(--primary)", // Orange (7)
];

interface LocalProfileFilterProps {
	userId: string;
}

export function LocalProfileFilter({ userId }: LocalProfileFilterProps) {
	const { data: profiles = [], isLoading } = useQuery(
		localProfilesOptions(userId),
	);
	const { activeProfileId, setActiveProfileId } = useProfileFilterStore();

	// Don't render if loading, or user has 0 or 1 profiles
	if (isLoading || profiles.length <= 1) return null;

	return (
		<div className="px-3 py-2">
			<label
				htmlFor="profile-filter-select"
				className="text-xs font-medium text-muted-foreground mb-1.5 block"
			>
				Profile
			</label>
			<Select
				value={activeProfileId ?? "all"}
				onValueChange={(value) =>
					setActiveProfileId(value === "all" ? null : value)
				}
			>
				<SelectTrigger size="sm" className="text-sm">
					<SelectValue placeholder="All Profiles" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">All Profiles</SelectItem>
					{profiles.map((profile) => (
						<SelectItem key={profile.id} value={profile.id}>
							<span className="flex items-center gap-2">
								<span
									className="inline-block h-2.5 w-2.5 rounded-full"
									style={{
										backgroundColor:
											PROFILE_COLORS[profile.color_index] ?? PROFILE_COLORS[0],
									}}
								/>
								{profile.name}
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
