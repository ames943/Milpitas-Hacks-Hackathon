/**
 * Exercise recommendation engine — two-stage: deterministic pre-filter, then AI ranking.
 *
 * Stage 1 (pure, synchronous): build a priority category set from dimension scores,
 * score each exercise, return top-8 candidates.
 *
 * Stage 2 (AI): pass candidates + student context to Backboard/Claude, receive
 * exactly 5 recommendations with personalized match_reasons.
 */

import { callAI } from './aiClient';
import type { DimensionScoresRow } from './dimensionUpdate';
import { dimensionColor } from './dashboardHelpers';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExerciseRow {
  id: string;
  name: string;
  category: string;
  categories: string[];
  description: string | null;
  full_ui: boolean;
  instructions: unknown | null;
}

export interface SignalDataRow {
  signal_type: string;
  processed_data: unknown;
  created_at: string;
}

export interface CandidateExercise {
  exercise: ExerciseRow;
  match_score: number;
}

export interface RecommendedExercise {
  exercise: ExerciseRow;
  match_reason: string;
  match_score: number;
}

// ── Category-to-dimension mapping (research-informed starting point) ──────────
// cognitive_load:         higher = worse (strain)
//   red   (≥ 67): prioritize Cognitive + Structural — reduce mental load directly
//   amber (34-66): prioritize Structural — routine/planning to prevent escalation
//   green (< 34): no priority boost

// emotional_regulation:   higher = better
//   red   (≤ 33): prioritize Cognitive + Social — reframe AND connect
//   amber (34-66): prioritize Cognitive — build regulation skills
//   green (> 66): no priority boost

// recovery_capacity:      higher = better
//   red   (≤ 33): prioritize Physical + Structural — sleep and rest scaffolding
//   amber (34-66): prioritize Physical — basic sleep/movement hygiene
//   green (> 66): no priority boost

// ── Stage 1: Pure functions ───────────────────────────────────────────────────

export function buildPrioritySet(scores: {
  cognitive_load: number;
  emotional_regulation: number;
  recovery_capacity: number;
}): Set<string> {
  const priority = new Set<string>();

  const cl = Number(scores.cognitive_load);
  if (cl >= 67) {
    priority.add('Cognitive');
    priority.add('Structural');
  } else if (cl >= 34) {
    priority.add('Structural');
  }

  const er = Number(scores.emotional_regulation);
  if (er <= 33) {
    priority.add('Cognitive');
    priority.add('Social');
  } else if (er <= 66) {
    priority.add('Cognitive');
  }

  const rc = Number(scores.recovery_capacity);
  if (rc <= 33) {
    priority.add('Physical');
    priority.add('Structural');
  } else if (rc <= 66) {
    priority.add('Physical');
  }

  return priority;
}

export function scoreExercise(categories: string[], prioritySet: Set<string>): number {
  return categories.filter((c) => prioritySet.has(c)).length;
}

export function selectCandidates(
  exercises: ExerciseRow[],
  prioritySet: Set<string>,
  count = 8,
): CandidateExercise[] {
  const scored = exercises.map((exercise) => ({
    exercise,
    match_score: scoreExercise(exercise.categories ?? [], prioritySet),
  }));
  // Sort descending by match_score (stable — preserves seed order on ties)
  scored.sort((a, b) => b.match_score - a.match_score);
  return scored.slice(0, count);
}

// Ensures at least one recommendation has full_ui=true so the demo always has
// an interactive exercise to tap into.  If all 5 AI picks are non-interactive:
//   • Find the highest-match-score full_ui exercise in the candidate pool
//     that is NOT already in the 5.
//   • Replace the recommendation with the lowest match_score with it.
//   • Logs a warning — this swap bypasses the AI selection.
export function ensureFullUiGuarantee(
  recommendations: RecommendedExercise[],
  candidates: CandidateExercise[],
): RecommendedExercise[] {
  const hasFullUi = recommendations.some((r) => r.exercise.full_ui);
  if (hasFullUi) return recommendations;

  const recommendedIds = new Set(recommendations.map((r) => r.exercise.id));
  const fullUiCandidate = candidates
    .filter((c) => c.exercise.full_ui && !recommendedIds.has(c.exercise.id))
    .sort((a, b) => b.match_score - a.match_score)[0];

  if (!fullUiCandidate) {
    console.warn(
      '[exerciseMatching] full_ui guarantee: no eligible full_ui exercise found in candidates — returning AI selection unchanged',
    );
    return recommendations;
  }

  const lowestIdx = recommendations.reduce(
    (minIdx, r, i) =>
      r.match_score < recommendations[minIdx].match_score ? i : minIdx,
    0,
  );

  console.warn(
    `[exerciseMatching] full_ui guarantee: swapping "${recommendations[lowestIdx].exercise.name}" ` +
    `(match_score=${recommendations[lowestIdx].match_score}) for ` +
    `"${fullUiCandidate.exercise.name}" (match_score=${fullUiCandidate.match_score})`,
  );

  const updated = [...recommendations];
  updated[lowestIdx] = {
    exercise:     fullUiCandidate.exercise,
    match_score:  fullUiCandidate.match_score,
    match_reason: 'This interactive exercise is a great hands-on place to start given your current situation.',
  };
  return updated;
}

