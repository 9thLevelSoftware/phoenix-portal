import {
  Activity,
  Watch,
  Dumbbell,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card';
import {
  PROVIDER_METADATA,
  type IntegrationProvider,
  type UserIntegration,
} from '@/lib/integrations/types';

// Map PROVIDER_METADATA icon string to actual lucide component
const ICON_MAP: Record<string, typeof Activity> = {
  Activity,
  Watch,
  Dumbbell,
};

interface ProviderCardProps {
  provider: IntegrationProvider;
  integration: UserIntegration | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isLoading?: boolean;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ProviderCard({
  provider,
  integration,
  onConnect,
  onDisconnect,
  onSync,
  isLoading,
}: ProviderCardProps) {
  const meta = PROVIDER_METADATA[provider];
  const Icon = ICON_MAP[meta.icon] ?? Activity;

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-lg bg-[var(--color-phoenix-primary)]/10">
            <Icon className="size-5 text-[var(--color-phoenix-primary)]" />
          </div>
          <div>
            <CardTitle className="text-base">{meta.name}</CardTitle>
            <CardDescription>{meta.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {integration?.status === 'connected' ? (
          <div className="space-y-4">
            <Badge className="bg-[var(--color-forge-green)]/20 text-[var(--color-forge-green)] border-transparent">
              Connected
            </Badge>
            <p className="text-sm text-muted-foreground">
              Last synced: {formatRelative(integration.last_sync_at)}
            </p>
            {integration.error_message && (
              <Alert variant="destructive">
                <AlertDescription>{integration.error_message}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button onClick={onSync} size="sm" disabled={isLoading}>
                <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
                Sync Now
              </Button>
              <Button onClick={onDisconnect} variant="outline" size="sm">
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={onConnect} disabled={isLoading}>
            Connect {meta.name}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
