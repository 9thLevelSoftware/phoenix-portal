import { useMemo } from 'react';
import { Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import ParentSize from '@visx/responsive/lib/components/ParentSize';
import type { RepSummary } from '@/schemas/telemetry';
import { classifyVbtZone, VBT_ZONES } from '@/lib/vbt';
import { CHART_COLORS, CHART_MARGINS, FONT_SIZES } from './shared/ChartTheme';
import { useChartTooltip, ChartTooltipContent } from './shared/ChartTooltip';

export interface VelocityProfileProps {
  repSummaries: RepSummary[];
  height?: number;
  showPeakVelocity?: boolean;
  showZoneLabels?: boolean;
}

function VelocityProfileInner({
  repSummaries,
  height = 280,
  showPeakVelocity = true,
  showZoneLabels = true,
  width,
}: VelocityProfileProps & { width: number }) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useChartTooltip();

  const margin = CHART_MARGINS;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const repLabels = useMemo(
    () => repSummaries.map((_, i) => String(i + 1)),
    [repSummaries],
  );

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: repLabels,
        range: [0, innerWidth],
        padding: 0.3,
      }),
    [repLabels, innerWidth],
  );

  const maxVelocity = useMemo(() => {
    if (repSummaries.length === 0) return 1;
    const peak = Math.max(
      ...repSummaries.map((r) =>
        showPeakVelocity
          ? Math.max(r.mean_velocity_mps, r.peak_velocity_mps)
          : r.mean_velocity_mps,
      ),
    );
    return peak * 1.15; // headroom
  }, [repSummaries, showPeakVelocity]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxVelocity],
        range: [innerHeight, 0],
        nice: true,
      }),
    [maxVelocity, innerHeight],
  );

  if (repSummaries.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-gray-500"
        style={{ height }}
      >
        No velocity data available
      </div>
    );
  }

  const legendHeight = 36;

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          {repSummaries.map((rep, i) => {
            const label = String(i + 1);
            const barX = xScale(label) ?? 0;
            const barWidth = xScale.bandwidth();
            const zone = classifyVbtZone(rep.mean_velocity_mps);

            const meanBarHeight = innerHeight - (yScale(rep.mean_velocity_mps) ?? 0);
            const meanBarY = yScale(rep.mean_velocity_mps) ?? 0;

            return (
              <Group key={rep.id ?? i}>
                {/* Peak velocity bar (behind, lighter) */}
                {showPeakVelocity && rep.peak_velocity_mps > rep.mean_velocity_mps && (
                  <Bar
                    x={barX}
                    y={yScale(rep.peak_velocity_mps) ?? 0}
                    width={barWidth}
                    height={innerHeight - (yScale(rep.peak_velocity_mps) ?? 0)}
                    fill={zone.color}
                    opacity={0.25}
                    rx={2}
                  />
                )}

                {/* Mean velocity bar (primary) */}
                <Bar
                  x={barX}
                  y={meanBarY}
                  width={barWidth}
                  height={meanBarHeight}
                  fill={zone.color}
                  opacity={0.85}
                  rx={2}
                  onMouseMove={(event) => {
                    const svgRect = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    showTooltip({
                      tooltipData: {
                        label: `Rep ${i + 1} - ${zone.label}`,
                        value: `Mean: ${rep.mean_velocity_mps.toFixed(2)} m/s | Peak: ${rep.peak_velocity_mps.toFixed(2)} m/s`,
                        color: zone.color,
                      },
                      tooltipLeft: event.clientX - svgRect.left,
                      tooltipTop: event.clientY - svgRect.top - 10,
                    });
                  }}
                  onMouseLeave={() => hideTooltip()}
                />

                {/* Zone label above bar group */}
                {showZoneLabels && (
                  <text
                    x={barX + barWidth / 2}
                    y={(yScale(showPeakVelocity ? rep.peak_velocity_mps : rep.mean_velocity_mps) ?? 0) - 6}
                    textAnchor="middle"
                    fill={zone.color}
                    fontSize={9}
                    fontWeight={500}
                  >
                    {zone.label.split(' ').map((w) => w[0]).join('')}
                  </text>
                )}
              </Group>
            );
          })}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            label="Rep"
            labelProps={{
              fill: CHART_COLORS.axisText,
              fontSize: FONT_SIZES.label,
              textAnchor: 'middle',
            }}
            tickLabelProps={() => ({
              fill: CHART_COLORS.axisText,
              fontSize: FONT_SIZES.axis,
              textAnchor: 'middle' as const,
            })}
            stroke={CHART_COLORS.gridLine}
            tickStroke={CHART_COLORS.gridLine}
          />

          <AxisLeft
            scale={yScale}
            label="Velocity (m/s)"
            labelProps={{
              fill: CHART_COLORS.axisText,
              fontSize: FONT_SIZES.label,
              textAnchor: 'middle',
            }}
            tickLabelProps={() => ({
              fill: CHART_COLORS.axisText,
              fontSize: FONT_SIZES.axis,
              textAnchor: 'end' as const,
            })}
            stroke={CHART_COLORS.gridLine}
            tickStroke={CHART_COLORS.gridLine}
            numTicks={5}
          />
        </Group>
      </svg>

      {/* Zone legend */}
      <div
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2"
        style={{ height: legendHeight }}
      >
        {VBT_ZONES.map((z) => (
          <div key={z.zone} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: z.color }}
            />
            <span className="text-gray-400">{z.label}</span>
          </div>
        ))}
      </div>

      {tooltipOpen && tooltipData && (
        <ChartTooltipContent
          data={tooltipData}
          top={tooltipTop ?? 0}
          left={tooltipLeft ?? 0}
        />
      )}
    </div>
  );
}

export function VelocityProfile(props: VelocityProfileProps) {
  return (
    <ParentSize>
      {({ width }) =>
        width > 0 ? <VelocityProfileInner {...props} width={width} /> : null
      }
    </ParentSize>
  );
}
