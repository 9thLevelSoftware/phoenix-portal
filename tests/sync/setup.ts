/**
 * Sync Test Suite Setup
 *
 * Provides test environment initialization, user management helpers,
 * and environment variable handling for sync validation tests.
 */

import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { TestUser } from "./helpers/edge-function-harness";
import {
	cleanupTestUser,
	createTestUser,
} from "./helpers/edge-function-harness";
import {
	getAnonClient,
	isLocalEnvironment,
} from "./helpers/supabase-test-client";

// Track test users for cleanup
const createdTestUsers: TestUser[] = [];

/**
 * Environment configuration for sync tests
 */
export interface SyncTestEnv {
	/** Supabase URL (local or remote) */
	supabaseUrl: string;
	/** Whether running against local Supabase */
	isLocal: boolean;
	/** Whether mocks are enabled */
	useMocks: boolean;
}

/**
 * Get current test environment configuration
 */
export function getTestEnv(): SyncTestEnv {
	const supabaseUrl = process.env.SUPABASE_URL || "http://localhost:54321";
	return {
		supabaseUrl,
		isLocal: isLocalEnvironment(),
		useMocks: process.env.MOCK_EDGE_FUNCTIONS === "true",
	};
}

/**
 * Validate environment variables are present
 * Returns list of missing required variables
 */
export function validateEnvVars(): string[] {
	const missing: string[] = [];

	// For non-mock mode, we need Supabase credentials
	if (process.env.MOCK_EDGE_FUNCTIONS !== "true") {
		if (!process.env.SUPABASE_URL && !isLocalEnvironment()) {
			missing.push("SUPABASE_URL");
		}
		if (!process.env.SUPABASE_ANON_KEY && !isLocalEnvironment()) {
			missing.push("SUPABASE_ANON_KEY");
		}
		if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !isLocalEnvironment()) {
			missing.push("SUPABASE_SERVICE_ROLE_KEY");
		}
	}

	return missing;
}

/**
 * Create a test user and track for cleanup
 * Use this in tests that need an authenticated user
 */
export async function createTrackedTestUser(
	email?: string,
	password?: string,
): Promise<TestUser> {
	const user = await createTestUser(email, password);
	createdTestUsers.push(user);
	return user;
}

/**
 * Clean up a specific test user
 */
export async function cleanupTrackedTestUser(user: TestUser): Promise<void> {
	await cleanupTestUser(user.id);
	const index = createdTestUsers.findIndex((u) => u.id === user.id);
	if (index !== -1) {
		createdTestUsers.splice(index, 1);
	}
}

/**
 * Clean up all tracked test users
 * Called automatically in afterAll hook
 */
export async function cleanupAllTestUsers(): Promise<void> {
	const cleanupPromises = createdTestUsers.map((user) =>
		cleanupTestUser(user.id).catch((err) => {
			console.warn(`Failed to cleanup test user ${user.id}:`, err);
		}),
	);

	await Promise.all(cleanupPromises);
	createdTestUsers.length = 0;
}

/**
 * Global test setup hook
 * Call this in your test file's beforeAll
 */
export function setupSyncTests(): void {
	beforeAll(async () => {
		const env = getTestEnv();
		console.log(
			`[Sync Tests] Environment: ${env.isLocal ? "local" : "remote"}`,
		);
		console.log(`[Sync Tests] Mocks: ${env.useMocks ? "enabled" : "disabled"}`);

		// Validate environment
		const missing = validateEnvVars();
		if (missing.length > 0 && !env.useMocks) {
			throw new Error(
				`Missing required environment variables: ${missing.join(", ")}. ` +
					"Set these variables or enable mocks with MOCK_EDGE_FUNCTIONS=true",
			);
		}

		// Verify connectivity
		if (!env.useMocks) {
			try {
				const client = getAnonClient();
				const { error } = await client.auth.getSession();
				if (error) {
					console.warn(
						"[Sync Tests] Auth connectivity check warning:",
						error.message,
					);
				}
			} catch (err) {
				console.warn("[Sync Tests] Supabase connectivity check failed:", err);
			}
		}
	});

	afterAll(async () => {
		// Clean up any test users created during tests
		await cleanupAllTestUsers();
	});
}

/**
 * Per-test isolation helpers
 */
export function setupTestIsolation(): void {
	const _testUser: TestUser | null = null;

	beforeEach(async () => {
		// Create fresh test user for each test if needed
		// Tests can use createTrackedTestUser() instead if they need specific control
	});

	afterEach(async () => {
		// Per-test cleanup handled by tracked user system
	});
}

export type { TestUser } from "./helpers/edge-function-harness";
export {
	cleanupTestUser,
	createTestUser,
} from "./helpers/edge-function-harness";
// Re-export commonly used items
export {
	getAnonClient,
	getServiceClient,
	isLocalEnvironment,
} from "./helpers/supabase-test-client";
