import type { ReactNode } from 'react';
import { useSubscription, type SubscriptionTier } from '@/hooks/useSubscription';
import { Skeleton } from '@/app/components/ui/skeleton';
import { UpgradePrompt } from '@/app/components/UpgradePrompt';

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

export function SubscriptionGate({ requiredTier, children, fallback }: SubscriptionGateProps) {
  const { tier, isLoading } = useSubscription();

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (TIER_LEVEL[tier] >= TIER_LEVEL[requiredTier]) {
    return <>{children}</>;
  }

  return <>{fallback ?? <UpgradePrompt requiredTier={requiredTier} currentTier={tier} />}</>;
}