// ── Stage 2: AI ranking ───────────────────────────────────────────────────────

const MATCH_SYSTEM_PROMPT = `You are a student wellbeing coach selecting personalized exercises for a high school student.

You will receive:
1. The student's current scores on three mental health dimensions (with explanations of what each score means)
2. A list of candidate exercises with their categories and descriptions
3. Any additional signal data that was collected (transcript, sleep, or voice analysis)

Your task:
a) Select exactly 5 exercises from the candidates that best address this student's SPECIFIC pattern — consider the combination of all three dimensions, not just the worst one.
b) For each selected exercise, write ONE sentence explaining why it was chosen for THIS student specifically. Requirements:
   - Reference their actual data (e.g. their sleep pattern, course load, voice tone)
   - No clinical terms, no scores or numbers, no generic statements
   - Second person ("your...")
   - One sentence only — no lists, no line breaks
   - Tone: caring school counselor, not a medical professional

Return ONLY this JSON (no preamble, no markdown fences):
{
  "recommendations": [
    { "exercise_id": "<exact id from the list>", "match_reason": "<one sentence>" },
    { "exercise_id": "...", "match_reason": "..." },
    { "exercise_id": "...", "match_reason": "..." },
    { "exercise_id": "...", "match_reason": "..." },
    { "exercise_id": "...", "match_reason": "..." }
  ]
}

CRITICAL: exercise_id must be one of the exact IDs provided. Return exactly 5 items.`;

function levelLabel(
  dimension: 'load' | 'regulation' | 'capacity',
  score: number,
): string {
  if (dimension === 'load') {
    return score >= 67 ? 'high strain' : score >= 34 ? 'moderate strain' : 'low strain';
  }
  return score >= 67 ? 'good' : score >= 34 ? 'moderate' : 'low';
}

function buildSignalContext(signalData: SignalDataRow[]): string {
  if (signalData.length === 0) return 'No additional signals collected yet (survey only).';

  const lines: string[] = [];
  const byType = new Map<string, SignalDataRow>();
  for (const s of signalData) {
    if (!byType.has(s.signal_type)) byType.set(s.signal_type, s);
  }

  const transcript = byType.get('transcript')?.processed_data as Record<string, unknown> | undefined;
  if (transcript) {
    lines.push('Academic transcript:');
    if (transcript.course_load !== undefined) lines.push(`  - Courses this term: ${transcript.course_load}`);
    if (transcript.grade_trend !== undefined) lines.push(`  - Grade trend: ${transcript.grade_trend}`);
    if (transcript.has_ap_honors !== undefined) lines.push(`  - AP/Honors courses: ${transcript.has_ap_honors}`);
    if (transcript.gpa !== undefined) lines.push(`  - GPA: ${Number(transcript.gpa).toFixed(2)}`);
  }

  const sleep = byType.get('sleep')?.processed_data as Record<string, unknown> | undefined;
  if (sleep) {
    lines.push('Sleep data:');
    if (sleep.avg_sleep_hours !== undefined)
      lines.push(`  - Average nightly sleep: ${Number(sleep.avg_sleep_hours).toFixed(1)} hours`);
    if (sleep.sleep_variability_hours !== undefined)
      lines.push(`  - Night-to-night variability: ±${Number(sleep.sleep_variability_hours).toFixed(1)} hours`);
    if (sleep.nights_analyzed !== undefined)
      lines.push(`  - Nights analyzed: ${sleep.nights_analyzed}`);
  }

  const voice = byType.get('voice')?.processed_data as Record<string, unknown> | undefined;
  if (voice) {
    lines.push('Voice sample:');
    if (voice.speaking_ratio !== undefined)
      lines.push(`  - Proportion of time speaking: ${Math.round(Number(voice.speaking_ratio) * 100)}%`);
    if (voice.num_pauses !== undefined)
      lines.push(`  - Long pauses detected: ${voice.num_pauses}`);
    if (voice.pitch_variance_hz !== undefined) {
      const variance = Number(voice.pitch_variance_hz);
      const label = variance < 20 ? 'very flat (monotone)' : variance < 50 ? 'somewhat flat' : 'moderate range';
      lines.push(`  - Vocal expressiveness: ${label}`);
    }
  }

  return lines.join('\n');
}

