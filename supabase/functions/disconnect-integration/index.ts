import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { readJsonObject } from "../_shared/requestValidation.ts";

// Service-role client for DB operations (bypasses RLS)
const supabaseAdmin = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ALLOWED_PROVIDERS = new Set([
	"strava",
	"fitbit",
	"garmin",
	"hevy",
	"liftosaur",
	"apple_health",
	"google_health",
]);

Deno.serve(async (req) => {
	const cors = getCorsHeaders(req);

	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}

	try {
		const authHeader = req.headers.get("Authorization");
		if (!authHeader) {
			return new Response(JSON.stringify({ error: "Missing authorization" }), {
				status: 401,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}

		const supabase = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_ANON_KEY")!,
			{ global: { headers: { Authorization: authHeader } } },
		);
		const {
			data: { user },
		} = await supabase.auth.getUser();

		if (!user) {
			return new Response(JSON.stringify({ error: "Not authenticated" }), {
				status: 401,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}

		// Rate limit: 5 requests per minute per user
		const rateCheck = await checkRateLimit(
			supabaseAdmin,
			{
				key: "disconnect-integration",
				userId: user.id,
				maxRequests: 5,
				windowSeconds: 60,
			},
			cors,
		);
		if (!rateCheck.allowed) return rateCheck.response!;

		const parsedBody = await readJsonObject(req, cors);
		if (!parsedBody.ok) return parsedBody.response;

		const provider =
			typeof parsedBody.data.provider === "string"
				? parsedBody.data.provider
				: "";
		if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
			return new Response(
				JSON.stringify({ error: "Unsupported integration provider" }),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		const timestamp = new Date().toISOString();

		const [
			{ error: tokenError },
			{ error: integrationError },
			{ error: queueError },
		] = await Promise.all([
			supabaseAdmin
				.from("oauth_tokens")
				.delete()
				.eq("user_id", user.id)
				.eq("provider", provider),
			supabaseAdmin
				.from("user_integrations")
				.update({
					status: "disconnected",
					connected_at: null,
					provider_user_id: null,
					error_message: null,
				})
				.eq("user_id", user.id)
				.eq("provider", provider),
			supabaseAdmin
				.from("sync_queue")
				.update({
					status: "failed",
					error_message: "Integration disconnected by user",
					completed_at: timestamp,
				})
				.eq("user_id", user.id)
				.eq("provider", provider)
				.in("status", ["pending", "processing"]),
		]);

		if (tokenError) throw tokenError;
		if (integrationError) throw integrationError;
		if (queueError) throw queueError;

		return new Response(JSON.stringify({ success: true }), {
			headers: { ...cors, "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error("disconnect-integration error:", err);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
});
