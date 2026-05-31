import { describe, expect, it } from "vitest";
import {
	describeSyncPlatformInput,
	normalizeSyncPlatform,
} from "../../../supabase/functions/_shared/syncPlatform.ts";

describe("normalizeSyncPlatform", () => {
	it("preserves canonical mobile platform values", () => {
		expect(normalizeSyncPlatform("android")).toBe("android");
		expect(normalizeSyncPlatform("iOS 18.4")).toBe("ios");
	});

	it("falls back to unknown for missing or blank values", () => {
		expect(normalizeSyncPlatform(undefined)).toBe("unknown");
		expect(normalizeSyncPlatform(null)).toBe("unknown");
		expect(normalizeSyncPlatform("   ")).toBe("unknown");
	});
});

describe("describeSyncPlatformInput", () => {
	it("reports undefined distinctly from null", () => {
		expect(describeSyncPlatformInput(undefined)).toBe("type=undefined");
		expect(describeSyncPlatformInput(null)).toBe("type=object,null");
	});

	it("distinguishes empty string from whitespace-only string", () => {
		expect(describeSyncPlatformInput("")).toBe("type=string,len=0");
		expect(describeSyncPlatformInput("   ")).toBe(
			"type=string,len=3,trimmedLen=0",
		);
	});

	it("includes a bounded lowercased sample for non-empty strings", () => {
		expect(describeSyncPlatformInput("Android 34")).toBe(
			'type=string,len=10,sample="android 34"',
		);
		const long = "a".repeat(100);
		const out = describeSyncPlatformInput(long);
		expect(out).toContain("len=100");
		// sample must be truncated to <=40 chars after the quote
		const sampleMatch = out.match(/sample="([^"]*)"/);
		expect(sampleMatch).not.toBeNull();
		expect(sampleMatch?.[1]?.length).toBeLessThanOrEqual(40);
	});

	it("reports numeric/boolean/bigint values", () => {
		expect(describeSyncPlatformInput(42)).toBe("type=number,value=42");
		expect(describeSyncPlatformInput(true)).toBe("type=boolean,value=true");
		expect(describeSyncPlatformInput(BigInt(5))).toBe("type=bigint,value=5");
	});

	it("reports other object types without crashing", () => {
		expect(describeSyncPlatformInput({})).toBe("type=object");
		expect(describeSyncPlatformInput([])).toBe("type=object");
	});
});
