/**
 * Supabase Test Client Configuration
 *
 * Provides configured Supabase clients for test environments:
 * - Anon client: For user-authenticated operations
 * - Service client: For direct DB access in assertions (bypasses RLS)
 *
 * Supports both local Supabase (http://localhost:54321) and deployed instances.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Type import for Database (optional - tests may not have access to generated types)
// Using generic types to avoid build dependencies on generated types
type GenericDatabase = Record<string, unknown>;

/**
 * Default local Supabase configuration
 * Used when running `supabase start` locally
 */
const LOCAL_SUPABASE_URL = "http://localhost:54321";
const LOCAL_SUPABASE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/**
 * Singleton instances to avoid creating multiple clients
 */
let anonClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

/**
 * Get Supabase configuration from environment
 */
export function getSupabaseConfig(): {
	url: string;
	anonKey: string;
	serviceKey: string;
} {
	const isLocal = isLocalEnvironment();

	return {
		url: process.env.SUPABASE_URL || (isLocal ? LOCAL_SUPABASE_URL : ""),
		anonKey:
			process.env.SUPABASE_ANON_KEY || (isLocal ? LOCAL_SUPABASE_ANON_KEY : ""),
		serviceKey:
			process.env.SUPABASE_SERVICE_ROLE_KEY ||
			(isLocal ? LOCAL_SUPABASE_SERVICE_KEY : ""),
	};
}

/**
 * Check if running against local Supabase instance
 */
export function isLocalEnvironment(): boolean {
	const url = process.env.SUPABASE_URL || "";
	return (
		!url ||
		url.includes("localhost") ||
		url.includes("127.0.0.1") ||
		process.env.SUPABASE_LOCAL === "true"
	);
}

/**
 * Get anonymous client for user-authenticated operations
 * This client respects RLS policies and should be used for most test operations
 */
export function getAnonClient(): SupabaseClient {
	if (anonClient) {
		return anonClient;
	}

	const config = getSupabaseConfig();

	if (!config.url || !config.anonKey) {
		throw new Error(
			"Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY, " +
				"or run tests against local Supabase with SUPABASE_LOCAL=true",
		);
	}

	anonClient = createClient(config.url, config.anonKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	return anonClient;
}

/**
 * Get service role client for direct database access
 * Bypasses RLS - use only for test setup/teardown and assertions
 *
 * WARNING: Never expose service role key in client-side code or logs
 */
export function getServiceClient(): SupabaseClient {
	if (serviceClient) {
		return serviceClient;
	}

	const config = getSupabaseConfig();

	if (!config.url || !config.serviceKey) {
		throw new Error(
			"Missing Supabase service configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, " +
				"or run tests against local Supabase",
		);
	}

	serviceClient = createClient(config.url, config.serviceKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	return serviceClient;
}

/**
 * Get authenticated client for a specific user
 * Creates a new client instance with the user's JWT
 */
export function getAuthenticatedClient(accessToken: string): SupabaseClient {
	const config = getSupabaseConfig();

	if (!config.url || !config.anonKey) {
		throw new Error("Missing Supabase configuration for authenticated client");
	}

	return createClient(config.url, config.anonKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
		global: {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		},
	});
}

/**
 * Get the base URL for Edge Functions
 */
export function getEdgeFunctionUrl(functionName: string): string {
	const config = getSupabaseConfig();
	const baseUrl = config.url.replace(/\/$/, "");

	// Local development uses different port
	if (isLocalEnvironment()) {
		return `http://localhost:54321/functions/v1/${functionName}`;
	}

	return `${baseUrl}/functions/v1/${functionName}`;
}

/**
 * Reset singleton clients (useful for test isolation)
 */
export function resetClients(): void {
	anonClient = null;
	serviceClient = null;
}

/**
 * Health check for Supabase connectivity
 */
export async function checkSupabaseHealth(): Promise<{
	healthy: boolean;
	error?: string;
}> {
	try {
		const client = getAnonClient();
		const { error } = await client.auth.getSession();

		if (error) {
			return { healthy: false, error: error.message };
		}

		return { healthy: true };
	} catch (err) {
		return {
			healthy: false,
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
}
