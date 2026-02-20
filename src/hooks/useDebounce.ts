import { useEffect, useState } from "react";

/**
 * Debounces a value by the specified delay.
 * Returns the debounced value that only updates after `delay` ms of inactivity.
 *
 * @param value - The value to debounce
 * @param delay - Debounce delay in milliseconds (default 300ms)
 */
export function useDebounce<T>(value: T, delay = 300): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedValue(value);
		}, delay);

		return () => {
			clearTimeout(timer);
		};
	}, [value, delay]);

	return debouncedValue;
}
