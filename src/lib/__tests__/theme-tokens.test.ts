import { afterEach, describe, expect, it } from "vitest";
import {
	getThemeTokens,
	invalidateThemeTokens,
	memoByTheme,
	withAlpha,
} from "../theme-tokens";

function setPrimary(value: string | null) {
	const style = document.documentElement.style;
	if (value === null) style.removeProperty("--primary");
	else style.setProperty("--primary", value);
	invalidateThemeTokens();
}

describe("theme tokens", () => {
	afterEach(() => setPrimary(null));

	it("falls back without pinning when the stylesheet has not applied", () => {
		const before = getThemeTokens();
		expect(before.primary).toBe("rgb(255, 107, 53)");
		setPrimary("#123456");
		expect(getThemeTokens().primary).toBe("#123456");
	});

	it("returns one stable snapshot until invalidated", () => {
		setPrimary("#ff6b35");
		const first = getThemeTokens();
		expect(getThemeTokens()).toBe(first);

		// A theme switch the cache has not been told about is not seen...
		document.documentElement.style.setProperty("--primary", "#c2410c");
		expect(getThemeTokens().primary).toBe("#ff6b35");

		// ...until ThemeProvider invalidates it.
		invalidateThemeTokens();
		expect(getThemeTokens().primary).toBe("#c2410c");
	});

	it("keeps identity when an invalidation re-reads identical values", () => {
		setPrimary("#ff6b35");
		const first = getThemeTokens();
		invalidateThemeTokens();
		expect(getThemeTokens()).toBe(first);
	});

	it("memoises a derivation per snapshot", () => {
		setPrimary("#ff6b35");
		let calls = 0;
		const palette = memoByTheme((tokens) => {
			calls += 1;
			return [tokens.primary];
		});
		const a = palette();
		expect(palette()).toBe(a);
		expect(calls).toBe(1);

		setPrimary("#c2410c");
		expect(palette()).toEqual(["#c2410c"]);
		expect(calls).toBe(2);
	});

	it("adds alpha to hex, rgb and variable colours", () => {
		expect(withAlpha("#ff6b35", 0.5)).toBe("rgba(255, 107, 53, 0.5)");
		expect(withAlpha("rgb(1, 2, 3)", 0.25)).toBe("rgba(1, 2, 3, 0.25)");
		expect(withAlpha("var(--success)", 0.13)).toBe(
			"color-mix(in srgb, var(--success) 13%, transparent)",
		);
	});
});
