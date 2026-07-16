import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Environment = Record<string, string | undefined>;
type ResolvedCredentials = {
	url: string;
	anonKey: string;
	serviceRoleKey: string;
	previewRef: string;
	source: "direct" | "management-api";
};
type ResolverDependencies = {
	fetch?: typeof fetch;
};
type RunnerDependencies = ResolverDependencies & {
	appendFile?: (file: string, data: string) => Promise<void>;
	log?: (message: string) => void;
};

// The production entrypoint is executable ESM. Its public surface is described
// here so TypeScript still checks every test call without a test-only runtime
// wrapper around the resolver.
// @ts-expect-error The executable .mjs intentionally has no declaration file.
const resolverModule = (await import(
	"../../scripts/resolve-sync-preview.mjs"
)) as {
	resolveSyncPreviewCredentials: (
		environment: Environment,
		dependencies?: ResolverDependencies,
	) => Promise<ResolvedCredentials>;
	runSyncPreviewResolver: (
		environment: Environment,
		dependencies?: RunnerDependencies,
	) => Promise<void>;
};

const { resolveSyncPreviewCredentials, runSyncPreviewResolver } =
	resolverModule;
const resolverPath = path.resolve("scripts/resolve-sync-preview.mjs");
const workflowPath = path.resolve(".github/workflows/sync-tests.yml");
const productionRef = "ilzlswmatadlnsuxatcv";
const previewRef = "otygdxrzhlzooychegzb";
const otherRef = "abcdefghijklmnopqrst";
const gitBranch = "codex/profile-preferences-edge-functions";
const accessToken = "test-management-access-token-not-a-secret";
const publishableKey = "sb_publishable_test_0123456789abcdef";
const secretKey = "sb_secret_test_0123456789abcdef";
const legacyAnonKey =
	"eyJhbGciOiJIUzI1NiJ9.test-anon-payload.test-anon-signature";
const legacyServiceKey =
	"eyJhbGciOiJIUzI1NiJ9.test-service-payload.test-service-signature";

function fallbackEnvironment(overrides: Environment = {}): Environment {
	return {
		GITHUB_ENV: path.resolve("unused-github-env"),
		GITHUB_REF_NAME: gitBranch,
		STAGING_PROJECT_REF_INPUT: previewRef,
		SUPABASE_ACCESS_TOKEN: accessToken,
		SUPABASE_PROD_PROJECT_REF: productionRef,
		...overrides,
	};
}

function directEnvironment(overrides: Environment = {}): Environment {
	return fallbackEnvironment({
		SUPABASE_ACCESS_TOKEN: undefined,
		SUPABASE_PROD_PROJECT_REF: undefined,
		SYNC_STAGING_SUPABASE_URL: `https://${previewRef}.supabase.co`,
		SYNC_STAGING_SUPABASE_ANON_KEY: legacyAnonKey,
		SYNC_STAGING_SUPABASE_SERVICE_ROLE_KEY: legacyServiceKey,
		...overrides,
	});
}

function branch(overrides: Record<string, unknown> = {}) {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		name: gitBranch,
		project_ref: previewRef,
		parent_project_ref: productionRef,
		is_default: false,
		git_branch: gitBranch,
		pr_number: 88,
		latest_check_run_id: null,
		persistent: false,
		status: "FUNCTIONS_DEPLOYED",
		created_at: "2026-07-15T12:00:00.000Z",
		updated_at: "2026-07-16T12:00:00.000Z",
		review_requested_at: null,
		with_data: false,
		notify_url: null,
		deletion_scheduled_at: null,
		preview_project_status: "ACTIVE_HEALTHY",
		...overrides,
	};
}

function apiKey(
	type: "legacy" | "publishable" | "secret",
	name: string,
	value: string | null,
	overrides: Record<string, unknown> = {},
) {
	return {
		api_key: value,
		id: `${type}-${name}-id`,
		type,
		prefix: value?.slice(0, 12) ?? null,
		name,
		description: null,
		hash: null,
		secret_jwt_template: null,
		inserted_at: "2026-07-15T12:00:00.000Z",
		updated_at: "2026-07-16T12:00:00.000Z",
		...overrides,
	};
}

function preferredKeys() {
	return [
		apiKey("legacy", "anon", legacyAnonKey),
		apiKey("legacy", "service_role", legacyServiceKey),
		apiKey("publishable", "default", publishableKey),
		apiKey("secret", "default", secretKey),
	];
}

function managementApi(
	branchesBody: unknown,
	keysBody: unknown = preferredKeys(),
) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const fetcher = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = String(input);
		calls.push({ url, init });
		if (url.endsWith(`/v1/projects/${productionRef}/branches`)) {
			return Response.json(branchesBody);
		}
		if (url.endsWith(`/v1/projects/${previewRef}/api-keys?reveal=true`)) {
			return Response.json(keysBody);
		}
		return Response.json({ message: "unexpected test URL" }, { status: 404 });
	};

	return { calls, fetcher };
}

