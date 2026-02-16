import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/lib/supabase';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const stripePromise = loadStripe(stripePublishableKey ?? '');

/**
 * Redirect user to Stripe Checkout for a given price.
 * Calls the stripe-checkout Edge Function which creates the session server-side.
 */
export async function redirectToCheckout(priceId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: { priceId },
  });

  if (error) {
    throw new Error(`Checkout failed: ${error.message}`);
  }

  if (!data?.url) {
    throw new Error('No checkout URL returned');
  }

  window.location.href = data.url;
}

/**
 * Redirect user to Stripe Customer Portal for managing their subscription.
 * Calls the stripe-portal Edge Function which creates the portal session server-side.
 */
export async function openCustomerPortal(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('stripe-portal');

  if (error) {
    throw new Error(`Portal failed: ${error.message}`);
  }

  if (!data?.url) {
    throw new Error('No portal URL returned');
  }

  window.location.href = data.url;
}
