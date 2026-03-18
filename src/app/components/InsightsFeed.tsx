import { AlertTriangle, Info, Trophy, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";

export interface InsightItem {
  id: string;
  type: "success" | "warning" | "info" | "achievement";
  title: string;
  description: string;
  recommendation?: string;
  metric?: { name: string; value: number; unit: string; delta?: number };
}

export interface InsightsFeedProps {
  insights: InsightItem[];
  loading?: boolean;
}

const TYPE_CONFIG = {
  success: {
    color: "#10B981",
    Icon: TrendingUp,
  },
  warning: {
    color: "#F59E0B",
    Icon: AlertTriangle,
  },
  info: {
    color: "#3B82F6",
    Icon: Info,
  },
  achievement: {
    color: "#FF6B35",
    Icon: Trophy,
  },
} as const;

function InsightSkeleton() {
  return (
    <Card className="border-border overflow-hidden">
      <div className="flex gap-4 p-4">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    </Card>
  );
}

export function InsightsFeed({ insights, loading = false }: InsightsFeedProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <InsightSkeleton />
        <InsightSkeleton />
        <InsightSkeleton />
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <Card className="border-border p-6 text-center text-sm text-muted-foreground">
        No insights available yet. Complete more workouts to generate insights.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {insights.map((insight) => {
        const { color, Icon } = TYPE_CONFIG[insight.type];
        return (
          <Card
            key={insight.id}
            className="border-border overflow-hidden p-0"
            style={{ borderLeftColor: color, borderLeftWidth: 3 }}
          >
            <CardContent className="flex gap-4 p-4">
              {/* Icon */}
              <div
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${color}22` }}
              >
                <Icon size={16} style={{ color }} />
              </div>

              {/* Text */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-semibold leading-tight text-foreground">
                  {insight.title}
                </p>
                <p className="text-sm text-muted-foreground">{insight.description}</p>

                {insight.recommendation && (
                  <p className="mt-0.5 text-xs italic text-muted-foreground">
                    {insight.recommendation}
                  </p>
                )}

                {insight.metric && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{insight.metric.name}:</span>
                    <span className="text-xs font-medium text-foreground">
                      {insight.metric.value}
                      {insight.metric.unit}
                    </span>
                    {insight.metric.delta !== undefined && (
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: insight.metric.delta >= 0 ? "#10B981" : "#EF4444",
                        }}
                      >
                        {insight.metric.delta >= 0 ? "+" : ""}
                        {insight.metric.delta}
                        {insight.metric.unit}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
