import { supabase } from './supabase';
import { getAssistantId, addMemory, formatSnapshotMemory } from './backboardMemory';

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

// ── Backboard snapshot write (fire-and-forget) ────────────────────────────────
// Queries active signals, formats the memory string, and posts to Backboard.
// Never throws — all failures are logged as warnings.
async function writeBackboardSnapshot(userId: string, row: DimensionScoresRow): Promise<void> {
  const assistantId = await getAssistantId(userId);
  if (!assistantId) {
    console.warn('[dimensionUpdate] No Backboard assistant for user — snapshot skipped');
    return;
  }

  // Query distinct active signal types (excludes soft-deleted rows)
  const { data: sigData } = await supabase
    .from('signal_data')
    .select('signal_type')
    .eq('user_id', userId)
    .is('deleted_at', null);

  const signalsPresent = [
    ...new Set(
      (sigData ?? []).map((s: { signal_type: string }) => s.signal_type as string),
    ),
  ];

  const content = formatSnapshotMemory(row, signalsPresent);
  const metadata = {
    source:      'mosaic',
    user_id:     userId,
    snapshot_at: row.created_at,
  };

  await addMemory(assistantId, content, metadata);
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
  const row = data as DimensionScoresRow;

  // Fire-and-forget — Backboard write failure must never crash the request.
  writeBackboardSnapshot(userId, row).catch((err) =>
    console.warn('[dimensionUpdate] Backboard snapshot write failed (non-fatal):', err),
  );

  return row;
}
