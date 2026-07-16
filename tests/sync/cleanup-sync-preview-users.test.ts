import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const cleanupPath = path.resolve("scripts/cleanup-sync-preview-users.mjs");
const workflowPath = path.resolve(".github/workflows/sync-tests.yml");
const resolverPath = path.resolve("scripts/resolve-sync-preview.mjs");
const validationPath = path.resolve("tests/sync/validation.test.ts");
const trainingCyclePath = path.resolve(
	"tests/sync/training-cycle-template-id.test.ts",
);
const readmePath = path.resolve("tests/sync/README.md");
const previewRef = "otygdxrzhlzooychegzb";
const productionRef = "ilzlswmatadlnsuxatcv";
const serviceKey = "sb_secret_synthetic_cleanup_key";

type CleanupEnvironment = Record<string, string | undefined>;
type CleanupDependencies = {
	createClient?: (...args: unknown[]) => unknown;
	log?: (message: string) => void;
};

// @ts-expect-error The executable .mjs intentionally has no declaration file.
const cleanupModule = (await import(
	"../../scripts/cleanup-sync-preview-users.mjs"
)) as {
	cleanupSyncPreviewUsers: (
		environment: CleanupEnvironment,
		dependencies?: CleanupDependencies,
	) => Promise<number>;
};

const { cleanupSyncPreviewUsers } = cleanupModule;

function cleanupEnvironment(
	overrides: CleanupEnvironment = {},
): CleanupEnvironment {
	return {
		SUPABASE_URL: `https://${previewRef}.supabase.co`,
		SUPABASE_SERVICE_ROLE_KEY: serviceKey,
		SYNC_STAGING_PROJECT_REF: previewRef,
		SUPABASE_PROD_PROJECT_REF: productionRef,
		...overrides,
	};
}

function authUser(id: string, email: string) {
	return {
		id,
		aud: "authenticated",
		role: "authenticated",
		email,
		email_confirmed_at: "2026-07-16T12:00:00.000Z",
		phone: "",
		confirmed_at: "2026-07-16T12:00:00.000Z",
		last_sign_in_at: "2026-07-16T12:01:00.000Z",
		app_metadata: { provider: "email", providers: ["email"] },
		user_metadata: {},
		identities: [],
		created_at: "2026-07-16T12:00:00.000Z",
		updated_at: "2026-07-16T12:01:00.000Z",
		is_anonymous: false,
	};
}

function cleanupClient(pages: unknown[][]) {
	const listUsers = vi.fn();
	for (const users of pages) {
		listUsers.mockResolvedValueOnce({
			data: {
				users,
				aud: "authenticated",
				nextPage: null,
				lastPage: pages.length,
				total: pages.flat().length,
			},
			error: null,
		});
	}
	const deleteUser = vi.fn().mockResolvedValue({
		data: { user: null },
		error: null,
	});
	const client = { auth: { admin: { listUsers, deleteUser } } };
	const createClient = vi.fn(() => client);
	return { createClient, deleteUser, listUsers };
}

