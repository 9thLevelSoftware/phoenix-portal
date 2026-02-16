/**
 * Phoenix-themed chart constants for visx visualizations.
 * Shared across all premium analytics chart components.
 */

export const CHART_COLORS = {
  primary: '#FF6B35',    // Ember
  secondary: '#F59E0B',  // Gold
  danger: '#DC2626',     // Flame Red
  success: '#10B981',    // Forge Green
  accent: '#3B82F6',     // Blue
  background: '#0D0D0D',
  gridLine: '#1A1A2E',
  axisText: '#9CA3AF',
  tooltipBg: '#1A1A2E',
  tooltipBorder: '#2D2D44',
} as const;

export const CHART_MARGINS = {
  top: 20,
  right: 20,
  bottom: 40,
  left: 50,
} as const;

/**
 * 10 distinguishable colors for multi-rep overlays.
 * Ordered by visual distinctiveness on dark backgrounds.
 */
export const REP_COLORS: string[] = [
  '#FF6B35', // Ember
  '#F59E0B', // Gold
  '#10B981', // Green
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#FB923C', // Orange-light
  '#F87171', // Red-light
  '#14B8A6', // Teal
];

export const FONT_SIZES = {
  axis: 11,
  label: 13,
  title: 15,
} as const;
