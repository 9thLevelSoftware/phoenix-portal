import { describe, expect, it } from "vitest";
import {
	WEBHOOK_HEADER_VALUE_MAX,
	WEBHOOK_LABEL_MAX,
	webhookEndpointFormSchema,
	webhookFormErrors,
} from "@/schemas/dataSharing";

const VALID = {
	label: "Home server",
	url: "https://hooks.example.com/phoenix",
	scopes: ["workouts", "personal_records"],
	headerName: "",
	headerValue: "",
};

function errorsFor(patch: Partial<typeof VALID>) {
	const parsed = webhookEndpointFormSchema.safeParse({ ...VALID, ...patch });
	return parsed.success ? {} : webhookFormErrors(parsed.error);
}

describe("webhookEndpointFormSchema", () => {
	it("accepts a named https endpoint with at least one scope and trims the name", () => {
		const parsed = webhookEndpointFormSchema.safeParse({
			...VALID,
			label: "  Home server  ",
		});

		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data.label).toBe("Home server");
	});

	it("requires a name within the length limit", () => {
		expect(errorsFor({ label: "   " }).label).toBe("Give the endpoint a name.");
		expect(
			errorsFor({ label: "x".repeat(WEBHOOK_LABEL_MAX + 1) }).label,
		).toMatch(/at most 80/);
	});

	it("refuses URLs that are not https, are malformed or carry credentials", () => {
		expect(errorsFor({ url: "" }).url).toBe(
			"Enter the URL to send your data to.",
		);
		expect(errorsFor({ url: "http://hooks.example.com/in" }).url).toBe(
			"The URL must start with https://.",
		);
		expect(errorsFor({ url: "hooks.example.com/in" }).url).toBe(
			"Enter a valid URL.",
		);
		expect(errorsFor({ url: "https://hooks.example.com/a b" }).url).toBe(
			"Enter a valid URL.",
		);
		expect(
			errorsFor({ url: "https://user:pw@hooks.example.com/" }).url,
		).toMatch(/username or password/);
	});

	it("does not second-guess hosts the server decides on", () => {
		// Private addresses and own hosts are refused by the server, which can
		// resolve the name. The form only checks what it can know.
		expect(errorsFor({ url: "https://10.0.0.1/in" })).toEqual({});
		expect(errorsFor({ url: "https://hooks.example.com:8443/in" })).toEqual({});
	});

	it("requires at least one known scope", () => {
		expect(errorsFor({ scopes: [] }).scopes).toBe(
			"Choose at least one kind of data to share.",
		);
		expect(errorsFor({ scopes: ["telemetry"] }).scopes).toBeDefined();
	});

	it("treats the custom header as optional, but a name and a value go together", () => {
		expect(errorsFor({ headerName: "", headerValue: "" })).toEqual({});
		expect(
			errorsFor({ headerName: "Authorization", headerValue: "Bearer abc" }),
		).toEqual({});
		expect(
			errorsFor({ headerName: "Authorization", headerValue: "" }).headerValue,
		).toBeDefined();
		expect(
			errorsFor({ headerName: "", headerValue: "Bearer abc" }).headerName,
		).toBeDefined();
	});

	it("refuses header names and values that could not be sent safely", () => {
		expect(
			errorsFor({ headerName: "bad name", headerValue: "v" }).headerName,
		).toBeDefined();
		expect(
			errorsFor({ headerName: "X-Key", headerValue: "a\r\nX-Injected: 1" })
				.headerValue,
		).toBeDefined();
		expect(
			errorsFor({
				headerName: "X-Key",
				headerValue: "a".repeat(WEBHOOK_HEADER_VALUE_MAX + 1),
			}).headerValue,
		).toBeDefined();
	});
});
