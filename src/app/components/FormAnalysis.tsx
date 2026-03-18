import { useMemo } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import {
  calculateBilateralBalance,
  calculateCurveConsistency,
  calculateFatigueResistance,
  calculateFormScore,
  calculateTempoControl,
  getLetterGrade,
  type RepMetrics,
} from "@/lib/form-analysis";

export interface FormAnalysisProps {
  reps: RepMetrics[];
}

interface SubMetric {
  name: string;
  score: number;
  description: string;
}

function getStatusColor(score: number): string {
  if (score >= 80) return "#10B981";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

function getSubMetricDescription(name: string, score: number): string {
  if (name === "Curve Consistency") {
    if (score >= 80) return "Force curves are highly repeatable across reps.";
    if (score >= 60) return "Some variation in force output between reps.";
    return "Significant force curve variation — focus on controlled execution.";
  }
  if (name === "Tempo Control") {
    if (score >= 80) return "Time under tension is consistent throughout the set.";
    if (score >= 60) return "Moderate tempo variation detected across reps.";
    return "Tempo varies considerably — try counting beats during each rep.";
  }
  if (name === "Fatigue Resistance") {
    if (score >= 80) return "Output is well-maintained across the entire set.";
    if (score >= 60) return "Slight performance drop toward the end of the set.";
    return "Noticeable performance decay — consider reducing reps or weight.";
  }
  if (name === "Bilateral Balance") {
    if (score >= 80) return "Left and right side output is well-matched.";
    if (score >= 60) return "Mild imbalance detected between sides.";
    return "Significant asymmetry present — single-arm work may help.";
  }
  return "";
}

function getFormSummary(score: number): string {
  if (score >= 90) return "Excellent form — maintain this technique.";
  if (score >= 80) return "Good form with minor areas to refine.";
  if (score >= 70) return "Decent form — some consistency gains available.";
  if (score >= 60) return "Form needs attention in a few key areas.";
  return "Significant form issues — reduce weight and focus on technique.";
}

function generateRecommendations(metrics: SubMetric[]): string[] {
  const sorted = [...metrics].sort((a, b) => a.score - b.score);
  const recommendations: string[] = [];

  for (const metric of sorted.slice(0, 3)) {
    if (metric.score >= 80) break;

    if (metric.name === "Fatigue Resistance" && metric.score < 80) {
      recommendations.push(
        metric.score < 60
          ? "Drop the final rep or reduce weight to maintain form quality."
          : "Reduce set volume slightly to preserve output in later reps.",
      );
    } else if (metric.name === "Bilateral Balance" && metric.score < 80) {
      recommendations.push(
        "Add single-arm work to address bilateral imbalance and build symmetry.",
      );
    } else if (metric.name === "Tempo Control" && metric.score < 80) {
      recommendations.push(
        metric.score < 60
          ? "Consider slower eccentrics (3-4 s) for better tempo control."
          : "Use a metronome or counting cue to keep rep tempo consistent.",
      );
    } else if (metric.name === "Curve Consistency" && metric.score < 80) {
      recommendations.push(
        metric.score < 60
          ? "Focus on consistent bracing and joint path each rep."
          : "Minor force variation detected — maintain your setup between reps.",
      );
    }
  }

  return recommendations.slice(0, 3);
}

const RING_RADIUS = 40;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function FormAnalysis({ reps }: FormAnalysisProps) {
  const { overallScore, grade, subMetrics, recommendations } = useMemo(() => {
    const cc = calculateCurveConsistency(reps);
    const tc = calculateTempoControl(reps);
    const fr = calculateFatigueResistance(reps);
    const bb = calculateBilateralBalance(reps);
    const overall = calculateFormScore(reps);
    const letterGrade = getLetterGrade(overall);

    const metrics: SubMetric[] = [
      { name: "Curve Consistency", score: cc, description: getSubMetricDescription("Curve Consistency", cc) },
      { name: "Tempo Control", score: tc, description: getSubMetricDescription("Tempo Control", tc) },
      { name: "Fatigue Resistance", score: fr, description: getSubMetricDescription("Fatigue Resistance", fr) },
      { name: "Bilateral Balance", score: bb, description: getSubMetricDescription("Bilateral Balance", bb) },
    ];

    return {
      overallScore: overall,
      grade: letterGrade,
      subMetrics: metrics,
      recommendations: generateRecommendations(metrics),
    };
  }, [reps]);

  const dashOffset = RING_CIRCUMFERENCE * (1 - overallScore / 100);
  const ringColor = getStatusColor(overallScore);

  if (reps.length === 0) {
    return (
      <Card className="border-border p-6 text-center text-sm text-muted-foreground">
        No rep data available for form analysis.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Overall score ring */}
      <Card className="border-border p-0">
        <CardContent className="flex items-center gap-6 p-6">
          {/* SVG ring */}
          <div className="relative shrink-0">
            <svg width={100} height={100} aria-hidden="true">
              {/* Background track */}
              <circle
                cx={50}
                cy={50}
                r={RING_RADIUS}
                fill="none"
                stroke="#27272a"
                strokeWidth={8}
              />
              {/* Progress arc */}
              <circle
                cx={50}
                cy={50}
                r={RING_RADIUS}
                fill="none"
                stroke={ringColor}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 50 50)"
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
              />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold leading-none" style={{ color: ringColor }}>
                {grade}
              </span>
            </div>
          </div>

          {/* Score text */}
          <div className="flex flex-col gap-1">
            <p className="text-3xl font-bold text-foreground">
              {overallScore}
              <span className="ml-0.5 text-base font-normal text-muted-foreground">/100</span>
            </p>
            <p className="text-sm font-medium text-foreground">Form Score</p>
            <p className="text-sm text-muted-foreground">{getFormSummary(overallScore)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Sub-metrics */}
      <Card className="border-border p-0">
        <CardContent className="flex flex-col divide-y divide-border p-0">
          {subMetrics.map((metric) => {
            const dotColor = getStatusColor(metric.score);
            return (
              <div key={metric.name} className="flex items-center gap-3 px-4 py-3">
                {/* Status dot */}
                <div
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor }}
                  aria-hidden="true"
                />
                {/* Name + description */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm font-semibold text-foreground">{metric.name}</p>
                  <p className="text-xs text-muted-foreground">{metric.description}</p>
                </div>
                {/* Score */}
                <p className="shrink-0 text-sm font-medium" style={{ color: dotColor }}>
                  {metric.score}%
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "#FF6B3566", backgroundColor: "#FF6B350D" }}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Recommendations
          </p>
          <ul className="flex flex-col gap-1.5">
            {recommendations.map((rec) => (
              <li key={rec} className="flex items-start gap-2 text-sm text-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#FF6B35]" aria-hidden="true" />
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
