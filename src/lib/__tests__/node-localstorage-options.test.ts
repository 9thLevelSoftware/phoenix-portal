import { describe, expect, it } from "vitest";
import {
	buildNodeOptionsWithoutNodeWebStorage,
	stripNodeWebStorageOptions,
} from "../../../scripts/node-localstorage-options.mjs";

describe("Node localStorage options", () => {
	it("removes inherited localStorage file options before disabling Node web storage", () => {
		expect(
			buildNodeOptionsWithoutNodeWebStorage(
				"--trace-warnings --localstorage-file --localstorage-file=old.sqlite",
			),
		).toBe("--trace-warnings --no-experimental-webstorage");
	});

	it("strips separate, equals-style, and explicit web storage flags", () => {
		expect(
			stripNodeWebStorageOptions(
				"--trace-warnings --webstorage --localstorage-file old.sqlite --localstorage-file=other.sqlite --no-experimental-webstorage",
			),
		).toBe("--trace-warnings");
	});

	it("does not duplicate the Node web storage disable flag", () => {
		expect(
			buildNodeOptionsWithoutNodeWebStorage("--no-experimental-webstorage"),
		).toBe("--no-experimental-webstorage");
	});
});
