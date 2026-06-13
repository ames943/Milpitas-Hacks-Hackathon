/**
 * Pure functions for dashboard computation — no I/O, fully unit-testable.
 */

export type ColorBand = 'green' | 'amber' | 'red';

/**
 * Returns the color band for a dimension score.
 *
 * cognitive_load:                  higher = worse  → higherIsWorse: true
 * emotional_regulation / recovery: higher = better → higherIsWorse: false
 *
 * Thresholds (same scale both directions, invert for "better"):
 *   green : ≤ 33 (low strain) or ≥ 67 (high wellbeing)
 *   amber : 34-66
 *   red   : ≥ 67 (high strain) or ≤ 33 (low wellbeing)
 */
export function dimensionColor(score: number, higherIsWorse: boolean): ColorBand {
  if (higherIsWorse) {
    if (score <= 33) return 'green';
    if (score <= 66) return 'amber';
    return 'red';
  } else {
    if (score >= 67) return 'green';
    if (score >= 34) return 'amber';
    return 'red';
  }
}

export interface BreakdownEntry {
  source: string;
  contribution: number;
  label: string;
}

export interface PotentialEntry extends BreakdownEntry {
  /** What the confidence total would become if this signal were added (capped at 100). */
  would_bring_total_to: number;
}

// Ordered list of all signal sources and their contributions.
const SIGNAL_SOURCES: BreakdownEntry[] = [
  { source: 'survey',     contribution: 40, label: 'Initial assessment' },
  { source: 'transcript', contribution: 20, label: 'Academic transcript' },
  { source: 'sleep',      contribution: 20, label: 'Sleep data' },
  { source: 'voice',      contribution: 20, label: 'Voice sample' },
];

/**
 * Splits signal sources into submitted (breakdown) and not-yet-submitted (potential).
 * Survey is always in breakdown if dimension_scores row exists.
 *
 * @param submittedSignalTypes  - Distinct signal_type values the user has submitted
 *                                (does NOT include 'survey' — handled implicitly).
 * @param currentConfidence     - Current confidence_score from dimension_scores.
 */
export function buildConfidenceBreakdown(
  submittedSignalTypes: string[],
  currentConfidence: number,
): { breakdown: BreakdownEntry[]; potential: PotentialEntry[] } {
  const submitted = new Set(submittedSignalTypes);
  const breakdown: BreakdownEntry[] = [];
  const potential: PotentialEntry[] = [];

  for (const src of SIGNAL_SOURCES) {
    if (src.source === 'survey' || submitted.has(src.source)) {
      breakdown.push(src);
    } else {
      potential.push({
        ...src,
        would_bring_total_to: Math.min(currentConfidence + src.contribution, 100),
      });
    }
  }

  return { breakdown, potential };
}
