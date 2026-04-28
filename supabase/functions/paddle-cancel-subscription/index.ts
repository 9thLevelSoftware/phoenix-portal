import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

// Service-role client for DB queries (bypasses RLS)
const supabaseAdmin = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
	const cors = getCorsHeaders(req);

	// CORS preflight
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}

	if (req.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}

	try {
		// Authenticate the user via their JWT
		const authHeader = req.headers.get("Authorization")!;
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

		// Rate limit: 3 requests per minute per user
		const rateCheck = await checkRateLimit(
			supabaseAdmin,
			{
				key: "paddle-cancel-subscription",
				userId: user.id,
				maxRequests: 3,
				windowSeconds: 60,
			},
			cors,
		);
		if (!rateCheck.allowed) return rateCheck.response!;

		// Look up user's current subscription
		const { data: sub, error: subError } = await supabaseAdmin
			.from("subscriptions")
			.select("paddle_subscription_id, status")
			.eq("user_id", user.id)
			.maybeSingle();

		if (subError) {
			console.error("Error fetching subscription:", subError);
			return new Response(
				JSON.stringify({ error: "Failed to fetch subscription" }),
				{
					status: 500,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Validate subscription state
		if (!sub || !sub.paddle_subscription_id) {
			return new Response(
				JSON.stringify({ error: "No active subscription found" }),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		if (!["active", "trialing"].includes(sub.status)) {
			return new Response(
				JSON.stringify({ error: "No active subscription found" }),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Call Paddle API to cancel the subscription at period end
		const paddleEnv = Deno.env.get("PADDLE_ENVIRONMENT") ?? "production";
		const baseUrl =
			paddleEnv === "sandbox"
				? "https://sandbox-api.paddle.com"
				: "https://api.paddle.com";
		const apiKey = Deno.env.get("PADDLE_API_KEY");

		if (!apiKey) {
			console.error("PADDLE_API_KEY is not set");
			return new Response(
				JSON.stringify({ error: "Billing service not configured" }),
				{
					status: 500,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		const paddleResponse = await fetch(
			`${baseUrl}/subscriptions/${sub.paddle_subscription_id}/cancel`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ effective_from: "next_billing_period" }),
			},
		);

		if (!paddleResponse.ok) {
			const paddleError = await paddleResponse.text();
			console.error("Paddle API error:", paddleResponse.status, paddleError);
			return new Response(
				JSON.stringify({
					error: "Failed to cancel subscription",
					details: paddleError,
				}),
				{
					status: 502,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error("paddle-cancel-subscription error:", err);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
});