describe("sync preview credential resolver", () => {
	it("rejects the production project as the expected preview", () => {
		const result = spawnSync(process.execPath, [resolverPath], {
			encoding: "utf8",
			env: fallbackEnvironment({
				STAGING_PROJECT_REF_INPUT: productionRef,
			}),
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"Expected staging project ref must differ from the production project ref.",
		);
		expect(result.stderr).not.toContain(accessToken);
	});

	it("rejects invalid production and preview refs before any request", async () => {
		const fetcher = vi.fn<typeof fetch>();

		await expect(
			resolveSyncPreviewCredentials(
				fallbackEnvironment({ SUPABASE_PROD_PROJECT_REF: "not-a-ref" }),
				{ fetch: fetcher },
			),
		).rejects.toThrow("Production project ref is invalid.");
		await expect(
			resolveSyncPreviewCredentials(
				fallbackEnvironment({ STAGING_PROJECT_REF_INPUT: "not-a-ref" }),
				{ fetch: fetcher },
			),
		).rejects.toThrow("Expected staging project ref is invalid.");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each([
		["a missing preview", []],
		["a wrong preview", [branch({ project_ref: otherRef })]],
	])("rejects %s", async (_label, branchesBody) => {
		const api = managementApi(branchesBody);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).rejects.toThrow(
			`Expected preview ${previewRef} was not found in production branch metadata.`,
		);
		expect(api.calls).toHaveLength(1);
	});

	it.each([
		["default", { is_default: true }, "must not be the default branch"],
		[
			"cross-parent",
			{ parent_project_ref: otherRef },
			"does not belong to the configured production project",
		],
		[
			"wrong-git-branch",
			{ git_branch: "main" },
			"does not match GITHUB_REF_NAME",
		],
		[
			"failed migration",
			{ status: "MIGRATIONS_FAILED" },
			"is not ready (status: MIGRATIONS_FAILED)",
		],
		[
			"unhealthy project",
			{ preview_project_status: "ACTIVE_UNHEALTHY" },
			"is not healthy (preview status: ACTIVE_UNHEALTHY)",
		],
	])("rejects %s branch metadata", async (_label, override, message) => {
		const api = managementApi([branch(override)]);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).rejects.toThrow(message);
		expect(api.calls).toHaveLength(1);
	});

	it("accepts ready metadata when preview_project_status is absent", async () => {
		const preview = branch();
		delete preview.preview_project_status;
		const api = managementApi([preview]);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).resolves.toMatchObject({ previewRef, source: "management-api" });
	});

	it.each([
		["the platform array", [branch()]],
		["the client wrapper", { branches: [branch()] }],
	])("supports %s branch-list response", async (_label, branchesBody) => {
		const api = managementApi(branchesBody);

		const result = await resolveSyncPreviewCredentials(fallbackEnvironment(), {
			fetch: api.fetcher,
		});

		expect(result).toEqual({
			url: `https://${previewRef}.supabase.co`,
			anonKey: publishableKey,
			serviceRoleKey: secretKey,
			previewRef,
			source: "management-api",
		});
		expect(api.calls.map(({ url }) => url)).toEqual([
			`https://api.supabase.com/v1/projects/${productionRef}/branches`,
			`https://api.supabase.com/v1/projects/${previewRef}/api-keys?reveal=true`,
		]);
		for (const { init } of api.calls) {
			expect(init?.method).toBe("GET");
			expect(init?.headers).toMatchObject({
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
			});
		}
	});

	it("uses a complete direct-secret set without calling the Management API", async () => {
		const fetcher = vi.fn<typeof fetch>();

		await expect(
			resolveSyncPreviewCredentials(directEnvironment(), { fetch: fetcher }),
		).resolves.toEqual({
			url: `https://${previewRef}.supabase.co`,
			anonKey: legacyAnonKey,
			serviceRoleKey: legacyServiceKey,
			previewRef,
			source: "direct",
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("rejects a direct-secret target that matches a configured production ref", async () => {
		await expect(
			resolveSyncPreviewCredentials(
				directEnvironment({
					STAGING_PROJECT_REF_INPUT: otherRef,
					SUPABASE_PROD_PROJECT_REF: otherRef,
					SYNC_STAGING_SUPABASE_URL: `https://${otherRef}.supabase.co`,
				}),
			),
		).rejects.toThrow(
			"Expected staging project ref must differ from the production project ref.",
		);
	});

	it.each([
		[`https://${otherRef}.supabase.co`, "does not exactly match"],
		[
			`https://${previewRef}.supabase.co.evil.example`,
			"does not exactly match",
		],
		[`https://${previewRef}.supabase.co/path`, "does not exactly match"],
		["https://api.phoenix-portal.com", "known production host"],
	])("rejects direct URL %s", async (url, message) => {
		await expect(
			resolveSyncPreviewCredentials(
				directEnvironment({ SYNC_STAGING_SUPABASE_URL: url }),
			),
		).rejects.toThrow(message);
	});

	it("accepts the exact regional direct-secret host", async () => {
		await expect(
			resolveSyncPreviewCredentials(
				directEnvironment({
					SYNC_STAGING_SUPABASE_URL: `https://${previewRef}.supabase.in/`,
				}),
			),
		).resolves.toMatchObject({
			url: `https://${previewRef}.supabase.in/`,
			source: "direct",
		});
	});

	it.each([
		["URL only", { SYNC_STAGING_SUPABASE_ANON_KEY: undefined }],
		[
			"client key only",
			{
				SYNC_STAGING_SUPABASE_URL: undefined,
				SYNC_STAGING_SUPABASE_SERVICE_ROLE_KEY: undefined,
			},
		],
		[
			"elevated key only",
			{
				SYNC_STAGING_SUPABASE_URL: undefined,
				SYNC_STAGING_SUPABASE_ANON_KEY: undefined,
			},
		],
	])("rejects a partial direct-secret set: %s", async (_label, override) => {
		await expect(
			resolveSyncPreviewCredentials(directEnvironment(override)),
		).rejects.toThrow(
			"Direct staging credentials are partially configured; refusing to mix credential sources.",
		);
	});

	it("requires one unambiguous expected staging ref in live mode", async () => {
		await expect(
			resolveSyncPreviewCredentials(
				directEnvironment({ STAGING_PROJECT_REF_INPUT: undefined }),
			),
		).rejects.toThrow(
			"Expected staging project ref is required for live mode.",
		);
		await expect(
			resolveSyncPreviewCredentials(
				directEnvironment({
					SYNC_STAGING_PROJECT_REF: previewRef,
					STAGING_PROJECT_REF_INPUT: otherRef,
				}),
			),
		).rejects.toThrow("Configured and dispatched staging project refs differ.");
	});

	it("prefers publishable and secret keys over valid legacy keys", async () => {
		const api = managementApi([branch()], preferredKeys());

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).resolves.toMatchObject({
			anonKey: publishableKey,
			serviceRoleKey: secretKey,
		});
	});

	it("falls back to legacy anon and service_role keys", async () => {
		const api = managementApi(
			[branch()],
			[
				apiKey("legacy", "anon", legacyAnonKey),
				apiKey("legacy", "service_role", legacyServiceKey),
			],
		);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).resolves.toMatchObject({
			anonKey: legacyAnonKey,
			serviceRoleKey: legacyServiceKey,
		});
	});

	it("ignores disabled new keys and uses enabled legacy fallbacks", async () => {
		const api = managementApi(
			[branch()],
			[
				apiKey("publishable", "default", publishableKey, { disabled: true }),
				apiKey("secret", "default", secretKey, { disabled: true }),
				apiKey("legacy", "anon", legacyAnonKey),
				apiKey("legacy", "service_role", legacyServiceKey),
			],
		);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).resolves.toMatchObject({
			anonKey: legacyAnonKey,
			serviceRoleKey: legacyServiceKey,
		});
	});

	it("selects usable keys after disabled or masked candidates", async () => {
		const api = managementApi(
			[branch()],
			[
				apiKey("publishable", "disabled", publishableKey, { disabled: true }),
				apiKey("publishable", "masked", "sb_publishable_********"),
				apiKey("publishable", "active", publishableKey),
				apiKey("secret", "disabled", secretKey, { disabled: true }),
				apiKey("secret", "masked", "sb_secret_••••••••"),
				apiKey("secret", "active", secretKey),
			],
		);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).resolves.toMatchObject({
			anonKey: publishableKey,
			serviceRoleKey: secretKey,
		});
	});

	it.each([
		[
			"missing publishable/anon key",
			[apiKey("secret", "default", secretKey)],
			"No usable publishable or anon key",
		],
		[
			"disabled elevated key",
			[
				apiKey("publishable", "default", publishableKey),
				apiKey("secret", "default", secretKey, { disabled: true }),
			],
			"No usable secret or service_role key",
		],
		[
			"masked client key",
			[
				apiKey("publishable", "default", "sb_publishable_********"),
				apiKey("secret", "default", secretKey),
			],
			"No usable publishable or anon key",
		],
		[
			"masked elevated key",
			[
				apiKey("publishable", "default", publishableKey),
				apiKey("secret", "default", "sb_secret_••••••••"),
			],
			"No usable secret or service_role key",
		],
		[
			"multiline client key",
			[
				apiKey("publishable", "default", `${publishableKey}\nleak`),
				apiKey("secret", "default", secretKey),
			],
			"No usable publishable or anon key",
		],
		[
			"missing revealed elevated key",
			[
				apiKey("publishable", "default", publishableKey),
				apiKey("secret", "default", null),
			],
			"No usable secret or service_role key",
		],
	])("rejects %s", async (_label, keys, message) => {
		const api = managementApi([branch()], keys);

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			}),
		).rejects.toThrow(message);
	});

	it("sanitizes Management API HTTP failures without reading response bodies", async () => {
		const sensitiveBody = "response-contained-sensitive-value";
		const fetcher: typeof fetch = async () =>
			new Response(sensitiveBody, { status: 403, statusText: sensitiveBody });

		let failure: unknown;
		try {
			await resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: fetcher,
			});
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			"Management API branch-list request failed with HTTP 403.",
		);
		expect((failure as Error).message).not.toContain(sensitiveBody);
		expect((failure as Error).message).not.toContain(accessToken);
	});

	it("sanitizes Management API network errors", async () => {
		const sensitiveCause = "network-error-contained-sensitive-value";
		const fetcher: typeof fetch = async () => {
			throw new Error(sensitiveCause);
		};

		await expect(
			resolveSyncPreviewCredentials(fallbackEnvironment(), { fetch: fetcher }),
		).rejects.toThrow("Management API branch-list request failed.");
		try {
			await resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: fetcher,
			});
		} catch (error) {
			expect((error as Error).message).not.toContain(sensitiveCause);
			expect((error as Error).message).not.toContain(accessToken);
		}
	});

	it("does not echo unexpected branch status values", async () => {
		const sensitiveStatus = "MIGRATIONS_FAILED\nsecret-shaped-status";
		const api = managementApi([branch({ status: sensitiveStatus })]);

		let failure: unknown;
		try {
			await resolveSyncPreviewCredentials(fallbackEnvironment(), {
				fetch: api.fetcher,
			});
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain("status: INVALID");
		expect((failure as Error).message).not.toContain(sensitiveStatus);
	});

	it("masks both keys before writing resolved values to GITHUB_ENV", async () => {
		const events: string[] = [];
		const githubEnv = path.resolve("captured-github-env");

		await runSyncPreviewResolver(directEnvironment({ GITHUB_ENV: githubEnv }), {
			appendFile: async (file, data) => {
				events.push(`append:${file}:${data}`);
			},
			log: (message) => events.push(`log:${message}`),
		});

		expect(events.slice(0, 2)).toEqual([
			`log:::add-mask::${legacyAnonKey}`,
			`log:::add-mask::${legacyServiceKey}`,
		]);
		expect(events[2]).toBe(
			`append:${githubEnv}:SUPABASE_URL=https://${previewRef}.supabase.co\nSUPABASE_ANON_KEY=${legacyAnonKey}\nSUPABASE_SERVICE_ROLE_KEY=${legacyServiceKey}\nSYNC_STAGING_PROJECT_REF=${previewRef}\n`,
		);
		expect(events.join("\n")).not.toContain(accessToken);
	});

	it("wires live workflow credentials through the resolver and GITHUB_ENV", async () => {
		const workflow = await readFile(workflowPath, "utf8");
		const resolver = await readFile(resolverPath, "utf8");

		expect(workflow).toContain("staging_project_ref:");
		expect(workflow).toMatch(/staging_project_ref:[\s\S]*?type: string/);
		expect(workflow).toContain("node scripts/resolve-sync-preview.mjs");
		expect(workflow.match(/scripts\/resolve-sync-preview\.mjs/g)).toHaveLength(
			3,
		);
		expect(workflow).toMatch(
			/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/,
		);
		expect(workflow).toMatch(
			/SUPABASE_PROD_PROJECT_REF: \$\{\{ secrets\.SUPABASE_PROD_PROJECT_REF \}\}/,
		);
		expect(workflow).toMatch(
			/STAGING_PROJECT_REF_INPUT: \$\{\{ inputs\.staging_project_ref \}\}/,
		);
		expect(workflow).not.toContain("SUPABASE_PROD_DB_PASSWORD");
		expect(workflow).toMatch(
			/- name: Run sync tests \(live mode\)[\s\S]*?run: npm run test:sync:live\s*\n\s*env:\s*\n\s*MOCK_EDGE_FUNCTIONS:/,
		);
		expect(workflow).not.toMatch(
			/- name: Run sync tests \(live mode\)[\s\S]*?SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY):/,
		);
		expect(resolver).toContain("api.phoenix-portal.com");
		expect(resolver).toContain(".supabase.co");
		expect(resolver).toContain(".supabase.in");
	});
});
