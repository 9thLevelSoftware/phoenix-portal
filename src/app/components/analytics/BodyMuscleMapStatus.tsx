import { Skeleton } from "@/app/components/ui/skeleton";

/**
 * Placeholder for the body heatmap while its (large, lazily loaded) exercise
 * → muscle map is still downloading, or when that download failed.
 */
export function BodyMuscleMapStatus({
	failed,
	className = "h-[420px]",
}: {
	failed: boolean;
	className?: string;
}) {
	if (failed) {
		return (
			<div
				role="alert"
				className={`${className} flex items-center justify-center p-4 text-center text-sm text-muted-foreground`}
			>
				Couldn't load the body map. Check your connection, then reopen this tab.
			</div>
		);
	}
	return (
		<Skeleton
			role="status"
			aria-label="Loading body map"
			className={`${className} w-full`}
		/>
	);
}
