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
	"#FF6B35", // Ember (0)
	"#3B82F6", // Blue (1)
	"#10B981", // Green (2)
	"#F59E0B", // Gold (3)
	"#8B5CF6", // Purple (4)
	"#EC4899", // Pink (5)
	"#14B8A6", // Teal (6)
	"#F97316", // Orange (7)
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
			<label className="text-xs font-medium text-muted-foreground mb-1.5 block">
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
