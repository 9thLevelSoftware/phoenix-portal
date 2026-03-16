import { Outlet } from "react-router";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";

interface SubscribedRouteProps {
	requiredTier?: "EMBER" | "FLAME" | "INFERNO";
}

/**
 * Route-level subscription gate. Wraps child routes with a SubscriptionGate
 * so that users without the required tier see the upgrade prompt.
 *
 * Usage in route tree:
 *   <Route element={<SubscribedRoute />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 */
export function SubscribedRoute({
	requiredTier = "EMBER",
}: SubscribedRouteProps) {
	return (
		<SubscriptionGate requiredTier={requiredTier}>
			<Outlet />
		</SubscriptionGate>
	);
}
