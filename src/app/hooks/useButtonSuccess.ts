import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Manages a temporary success state for buttons.
 *
 * Usage:
 *   const { isSuccess, trigger } = useButtonSuccess();
 *   <Button variant={isSuccess ? "success" : "default"} onClick={handleSave}>
 *     {isSuccess ? <Check /> : <Save />}
 *     {isSuccess ? "Saved" : "Save"}
 *   </Button>
 *
 * Call `trigger()` in your mutation's onSuccess callback.
 * The success state auto-reverts after `durationMs` (default 2000ms).
 */
export function useButtonSuccess(durationMs = 2000) {
	const [isSuccess, setIsSuccess] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout>>();

	const trigger = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		setIsSuccess(true);
		timerRef.current = setTimeout(() => setIsSuccess(false), durationMs);
	}, [durationMs]);

	// Clean up timer on unmount to avoid setting state after unmount.
	useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[],
	);

	return { isSuccess, trigger } as const;
}
