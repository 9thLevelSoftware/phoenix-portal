import { Activity, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { initiateStravaConnect } from "@/lib/integrations/strava";

interface StravaConnectProps {
	userId: string;
	isConnected?: boolean;
	onDisconnect?: () => void;
}

/**
 * Strava connection button component.
 *
 * When clicked, initiates the OAuth flow by redirecting the user to
 * Strava's authorization page. After authorization, the user is
 * redirected back to /integrations?connected=strava.
 */
export function StravaConnect({
	userId,
	isConnected,
	onDisconnect,
}: StravaConnectProps) {
	const [isRedirecting, setIsRedirecting] = useState(false);

	function handleConnect() {
		setIsRedirecting(true);
		initiateStravaConnect(userId);
		// Browser will redirect; loading state provides visual feedback
	}

	if (isConnected) {
		return (
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-2 text-sm text-[var(--color-forge-green)]">
					<Activity className="size-4" />
					<span>Connected to Strava</span>
				</div>
				{onDisconnect && (
					<Button variant="ghost" size="sm" onClick={onDisconnect}>
						Disconnect
					</Button>
				)}
			</div>
		);
	}

	return (
		<Button
			onClick={handleConnect}
			disabled={isRedirecting}
			className="bg-[#FC4C02] hover:bg-[#FC4C02]/90 text-white"
		>
			{isRedirecting ? (
				<>
					<Activity className="size-4 animate-spin" />
					Connecting...
				</>
			) : (
				<>
					<ExternalLink className="size-4" />
					Connect Strava
				</>
			)}
		</Button>
	);
}
