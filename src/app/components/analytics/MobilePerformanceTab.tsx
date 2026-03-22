import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";

export default function MobilePerformanceTab() {
	return (
		<SubscriptionGate
			requiredTier="INFERNO"
			featureName="Performance Analytics"
		>
			<BiomechanicsContent view="performance" />
		</SubscriptionGate>
	);
}
