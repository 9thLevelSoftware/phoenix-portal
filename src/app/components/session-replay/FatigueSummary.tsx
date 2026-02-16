import { AlertTriangle } from 'lucide-react';
import type { FatigueAnalysis } from '@/lib/fatigue-detection';

interface FatigueSummaryProps {
  fatigue: FatigueAnalysis;
}

/**
 * Pre-playback fatigue warning card.
 * Shows actionable insight when fatigue is detected in the set.
 * Returns null if no fatigue detected.
 */
export function FatigueSummary({ fatigue }: FatigueSummaryProps) {
  if (!fatigue.isFatigued) {
    return null;
  }

  const severityStyles = getSeverityStyles(fatigue.severity);

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg
        ${severityStyles.background}
      `}
      role="alert"
    >
      <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${severityStyles.icon}`} />
      <div className="flex-1 min-w-0">
        <h4 className={`font-medium text-sm ${severityStyles.title}`}>Fatigue Detected</h4>
        {fatigue.insight && (
          <p className={`text-sm mt-1 ${severityStyles.text}`}>{fatigue.insight}</p>
        )}
        <div className="flex items-center gap-4 mt-2 text-xs">
          <span className={severityStyles.text}>
            Max drop: <span className="font-medium">{fatigue.velocityDropPercent}%</span>
          </span>
          {fatigue.fatigueStartRepIndex !== null && (
            <span className={severityStyles.text}>
              Started: <span className="font-medium">Rep {fatigue.fatigueStartRepIndex + 1}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function getSeverityStyles(severity: FatigueAnalysis['severity']) {
  switch (severity) {
    case 'high':
      return {
        background: 'bg-red-500/10 border border-red-500/20',
        icon: 'text-red-500',
        title: 'text-red-400',
        text: 'text-red-300/80',
      };
    case 'moderate':
      return {
        background: 'bg-amber-500/10 border border-amber-500/20',
        icon: 'text-amber-500',
        title: 'text-amber-400',
        text: 'text-amber-300/80',
      };
    default:
      return {
        background: 'bg-muted/10',
        icon: 'text-muted-foreground',
        title: 'text-foreground',
        text: 'text-muted-foreground',
      };
  }
}
