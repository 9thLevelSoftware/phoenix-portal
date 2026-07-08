import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CycleDto,
	callPushEndpoint,
	createMinimalPushPayload,
} from "./helpers/edge-function-harness";
import {
	createTrackedTestUser,
	getServiceClient,
	liveIt,
	setupSyncTests,
} from "./setup";

setupSyncTests();

const LWW_RPC_MIGRATION = "20260707130000_update_lww_rpc_template_id.sql";
const PULL_RPC_MIGRATION = "20260707140000_update_pull_rpc_template_id.sql";
const CYCLE_PULL_SIGNATURE =
	"public.get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)";
const MOBILE_SYNC_PUSH_SOURCE = "supabase/functions/mobile-sync-push/index.ts";

function readMigration(filename: string): string {
	return readFileSync(
		join(process.cwd(), "supabase", "migrations", filename),
		"utf8",
	);
}

function readSource(filename: string): string {
	return readFileSync(join(process.cwd(), filename), "utf8");
}

function extractTrainingCycleLwwBody(sql: string): string {
	const match = sql.match(
		/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.upsert_training_cycle_lww\s*\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/i,
	);
	expect(match).not.toBeNull();
	return match?.[1] ?? "";
}

describe("Training cycle template_id migration safeguards", () => {
	it("keeps the LWW function conflict pragma while preserving existing template_id values", () => {
		const body = extractTrainingCycleLwwBody(readMigration(LWW_RPC_MIGRATION));

		expect(body).toMatch(/#variable_conflict\s+use_column/);
		expect(body).toMatch(
			/template_id\s*=\s*COALESCE\s*\(\s*EXCLUDED\.template_id\s*,\s*c\.template_id\s*\)/i,
		);
	});

	it("preserves LWW insert defaults for training cycle NOT NULL fields", () => {
		const body = extractTrainingCycleLwwBody(readMigration(LWW_RPC_MIGRATION));
		const expectedDefaults = [
			/COALESCE\s*\(\s*rec\.duration_weeks\s*,\s*4\s*\)/i,
			/COALESCE\s*\(\s*rec\.workout_days\s*,\s*0\s*\)/i,
			/COALESCE\s*\(\s*rec\.rest_days\s*,\s*0\s*\)/i,
			/COALESCE\s*\(\s*rec\.current_week\s*,\s*1\s*\)/i,
			/COALESCE\s*\(\s*rec\.status\s*,\s*'draft'\s*\)/i,
		];

		for (const expectedDefault of expectedDefaults) {
			expect(body).toMatch(expectedDefault);
		}
	});

	it("locks the recreated cycle pull RPC down to service_role", () => {
		const sql = readMigration(PULL_RPC_MIGRATION);

		expect(sql).toContain(
			`REVOKE ALL ON FUNCTION ${CYCLE_PULL_SIGNATURE} FROM PUBLIC;`,
		);
		expect(sql).toContain(
			`REVOKE ALL ON FUNCTION ${CYCLE_PULL_SIGNATURE} FROM anon;`,
		);
		expect(sql).toContain(
			`REVOKE ALL ON FUNCTION ${CYCLE_PULL_SIGNATURE} FROM authenticated;`,
		);
		expect(sql).toContain(
			`GRANT EXECUTE ON FUNCTION ${CYCLE_PULL_SIGNATURE} TO service_role;`,
		);
	});
});

describe("Training cycle template_id push handling", () => {
	it("chunks the legacy template_id preservation probe before PostgREST in filters", () => {
		const source = readSource(MOBILE_SYNC_PUSH_SOURCE);
		const lookupBlock = source.slice(
			source.indexOf("const cycleIdsMissingTemplateId ="),
			source.indexOf("const { error: cycErr } = await supabase"),
		);

		expect(lookupBlock).toContain("const chunkSize = 100;");
		expect(lookupBlock).toMatch(
			/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*cycleIdsMissingTemplateId\.length;\s*i\s*\+=\s*chunkSize\s*\)/,
		);
		expect(lookupBlock).toContain(".in('id', chunk)");
	});

	liveIt(
		"preserves an existing training_cycles.template_id when SYNC_LWW_ENABLED=false and mobile pushes templateId null",
		async () => {
			const testUser = await createTrackedTestUser();
			const serviceClient = getServiceClient();
			const cycleId = crypto.randomUUID();
			const startedAt = new Date("2026-07-07T12:00:00.000Z").toISOString();
			const existingTemplateId = "template_531";
			const subscriptionEndsAt = new Date(
				"2027-07-07T12:00:00.000Z",
			).toISOString();

			const { error: subscriptionError } = await serviceClient
				.from("subscriptions")
				.insert({
					user_id: testUser.id,
					tier: "EMBER",
					status: "active",
					current_period_end: subscriptionEndsAt,
				});
			expect(subscriptionError).toBeNull();

			const seedCycle: CycleDto = {
				id: cycleId,
				userId: testUser.id,
				name: "Existing Template Cycle",
				description: "Seed row for legacy non-LWW preservation",
				durationWeeks: 4,
				workoutDays: 4,
				restDays: 3,
				currentWeek: 1,
				status: "active",
				startedAt,
				lastUsedAt: startedAt,
				progressionSettings: null,
				deloadSettings: null,
				templateId: existingTemplateId,
				days: [],
			};
			const seedPushResult = await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { cycles: [seedCycle] }),
				testUser.accessToken,
			);
			expect(seedPushResult.success).toBe(true);

			const cycle: CycleDto = {
				id: cycleId,
				userId: testUser.id,
				name: "Updated Template Cycle",
				description: "Incoming payload omits template identity",
				durationWeeks: 6,
				workoutDays: 5,
				restDays: 2,
				currentWeek: 2,
				status: "active",
				startedAt,
				lastUsedAt: startedAt,
				progressionSettings: null,
				deloadSettings: null,
				templateId: null,
				days: [],
			};

			const pushResult = await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { cycles: [cycle] }),
				testUser.accessToken,
			);
			expect(pushResult.success).toBe(true);

			const { data: storedCycle, error: fetchError } = await serviceClient
				.from("training_cycles")
				.select("id, name, duration_weeks, template_id")
				.eq("id", cycleId)
				.single();
			expect(fetchError).toBeNull();
			expect(storedCycle).toMatchObject({
				id: cycleId,
				name: "Updated Template Cycle",
				duration_weeks: 6,
				template_id: existingTemplateId,
			});
		},
	);
});
