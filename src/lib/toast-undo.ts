import { toast } from "sonner";

/**
 * Shows a toast with an "Undo" button. The action executes after `delayMs` unless
 * the user clicks Undo. Use for reversible, low-risk destructive actions.
 *
 * Interaction design reference: "undo > confirm dialog" for reversible actions.
 * The user sees immediate feedback and has a recovery window without the
 * cognitive overhead of a confirmation dialog.
 *
 * Usage:
 *   toastWithUndo({
 *     message: "Routine removed from community",
 *     action: () => deleteMutation.mutateAsync({ contentId, contentType }),
 *     onUndo: () => queryClient.invalidateQueries({ queryKey: queryKeys.community.all }),
 *   });
 *
 * @param message - Toast message shown immediately
 * @param action  - The destructive action to execute after delay
 * @param onUndo  - Callback when user clicks Undo (e.g., restore optimistic cache)
 * @param delayMs - Undo window duration (default 5000ms)
 */
export function toastWithUndo({
	message,
	action,
	onUndo,
	delayMs = 5000,
}: {
	message: string;
	action: () => void | Promise<void>;
	onUndo?: () => void;
	delayMs?: number;
}) {
	let cancelled = false;
	let timer: ReturnType<typeof setTimeout>;

	const toastId = toast(message, {
		duration: delayMs + 500, // Keep toast visible slightly longer than the timer
		action: {
			label: "Undo",
			onClick: () => {
				cancelled = true;
				clearTimeout(timer);
				onUndo?.();
				toast.dismiss(toastId);
				toast.success("Action undone");
			},
		},
	});

	timer = setTimeout(async () => {
		if (!cancelled) {
			try {
				await action();
			} catch {
				toast.error("Action failed. Please try again.");
			}
		}
	}, delayMs);

	return toastId;
}
