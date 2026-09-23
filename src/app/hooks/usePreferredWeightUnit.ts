import { useQuery } from "@tanstack/react-query";
import { normalizeWeightUnit, type WeightUnit } from "@/lib/units";
import { useAuth } from "@/providers/AuthProvider";
import { profileOptions } from "@/queries/profile";

export function usePreferredWeightUnit(): WeightUnit {
	const { user } = useAuth();
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	return normalizeWeightUnit(profile?.weight_unit);
}