function buildMatchUserPrompt(
  scores: DimensionScoresRow,
  candidates: CandidateExercise[],
  signalData: SignalDataRow[],
): string {
  const cl = Math.round(Number(scores.cognitive_load));
  const er = Math.round(Number(scores.emotional_regulation));
  const rc = Math.round(Number(scores.recovery_capacity));

  const sections: string[] = [
    `STUDENT DIMENSION SCORES\n`,
    `1. Cognitive Load (${levelLabel('load', cl)}): Measures how much mental bandwidth is being consumed. Higher = more strain.`,
    `   Color: ${dimensionColor(cl, true)} | Score: ${cl}/100`,
    ``,
    `2. Emotional Regulation (${levelLabel('regulation', er)}): Ability to manage and express emotions. Higher = better regulation.`,
    `   Color: ${dimensionColor(er, false)} | Score: ${er}/100`,
    ``,
    `3. Recovery Capacity (${levelLabel('capacity', rc)}): Ability to physically and mentally recharge. Higher = better recovery.`,
    `   Color: ${dimensionColor(rc, false)} | Score: ${rc}/100`,
    ``,
    `ADDITIONAL SIGNAL DATA\n`,
    buildSignalContext(signalData),
    ``,
    `CANDIDATE EXERCISES (select 5 from these)\n`,
    ...candidates.map(({ exercise: e, match_score }) =>
      `ID: ${e.id}\nName: ${e.name}\nCategories: ${(e.categories ?? []).join(', ')}\nDescription: ${e.description ?? '(no description)'}\nMatch score: ${match_score}\n`,
    ),
    `Select the 5 exercises that best address this student's specific combination of needs. Return JSON only.`,
  ];

  return sections.join('\n');
}

interface AIOutput {
  recommendations: Array<{ exercise_id: string; match_reason: string }>;
}

function validateAIOutput(
  raw: unknown,
  validIds: Set<string>,
): raw is AIOutput {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.recommendations)) return false;
  if (r.recommendations.length !== 5) return false;
  for (const item of r.recommendations) {
    if (typeof item !== 'object' || item === null) return false;
    const i = item as Record<string, unknown>;
    if (typeof i.exercise_id !== 'string' || !validIds.has(i.exercise_id)) return false;
    if (typeof i.match_reason !== 'string' || i.match_reason.trim() === '') return false;
  }
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ExerciseMatchValidationError extends Error {
  constructor(
    message: string,
    public readonly rawAiOutput: unknown,
  ) {
    super(message);
    this.name = 'ExerciseMatchValidationError';
  }
}

export async function matchExercises(
  dimensionScores: DimensionScoresRow,
  signalData: SignalDataRow[],
  allExercises: ExerciseRow[],
): Promise<RecommendedExercise[]> {
  // Stage 1 — deterministic pre-filter
  const prioritySet = buildPrioritySet(dimensionScores);
  const candidates = selectCandidates(allExercises, prioritySet, 8);

  // Stage 2 — AI ranking
  const userPrompt = buildMatchUserPrompt(dimensionScores, candidates, signalData);
  const rawResult = await callAI(MATCH_SYSTEM_PROMPT, userPrompt, {
    jsonOutput: true,
    timeoutMs: 12_000, // allow a bit more time since it reads more context
  });

  const validIds = new Set(candidates.map((c) => c.exercise.id));
  if (!validateAIOutput(rawResult, validIds)) {
    throw new ExerciseMatchValidationError(
      `AI returned invalid recommendations. Expected exactly 5 items with valid exercise_ids.`,
      rawResult,
    );
  }

  const candidateMap = new Map(candidates.map((c) => [c.exercise.id, c]));
  const recommendations: RecommendedExercise[] = rawResult.recommendations.map((rec) => {
    const candidate = candidateMap.get(rec.exercise_id)!;
    return {
      exercise:     candidate.exercise,
      match_reason: rec.match_reason.trim(),
      match_score:  candidate.match_score,
    };
  });

  // full_ui guarantee — swap if needed
  return ensureFullUiGuarantee(recommendations, candidates);
}
