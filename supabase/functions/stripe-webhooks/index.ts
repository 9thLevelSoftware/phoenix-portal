import Stripe from 'https://esm.sh/stripe@14?target=denonext';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20',
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Use service role key -- webhooks need to write to subscriptions table
// (bypasses RLS, which is intentional for server-side webhook processing)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

/**
 * Map a Stripe price ID to a subscription tier by reading
 * the price-to-tier mapping from environment variables.
 */
function getTierFromPriceId(priceId: string): string {
  const mapping: Record<string, string> = {
    [Deno.env.get('STRIPE_PHOENIX_MONTHLY_PRICE_ID')!]: 'PHOENIX',
    [Deno.env.get('STRIPE_PHOENIX_ANNUAL_PRICE_ID')!]: 'PHOENIX',
    [Deno.env.get('STRIPE_ELITE_MONTHLY_PRICE_ID')!]: 'ELITE',
    [Deno.env.get('STRIPE_ELITE_ANNUAL_PRICE_ID')!]: 'ELITE',
  };
  return mapping[priceId] ?? 'FREE';
}

/**
 * Look up the Supabase user ID from a Stripe customer ID
 * by querying the profiles table.
 */
async function getUserIdFromCustomer(
  customerId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  if (!signature) {
    return new Response(
      JSON.stringify({ error: 'Missing Stripe-Signature header' }),
      { status: 400 }
    );
  }

  // MUST use .text() not .json() -- signature verification needs raw body
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.subscription) break;

        // Retrieve full subscription object from Stripe
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );
        const priceId = subscription.items.data[0].price.id;
        const customerId = session.customer as string;

        // Look up Supabase user_id from profiles table
        const userId = await getUserIdFromCustomer(customerId);
        if (!userId) {
          console.error(
            `No user found for Stripe customer ${customerId}`
          );
          break;
        }

        await supabase.from('subscriptions').upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            tier: getTierFromPriceId(priceId),
            status: subscription.status,
            price_id: priceId,
            current_period_start: new Date(
              subscription.current_period_start * 1000
            ).toISOString(),
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
          },
          { onConflict: 'user_id' }
        );
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const priceId = subscription.items.data[0].price.id;

        await supabase
          .from('subscriptions')
          .update({
            tier: getTierFromPriceId(priceId),
            status: subscription.status,
            price_id: priceId,
            current_period_start: new Date(
              subscription.current_period_start * 1000
            ).toISOString(),
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            invoice.subscription as string
          );
          await supabase
            .from('subscriptions')
            .update({
              status: subscription.status,
              current_period_start: new Date(
                subscription.current_period_start * 1000
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', invoice.subscription as string);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          await supabase
            .from('subscriptions')
            .update({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', invoice.subscription as string);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err);
    return new Response(
      JSON.stringify({ error: 'Webhook handler failed' }),
      { status: 500 }
    );
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
