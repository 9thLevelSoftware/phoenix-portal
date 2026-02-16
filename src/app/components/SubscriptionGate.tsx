import type { ReactNode } from 'react';
import { useSubscription, type SubscriptionTier } from '@/hooks/useSubscription';
import { Skeleton } from '@/app/components/ui/skeleton';

const TIER_LEVEL: Record<SubscriptionTier, number> = {
  FREE: 0,
  PHOENIX: 1,
  ELITE: 2,
};

interface SubscriptionGateProps {
  requiredTier: 'PHOENIX' | 'ELITE';
  children: ReactNode;
  fallback?: ReactNode;
}

function DefaultUpgradePrompt({ requiredTier }: { requiredTier: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-[#374151] bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] p-8 text-center">
      <div className="text-lg font-semibold text-zinc-200">
        Premium Content
      </div>
      <p className="text-sm text-zinc-400">
        Upgrade to <span className="font-medium text-orange-400">{requiredTier}</span> to access this content.
      </p>
      <button
        className="rounded-lg bg-gradient-to-r from-[#FF6B35] to-[#DC2626] px-6 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        onClick={() => {
          // Full UpgradePrompt with checkout flow will be built in plan 03-04
          console.log(`[Phoenix] Upgrade to ${requiredTier} clicked`);
        }}
      >
        Upgrade Now
      </button>
    </div>
  );
}

export function SubscriptionGate({ requiredTier, children, fallback }: SubscriptionGateProps) {
  const { tier, isLoading } = useSubscription();

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (TIER_LEVEL[tier] >= TIER_LEVEL[requiredTier]) {
    return <>{children}</>;
  }

  return <>{fallback ?? <DefaultUpgradePrompt requiredTier={requiredTier} />}</>;
}
