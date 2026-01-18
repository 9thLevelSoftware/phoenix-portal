import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Smartphone, RefreshCw, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface SyncStatusProps {
  lastSync?: string;
  status?: 'synced' | 'syncing' | 'pending' | 'error';
}

export function SyncStatus({ lastSync = '2 minutes ago', status = 'synced' }: SyncStatusProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'synced':
        return {
          icon: CheckCircle2,
          color: 'text-[#10B981]',
          bgColor: 'bg-[#10B981]/10',
          borderColor: 'border-[#10B981]/30',
          label: 'Synced',
        };
      case 'syncing':
        return {
          icon: RefreshCw,
          color: 'text-[#F59E0B]',
          bgColor: 'bg-[#F59E0B]/10',
          borderColor: 'border-[#F59E0B]/30',
          label: 'Syncing...',
          animate: true,
        };
      case 'pending':
        return {
          icon: Clock,
          color: 'text-[#6B7280]',
          bgColor: 'bg-[#6B7280]/10',
          borderColor: 'border-[#6B7280]/30',
          label: 'Pending',
        };
      case 'error':
        return {
          icon: AlertCircle,
          color: 'text-[#EF4444]',
          bgColor: 'bg-[#EF4444]/10',
          borderColor: 'border-[#EF4444]/30',
          label: 'Sync Error',
        };
      default:
        return {
          icon: CheckCircle2,
          color: 'text-[#10B981]',
          bgColor: 'bg-[#10B981]/10',
          borderColor: 'border-[#10B981]/30',
          label: 'Synced',
        };
    }
  };

  const config = getStatusConfig();
  const StatusIcon = config.icon;

  return (
    <Card className={`p-4 border ${config.borderColor} ${config.bgColor}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-[#0D0D0D] flex items-center justify-center ${config.color}`}>
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white text-sm font-medium">Project Phoenix Mobile</span>
            <Badge className={`${config.bgColor} ${config.color} border-0 text-xs`}>
              <StatusIcon className={`w-3 h-3 mr-1 ${config.animate ? 'animate-spin' : ''}`} />
              {config.label}
            </Badge>
          </div>
          <p className="text-xs text-[#9CA3AF]">
            <span className="text-[#6B7280]">App → Portal</span> • Last sync: {lastSync}
          </p>
        </div>
      </div>
    </Card>
  );
}