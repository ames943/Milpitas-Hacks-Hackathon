/**
 * Pure adjustment formulas for each signal type.
 * All functions return the NEW dimension value (already clamped to [0, 100]).
 *
 * Coefficients are calibrated estimates for hackathon demo.
 * Flag for validation against clinical/research literature before production use.
 */

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Derives the new cognitive_load from an academic transcript.
 *
 * Formula rationale (hackathon calibration — not yet validated against research):
 *   +10 declining grades  → strong signal of cognitive overload
 *    -5 improving grades  → suggests manageable load
 *    +5 heavy course load (≥6 courses) → typical full HS schedule is 6-7 periods
 *    +5 AP/Honors + declining → compounding effect: rigor + poor performance
 */
export function computeNewCognitiveLoad(
  prior: number,
  grade_trend: 'improving' | 'declining' | 'stable',
  course_load: number,
  has_ap_honors: boolean,
): number {
  let delta = 0;

  if (grade_trend === 'declining') delta += 10;
  if (grade_trend === 'improving') delta -= 5;

  // ≥6 courses = heavy schedule (typical full HS timetable is 6-7 periods)
  // Calibrated estimate for hackathon demo.
  if (course_load >= 6) delta += 5;

  // Rigor + decline = both stressors active simultaneously — compounds cognitive strain.
  // Calibrated estimate for hackathon demo.
  if (has_ap_honors && grade_trend === 'declining') delta += 5;

  return clamp(prior + delta);
}

/**
 * Derives the new recovery_capacity from sleep statistics.
 *
 * Formula rationale (hackathon calibration — validate against Walker 2017,
 * Hirshkowitz et al. 2015 if extended beyond hackathon):
 *   hours_penalty      = max(0, 8 - avg_hours) * 8   → each hour under 8h costs 8 pts
 *   variability_penalty = max(0, stdev - 1) * 10     → each extra hour of variability costs 10 pts
 *   (1hr stdev = ~15 min per night irregularity is considered stable baseline)
 */
export function computeNewRecoveryCapacity(
  prior: number,
  avg_sleep_hours: number,
  sleep_variability_hours: number,
): number {
  // Each hour under the 8h optimum costs 8 points.
  const hours_penalty = Math.max(0, 8 - avg_sleep_hours) * 8;
  // Each hour of nightly variability beyond 1h costs 10 points.
  const variability_penalty = Math.max(0, sleep_variability_hours - 1) * 10;

  return clamp(prior - hours_penalty - variability_penalty);
}

/**
 * Derives the new emotional_regulation from voice pitch variance.
 *
 * pitch_variance_hz is the sample variance of F0 (Hz) across voiced frames.
 * Lower variance ↔ flatter affect — an acoustic PROXY for reduced emotional expressiveness.
 * This is NOT a clinical measure; appropriate hedging is required in any UI display.
 *
 * Normalization range 80 Hz² is a calibrated estimate for hackathon demo.
 * (Typical adult speech F0 variance spans roughly 20–120 Hz; 80 = midpoint.)
 * Validate against speech affect literature (e.g. Scherer 1986) if extended.
 */
export function computeNewEmotionalRegulation(prior: number, pitch_variance_hz: number): number {
  // flatness_score → 1 when pitch is nearly monotone (very low variance)
  const flatness_score = 1 - clamp(pitch_variance_hz / 80, 0, 1);
  const delta = -flatness_score * 15;

  return clamp(prior + delta);
}
