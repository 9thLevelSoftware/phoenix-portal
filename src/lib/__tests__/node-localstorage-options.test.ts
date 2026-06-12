import { describe, expect, it } from "vitest";
import {
	buildNodeOptionsWithoutNodeWebStorage,
	nodeAllowsWebStorageDisableInNodeOptions,
	stripNodeWebStorageOptions,
} from "../../../scripts/node-localstorage-options.mjs";

describe("Node localStorage options", () => {
	it("removes inherited localStorage file options before disabling Node web storage", () => {
		expect(
			buildNodeOptionsWithoutNodeWebStorage(
				"--trace-warnings --localstorage-file --localstorage-file=old.sqlite",
				{ nodeVersion: "25.2.1" },
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
			buildNodeOptionsWithoutNodeWebStorage("--no-experimental-webstorage", {
				nodeVersion: "25.2.1",
			}),
		).toBe("--no-experimental-webstorage");
	});

	it("does not put the disallowed web storage disable flag in Node 20 NODE_OPTIONS", () => {
		expect(nodeAllowsWebStorageDisableInNodeOptions("20.20.2")).toBe(false);
		expect(
			buildNodeOptionsWithoutNodeWebStorage(
				"--trace-warnings --localstorage-file old.sqlite --no-experimental-webstorage",
				{ nodeVersion: "20.20.2" },
			),
		).toBe("--trace-warnings");
	});

	it("keeps the web storage disable flag for Node versions that allow it in NODE_OPTIONS", () => {
		expect(nodeAllowsWebStorageDisableInNodeOptions("22.21.1")).toBe(true);
		expect(nodeAllowsWebStorageDisableInNodeOptions("v22.21.1")).toBe(true);
		expect(nodeAllowsWebStorageDisableInNodeOptions("25.2.1")).toBe(true);
		expect(
			buildNodeOptionsWithoutNodeWebStorage("--trace-warnings", {
				nodeVersion: "22.21.1",
			}),
		).toBe("--trace-warnings --no-experimental-webstorage");
	});
});