describe("sync preview namespace cleanup", () => {
	it("fails closed without a validated preview target", () => {
		const result = spawnSync(process.execPath, [cleanupPath], {
			encoding: "utf8",
			env: {},
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"::error::Sync preview cleanup target configuration is invalid.",
		);
	});

	it.each([
		[
			"a mismatched host",
			{ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
		],
		[
			"a host suffix",
			{ SUPABASE_URL: `https://${previewRef}.supabase.co.evil.example` },
		],
		[
			"the known production host",
			{ SUPABASE_URL: `https://${productionRef}.supabase.co` },
		],
		[
			"the configured production ref",
			{
				SYNC_STAGING_PROJECT_REF: productionRef,
				SUPABASE_URL: `https://${productionRef}.supabase.co`,
			},
		],
		["a missing elevated key", { SUPABASE_SERVICE_ROLE_KEY: undefined }],
	])("rejects %s before creating a client", async (_label, overrides) => {
		const createClient = vi.fn();

		await expect(
			cleanupSyncPreviewUsers(cleanupEnvironment(overrides), { createClient }),
		).rejects.toThrow("Sync preview cleanup target configuration is invalid.");
		expect(createClient).not.toHaveBeenCalled();
	});

	it("lists every page before deleting only generated namespace users", async () => {
		const firstDisposableId = "11111111-1111-4111-8111-111111111111";
		const secondDisposableId = "22222222-2222-4222-8222-222222222222";
		const firstPage = Array.from({ length: 1000 }, (_, index) =>
			index === 0
				? authUser(firstDisposableId, "sync-test-12345-abc@test.local")
				: authUser(
						`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
						`ordinary-${index}@example.com`,
					),
		);
		const api = cleanupClient([
			firstPage,
			[
				authUser(secondDisposableId, "sync-test-67890-def@test.local"),
				authUser(
					"33333333-3333-4333-8333-333333333333",
					"sync-test-should-not-match@example.com",
				),
			],
		]);
		const logs: string[] = [];

		await expect(
			cleanupSyncPreviewUsers(cleanupEnvironment(), {
				createClient: api.createClient,
				log: (message) => logs.push(message),
			}),
		).resolves.toBe(2);
		expect(api.listUsers.mock.calls).toEqual([
			[{ page: 1, perPage: 1000 }],
			[{ page: 2, perPage: 1000 }],
		]);
		expect(api.deleteUser.mock.calls).toEqual([
			[firstDisposableId],
			[secondDisposableId],
		]);
		expect(logs).toEqual([
			`Deleted 2 disposable sync test users from preview ${previewRef}.`,
		]);
		const transcript = logs.join("\n");
		expect(transcript).not.toContain(firstDisposableId);
		expect(transcript).not.toContain("sync-test-12345-abc@test.local");
		expect(transcript).not.toContain(serviceKey);
	});

	it("continues deletion but fails when any required delete fails", async () => {
		const firstId = "11111111-1111-4111-8111-111111111111";
		const secondId = "22222222-2222-4222-8222-222222222222";
		const api = cleanupClient([
			[
				authUser(firstId, "sync-test-12345-abc@test.local"),
				authUser(secondId, "sync-test-67890-def@test.local"),
			],
		]);
		api.deleteUser
			.mockResolvedValueOnce({
				data: null,
				error: { message: `do not print ${firstId}` },
			})
			.mockResolvedValueOnce({ data: { user: null }, error: null });

		await expect(
			cleanupSyncPreviewUsers(cleanupEnvironment(), {
				createClient: api.createClient,
			}),
		).rejects.toThrow(
			`Sync preview cleanup could not delete all disposable users for preview ${previewRef}.`,
		);
		expect(api.deleteUser.mock.calls).toEqual([[firstId], [secondId]]);
	});

	it("sanitizes list failures", async () => {
		const sensitiveMessage = "do not print an upstream credential or identity";
		const listUsers = vi.fn().mockResolvedValue({
			data: { users: [] },
			error: { message: sensitiveMessage },
		});
		const createClient = vi.fn(() => ({
			auth: { admin: { listUsers, deleteUser: vi.fn() } },
		}));

		let failure: unknown;
		try {
			await cleanupSyncPreviewUsers(cleanupEnvironment(), { createClient });
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			`Sync preview cleanup could not list disposable users for preview ${previewRef}.`,
		);
		expect((failure as Error).message).not.toContain(sensitiveMessage);
		expect((failure as Error).message).not.toContain(serviceKey);
	});

	it("wires guaranteed cleanup, resolver ref handoff, diagnostics, and exceptions", async () => {
		const [workflow, resolver, validation, trainingCycle, readme] =
			await Promise.all([
				readFile(workflowPath, "utf8"),
				readFile(resolverPath, "utf8"),
				readFile(validationPath, "utf8"),
				readFile(trainingCyclePath, "utf8"),
				readFile(readmePath, "utf8"),
			]);

		expect(
			workflow.match(/scripts\/cleanup-sync-preview-users\.mjs/g),
		).toHaveLength(3);
		expect(workflow).toMatch(
			/- name: Clean up live sync test users\s+if: \$\{\{ always\(\) && github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.use_mocks == 'false' \}\}\s+run: node scripts\/cleanup-sync-preview-users\.mjs/,
		);
		expect(workflow.indexOf("Clean up live sync test users")).toBeGreaterThan(
			workflow.indexOf("Run sync tests (live mode)"),
		);
		expect(workflow.indexOf("Clean up live sync test users")).toBeLessThan(
			workflow.indexOf("Upload test results"),
		);
		expect(workflow).toContain("SYNC_LIVE_DEBUG_FAILURES: 'true'");
		expect(workflow).toContain("timeout-minutes: 20");
		expect(workflow).not.toContain("max-parallel: 1");
		expect(resolver).toMatch(
			/SYNC_STAGING_PROJECT_REF=\$\{credentials\.previewRef\}/,
		);
		expect(validation).toMatch(
			/createTestUser\(\s*undefined,\s*undefined,\s*\{\s*seedSubscription:\s*false,?\s*\}\s*\)/,
		);
		expect(trainingCycle).toMatch(
			/createTrackedTestUser\(\s*undefined,\s*undefined,\s*\{\s*seedSubscription:\s*false,?\s*\}\s*\)/,
		);
		expect(readme).toContain("admin.createUser");
		expect(readme).toContain("seedSubscription: false");
		expect(readme).toContain("always-run cleanup");
	});
});
