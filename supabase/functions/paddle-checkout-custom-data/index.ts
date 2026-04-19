import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hmacSha256Hex } from "../_shared/hmac.ts";

/**
 * Returns server-signed Paddle `custom_data` for Checkout.open.
 * Prevents clients from forging another user's user_id in custom_data (P1-10).
 */
Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("PADDLE_CUSTOM_DATA_SECRET");
  if (!secret?.trim()) {
    console.error("PADDLE_CUSTOM_DATA_SECRET is not set");
    return new Response(JSON.stringify({ error: "Billing signing not configured" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const cd_sig = await hmacSha256Hex(secret, user.id);
  return new Response(
    JSON.stringify({
      custom_data: {
        user_id: user.id,
        cd_sig,
      },
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
