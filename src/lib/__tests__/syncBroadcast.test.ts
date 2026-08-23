import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncBroadcastTopic } from "@/lib/syncBroadcast";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function normalizeSource(source: string): string {
	return source.replace(/\r\n/g, "\n").trim();
}

describe("syncBroadcastTopic", () => {
	it("returns sync:{userId} with no suffix", () => {
		expect(syncBroadcastTopic(USER_ID)).toBe(`sync:${USER_ID}`);
		expect(syncBroadcastTopic(USER_ID)).not.toMatch(/:$/);
	});

	it("matches the Deno Edge helper string for the same user id", () => {
		const portal = readFileSync(
			join(process.cwd(), "src/lib/syncBroadcast.ts"),
			"utf8",
		);
		const edge = readFileSync(
			join(process.cwd(), "supabase/functions/_shared/syncBroadcast.ts"),
			"utf8",
		);
		const topicReturn = /return `sync:\$\{userId\}`/;
		expect(normalizeSource(portal)).toMatch(topicReturn);
		expect(normalizeSource(edge)).toMatch(topicReturn);
		expect(portal).toMatch(
			/export function syncBroadcastTopic\(userId: string\): string/,
		);
		expect(edge).toMatch(
			/export function syncBroadcastTopic\(userId: string\): string/,
		);
	});
});
