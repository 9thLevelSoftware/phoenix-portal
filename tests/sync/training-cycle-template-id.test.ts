import { describe, expect } from "vitest";
import {
	callPushEndpoint,
	createMinimalPushPayload,
	type CycleDto,
} from "./helpers/edge-function-harness";
import {
	createTrackedTestUser,
	getServiceClient,
	liveIt,
	setupSyncTests,
} from "./setup";

setupSyncTests();

describe("Training cycle template_id push handling", () => {
	liveIt(
		"preserves an existing training_cycles.template_id when SYNC_LWW_ENABLED=false and mobile pushes templateId null",
		async () => {
			const testUser = await createTrackedTestUser();
			const serviceClient = getServiceClient();
			const cycleId = crypto.randomUUID();
			const startedAt = new Date("2026-07-07T12:00:00.000Z").toISOString();
			const existingTemplateId = "template_531";
			const subscriptionEndsAt = new Date("2027-07-07T12:00:00.000Z").toISOString();

			const { error: subscriptionError } = await serviceClient.from("subscriptions").insert({
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
