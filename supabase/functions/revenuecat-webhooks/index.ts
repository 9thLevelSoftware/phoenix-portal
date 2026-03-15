import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Functions duplicated from src/lib/revenuecat.ts — keep in sync

/**
 * Maps RevenueCat entitlement IDs to Phoenix Portal subscription tiers.
 * Priority: INFERNO > EMBER > FREE (highest tier wins).
 */
function mapEntitlementsToTier(
  entitlementIds: string[] | null | undefined
): string {
  if (!entitlementIds?.length) return "FREE";
  if (entitlementIds.includes("elite")) return "INFERNO";
  if (entitlementIds.includes("phoenix")) return "EMBER";
  return "FREE";
}

/**
 * Maps a RevenueCat event type to the portal's subscription status.
 * Returns null for events that don't map to a status change.
 */
function mapEventToStatus(
  eventType: string,
  periodType?: string
): string | null {
  switch (eventType) {
    case "INITIAL_PURCHASE":
      return periodType === "TRIAL" ? "trialing" : "active";
    case "RENEWAL":
    case "UNCANCELLATION":
    case "SUBSCRIPTION_EXTENDED":
    case "REFUND_REVERSED":
    case "PRODUCT_CHANGE":
      return "active";
    case "EXPIRATION":
      return "canceled";
    case "BILLING_ISSUE":
      return "past_due";
    case "CANCELLATION":
      return null; // Handled separately — cancel_at_period_end = true, status stays active
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate Authorization header
  const webhookSecret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const event = body.event;

    if (!event) {
      return new Response(
        JSON.stringify({ error: "Missing event payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle TEST event — return 200 without DB write
    if (event.type === "TEST") {
      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate app_user_id
    const appUserId = event.app_user_id;
    if (!appUserId) {
      return new Response(
        JSON.stringify({ error: "Missing app_user_id in event payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency check — skip if this event was already processed
    if (event.id) {
      const { data: existing } = await supabase
        .from("subscriptions")
        .select("last_event_id")
        .eq("user_id", appUserId)
        .maybeSingle();

      if (existing?.last_event_id === event.id) {
        return new Response(
          JSON.stringify({ received: true, duplicate: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Handle CANCELLATION specially — only set cancel_at_period_end, don't change status/tier
    if (event.type === "CANCELLATION") {
      const { error } = await supabase
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
          last_event_id: event.id,
        })
        .eq("user_id", appUserId);

      if (error) {
        console.error("Error updating subscription for CANCELLATION:", error);
        return new Response(
          JSON.stringify({ error: "Database update failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map entitlements to tier and event to status
    const tier = mapEntitlementsToTier(event.entitlement_ids);
    const status = mapEventToStatus(event.type, event.period_type);

    if (!status) {
      // Unknown event type — log and return 200 (don't trigger retry)
      console.log(`Unhandled event type: ${event.type}`);
      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build upsert payload
    const upsertData: Record<string, unknown> = {
      user_id: appUserId,
      revenuecat_customer_id: event.original_app_user_id ?? appUserId,
      tier,
      status,
      product_id: event.product_id ?? null,
      entitlement_ids: event.entitlement_ids ?? [],
      store: event.store ?? null,
      environment: event.environment ?? "PRODUCTION",
      current_period_end: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      current_period_start: event.purchased_at_ms
        ? new Date(event.purchased_at_ms).toISOString()
        : null,
      updated_at: new Date().toISOString(),
      last_event_id: event.id,
    };

    // UNCANCELLATION: explicitly reset cancel_at_period_end
    if (event.type === "UNCANCELLATION") {
      upsertData.cancel_at_period_end = false;
    }

    const { error } = await supabase
      .from("subscriptions")
      .upsert(upsertData, { onConflict: "user_id" });

    if (error) {
      console.error(`Error upserting subscription for ${event.type}:`, error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
