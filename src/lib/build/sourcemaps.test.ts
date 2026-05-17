import { describe, expect, it } from "vitest";
import {
	productionSourcemapSetting,
	shouldUploadSourcemaps,
} from "./sourcemaps";

describe("production sourcemap settings", () => {
	it("disables production sourcemaps when Sentry upload is disabled", () => {
		expect(shouldUploadSourcemaps({})).toBe(false);
		expect(shouldUploadSourcemaps({ SENTRY_AUTH_TOKEN: "   " })).toBe(false);
		expect(productionSourcemapSetting({})).toBe(false);
	});

	it("emits hidden sourcemaps only when Sentry upload/delete is enabled", () => {
		const env = { SENTRY_AUTH_TOKEN: "token-for-config-test" };

		expect(shouldUploadSourcemaps(env)).toBe(true);
		expect(productionSourcemapSetting(env)).toBe("hidden");
	});
});
