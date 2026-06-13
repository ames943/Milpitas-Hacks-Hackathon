import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { getLatestDimensionScores } from '../lib/dimensionUpdate';
import { dimensionColor } from '../lib/dashboardHelpers';
import {
  matchExercises,
  ExerciseMatchValidationError,
  type ExerciseRow,
  type SignalDataRow,
} from '../lib/exerciseMatching';

const router = Router();

// ── GET /api/exercises ────────────────────────────────────────────────────────
// Full library — not the primary UX but needed for admin/demo.
// Optional ?category= filter uses array containment (@>).

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    let query = supabase.from('exercise_library').select('*').order('name');

    if (typeof category === 'string' && category.trim() !== '') {
      query = query.contains('categories', [category.trim()]);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/exercises/recommended/:userId ────────────────────────────────────
// Must be registered before /:id/complete so Express doesn't treat
// "recommended" as an exercise ID.

router.get(
  '/recommended/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;

    try {
      // 1. Must have dimension scores
      const latestScores = await getLatestDimensionScores(userId);
      if (!latestScores) {
        return res.status(404).json({
          success: false,
          error: 'No scores found for this user. Please complete the initial survey first.',
        });
      }

      // 2. Fetch signal data + full exercise library in parallel
      const [signalsResult, exercisesResult] = await Promise.all([
        supabase
          .from('signal_data')
          .select('signal_type, processed_data, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('exercise_library')
          .select('*'),
      ]);

      if (signalsResult.error) throw signalsResult.error;
      if (exercisesResult.error) throw exercisesResult.error;

      const signalData = (signalsResult.data ?? []) as SignalDataRow[];
      const allExercises = (exercisesResult.data ?? []) as ExerciseRow[];

      // 3. Two-stage matching (Stage 1: deterministic, Stage 2: AI)
      const recommendations = await matchExercises(latestScores, signalData, allExercises);

      // 4. Dimension snapshot with server-side color bands
      const cl = Math.round(Number(latestScores.cognitive_load));
      const er = Math.round(Number(latestScores.emotional_regulation));
      const rc = Math.round(Number(latestScores.recovery_capacity));

      return res.status(200).json({
        success: true,
        data: {
          user_id:      userId,
          generated_at: new Date().toISOString(),
          recommendations: recommendations.map(({ exercise, match_reason }) => ({
            exercise: {
              id:           exercise.id,
              name:         exercise.name,
              category:     exercise.category,
              categories:   exercise.categories ?? [],
              description:  exercise.description,
              full_ui:      exercise.full_ui,
              instructions: exercise.instructions,
            },
            match_reason,
          })),
          dimension_snapshot: {
            cognitive_load:       { score: cl, color: dimensionColor(cl, true) },
            emotional_regulation: { score: er, color: dimensionColor(er, false) },
            recovery_capacity:    { score: rc, color: dimensionColor(rc, false) },
          },
        },
      });
    } catch (err) {
      if (err instanceof ExerciseMatchValidationError) {
        return res.status(422).json({
          success:       false,
          error:         err.message,
          raw_ai_output: err.rawAiOutput,
        });
      }
      next(err);
    }
  },
);

// ── POST /api/exercises/:id/complete ─────────────────────────────────────────

router.post(
  '/:id/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    const { id: exerciseId } = req.params;
    const { user_id, completion_data } = req.body as {
      user_id?: string;
      completion_data?: unknown;
    };

    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required in request body' });
    }

    try {
      // Verify exercise exists
      const { data: exercise, error: lookupError } = await supabase
        .from('exercise_library')
        .select('id, name')
        .eq('id', exerciseId)
        .single();

      if (lookupError || !exercise) {
        return res.status(404).json({ success: false, error: 'Exercise not found' });
      }

      // Insert completion record
      const { data: completion, error: insertError } = await supabase
        .from('exercise_completions')
        .insert({
          user_id,
          exercise_id:     exerciseId,
          completion_data: completion_data ?? null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      return res.status(201).json({ success: true, data: completion });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
