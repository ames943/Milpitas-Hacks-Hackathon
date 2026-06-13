import { supabase } from './supabase';

export interface DimensionScoresRow {
  id: string;
  user_id: string;
  cognitive_load: number;
  emotional_regulation: number;
  recovery_capacity: number;
  confidence_score: number;
  explanation_text: string | null;
  created_at: string;
}

/** Fetches the most recent dimension_scores snapshot for a user (uses composite index). */
export async function getLatestDimensionScores(userId: string): Promise<DimensionScoresRow | null> {
  const { data, error } = await supabase
    .from('dimension_scores')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0] as DimensionScoresRow) ?? null;
}

export type DimensionAdjustments = Partial<{
  cognitive_load: number;
  emotional_regulation: number;
  recovery_capacity: number;
}>;

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Applies dimension adjustments and inserts a new snapshot row.
 * - Keys present in `adjustments` override the corresponding value from `latest`.
 * - All three dimensions are clamped to [0, 100].
 * - confidence_score = clamp(latest.confidence_score + confidenceContribution, 0, 100).
 */
export async function blendAndInsertDimensions(
  userId: string,
  latest: DimensionScoresRow,
  adjustments: DimensionAdjustments,
  confidenceContribution: number,
  explanationText: string,
): Promise<DimensionScoresRow> {
  const { data, error } = await supabase
    .from('dimension_scores')
    .insert({
      user_id: userId,
      cognitive_load: clamp(
        adjustments.cognitive_load !== undefined
          ? adjustments.cognitive_load
          : Number(latest.cognitive_load),
      ),
      emotional_regulation: clamp(
        adjustments.emotional_regulation !== undefined
          ? adjustments.emotional_regulation
          : Number(latest.emotional_regulation),
      ),
      recovery_capacity: clamp(
        adjustments.recovery_capacity !== undefined
          ? adjustments.recovery_capacity
          : Number(latest.recovery_capacity),
      ),
      confidence_score: clamp(Number(latest.confidence_score) + confidenceContribution),
      explanation_text: explanationText,
    })
    .select()
    .single();

  if (error) throw error;
  return data as DimensionScoresRow;
}
