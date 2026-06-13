export type TrendDirection = 'improving' | 'stable' | 'worsening';

export interface DimensionTrend {
  direction: TrendDirection;
  delta: number;
}

export interface TrendResult {
  cognitive_load: DimensionTrend;
  emotional_regulation: DimensionTrend;
  recovery_capacity: DimensionTrend;
}

type DimensionSnapshot = {
  cognitive_load: number;
  emotional_regulation: number;
  recovery_capacity: number;
};

// cognitive_load is inverted: lower is better, so a negative delta is an improvement.
function clDirection(delta: number): TrendDirection {
  if (delta <= -5) return 'improving';
  if (delta >= 5)  return 'worsening';
  return 'stable';
}

// emotional_regulation and recovery_capacity: higher is better.
function positiveDirection(delta: number): TrendDirection {
  if (delta >= 5)  return 'improving';
  if (delta <= -5) return 'worsening';
  return 'stable';
}

/**
 * Pure function — computes per-dimension trend between two consecutive snapshots.
 * Caller is responsible for ensuring previous precedes latest chronologically.
 * The route returns has_trend: false (without calling this) when fewer than 2 snapshots exist.
 */
export function calculateTrend(
  previous: DimensionSnapshot,
  latest: DimensionSnapshot,
): TrendResult {
  const clDelta = Number(latest.cognitive_load)       - Number(previous.cognitive_load);
  const erDelta = Number(latest.emotional_regulation) - Number(previous.emotional_regulation);
  const rcDelta = Number(latest.recovery_capacity)    - Number(previous.recovery_capacity);

  return {
    cognitive_load:       { direction: clDirection(clDelta),       delta: clDelta },
    emotional_regulation: { direction: positiveDirection(erDelta), delta: erDelta },
    recovery_capacity:    { direction: positiveDirection(rcDelta), delta: rcDelta },
  };
}
