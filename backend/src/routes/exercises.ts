import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { getLatestDimensionScores } from '../lib/dimensionUpdate';
import { dimensionColor } from '../lib/dashboardHelpers';
import { getAssistantId, searchMemories } from '../lib/backboardMemory';
import {
  matchExercises,
  ExerciseMatchValidationError,
  type ExerciseRow,
  type SignalDataRow,
} from '../lib/exerciseMatching';
import { validateUUID, VALID_EXERCISE_CATEGORIES, MAX_COMPLETION_DATA_BYTES } from '../lib/utils';
const router = Router();

const COUNSELOR_MESSAGE =
  'Some of these practices touch areas where a school counselor could offer additional support. ' +
  'Consider reaching out if patterns persist over a few weeks.';

// ── GET /api/exercises ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;

    if (typeof category === 'string' && category.trim() !== '') {
      const cat = category.trim();
      if (!VALID_EXERCISE_CATEGORIES.has(cat)) {
        return res.status(400).json({
          success: false,
          error: `Invalid category "${cat}". Valid categories: ${[...VALID_EXERCISE_CATEGORIES].join(', ')}`,
        });
      }
      const { data, error } = await supabase
        .from('exercise_library')
        .select('*')
        .contains('categories', [cat])
        .order('name');
      if (error) throw error;
      return res.status(200).json({ success: true, data: data ?? [] });
    }

    const { data, error } = await supabase
      .from('exercise_library')
      .select('*')
      .order('name');
    if (error) throw error;
    return res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/exercises/saved/:userId ─────────────────────────────────────────
// Must be registered BEFORE /:id/* routes.

router.get('/saved/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  if (!validateUUID(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid ID format' });
  }

  try {
    // Verify user exists
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const { data, error } = await supabase
      .from('saved_exercises')
      .select('created_at, exercise_id, exercise_library(id, name, category, categories, description, full_ui, instructions, counselor_flag)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const items = (data ?? []).map((row: Record<string, unknown>) => {
      const lib = row.exercise_library as Record<string, unknown> | null;
      return {
        saved_at:    row.created_at,
        exercise_id: row.exercise_id,
        ...(lib ?? {}),
      };
    });

    return res.status(200).json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/exercises/history/:userId ────────────────────────────────────────

router.get('/history/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  if (!validateUUID(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid ID format' });
  }

  try {
    // Verify user exists
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const rawLimit = req.query.limit;
    const limit = Math.min(
      typeof rawLimit === 'string' ? Math.max(1, parseInt(rawLimit, 10) || 20) : 20,
      100,
    );

    const exerciseIdFilter = req.query.exercise_id;
    if (exerciseIdFilter !== undefined) {
      if (typeof exerciseIdFilter !== 'string' || !validateUUID(exerciseIdFilter)) {
        return res.status(400).json({ success: false, error: 'Invalid exercise_id filter format' });
      }
    }

    let query = supabase
      .from('exercise_completions')
      .select('id, exercise_id, completion_data, created_at, exercise_library(name, categories, counselor_flag)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (typeof exerciseIdFilter === 'string') {
      query = query.eq('exercise_id', exerciseIdFilter);
    }

    const { data, error } = await query;
    if (error) throw error;

    const items = (data ?? []).map((row: Record<string, unknown>) => {
      const lib = row.exercise_library as Record<string, unknown> | null;
      return {
        completion_id:   row.id,
        exercise_id:     row.exercise_id,
        exercise_name:   lib?.name ?? null,
        categories:      lib?.categories ?? [],
        counselor_flag:  lib?.counselor_flag ?? false,
        completion_data: row.completion_data,
        completed_at:    row.created_at,
      };
    });

    return res.status(200).json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/exercises/recommended/:userId ────────────────────────────────────

router.get(
  '/recommended/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;

    if (!validateUUID(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }

    try {
      const latestScores = await getLatestDimensionScores(userId);
      if (!latestScores) {
        return res.status(404).json({
          success: false,
          error: 'No scores found for this user. Please complete the initial survey first.',
        });
      }

      const [signalsResult, exercisesResult] = await Promise.all([
        supabase
          .from('signal_data')
          .select('signal_type, processed_data, created_at')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('exercise_library').select('*'),
      ]);

      if (signalsResult.error) throw signalsResult.error;
      if (exercisesResult.error) throw exercisesResult.error;

      const signalData    = (signalsResult.data ?? []) as SignalDataRow[];
      const allExercises  = (exercisesResult.data ?? []) as ExerciseRow[];

      // Fetch Backboard prior context
      let priorContext = '';
      const assistantId = await getAssistantId(userId);
      if (assistantId) {
        priorContext = await searchMemories(
          assistantId,
          'dimension score history trend performance',
        );
      }

      const recommendations = await matchExercises(
        latestScores, signalData, allExercises, priorContext,
      );

      const cl = Math.round(Number(latestScores.cognitive_load));
      const er = Math.round(Number(latestScores.emotional_regulation));
      const rc = Math.round(Number(latestScores.recovery_capacity));

      // Counselor nudge: 2+ dimensions in red AND at least 1 flagged exercise
      const redCount = [
        dimensionColor(cl, true)  === 'red',
        dimensionColor(er, false) === 'red',
        dimensionColor(rc, false) === 'red',
      ].filter(Boolean).length;

      const hasCounselorFlagged = recommendations.some(
        (r) => r.exercise.counselor_flag === true,
      );
      const counselorNudge = redCount >= 2 && hasCounselorFlagged;

      const responseData: Record<string, unknown> = {
        user_id:      userId,
        generated_at: new Date().toISOString(),
        recommendations: recommendations.map(({ exercise, match_reason }) => ({
          exercise: {
            id:             exercise.id,
            name:           exercise.name,
            category:       exercise.category,
            categories:     exercise.categories ?? [],
            description:    exercise.description,
            full_ui:        exercise.full_ui,
            instructions:   exercise.instructions,
            counselor_flag: exercise.counselor_flag ?? false,
          },
          match_reason,
        })),
        dimension_snapshot: {
          cognitive_load:       { score: cl, color: dimensionColor(cl, true) },
          emotional_regulation: { score: er, color: dimensionColor(er, false) },
          recovery_capacity:    { score: rc, color: dimensionColor(rc, false) },
        },
      };

      if (counselorNudge) {
        responseData.counselor_nudge    = true;
        responseData.counselor_message  = COUNSELOR_MESSAGE;
      }

      return res.status(200).json({ success: true, data: responseData });
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

// ── POST /api/exercises/:id/save ──────────────────────────────────────────────

router.post(
  '/:id/save',
  async (req: Request, res: Response, next: NextFunction) => {
    const { id: exerciseId } = req.params;
    const { user_id } = req.body as { user_id?: string };

    if (!validateUUID(exerciseId)) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required' });
    }
    if (!validateUUID(user_id)) {
      return res.status(400).json({ success: false, error: 'Invalid user_id format' });
    }

    try {
      // Verify exercise exists
      const { data: exercise, error: exErr } = await supabase
        .from('exercise_library')
        .select('id')
        .eq('id', exerciseId)
        .maybeSingle();
      if (exErr) throw exErr;
      if (!exercise) {
        return res.status(404).json({ success: false, error: 'Exercise not found' });
      }

      const { error: insertErr } = await supabase
        .from('saved_exercises')
        .insert({ user_id, exercise_id: exerciseId });

      if (insertErr) {
        // UNIQUE constraint violation → already saved
        if (insertErr.code === '23505') {
          return res.status(409).json({
            success: false,
            error:   'Exercise already saved',
          });
        }
        throw insertErr;
      }

      return res.status(201).json({
        success:     true,
        data:        { saved: true, exercise_id: exerciseId },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /api/exercises/:id/save ────────────────────────────────────────────

router.delete(
  '/:id/save',
  async (req: Request, res: Response, next: NextFunction) => {
    const { id: exerciseId } = req.params;
    const { user_id } = req.body as { user_id?: string };

    if (!validateUUID(exerciseId)) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    try {
      const { data, error } = await supabase
        .from('saved_exercises')
        .delete()
        .eq('user_id', user_id)
        .eq('exercise_id', exerciseId)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        return res.status(404).json({ success: false, error: 'Exercise not saved by this user' });
      }

      return res.status(200).json({ success: true, data: { removed: true } });
    } catch (err) {
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

    if (!validateUUID(exerciseId)) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required in request body' });
    }

    // Enforce 10 KB limit on completion_data
    if (completion_data !== undefined && completion_data !== null) {
      const dataSize = Buffer.byteLength(JSON.stringify(completion_data), 'utf8');
      if (dataSize > MAX_COMPLETION_DATA_BYTES) {
        return res.status(400).json({
          success: false,
          error:   `completion_data exceeds 10 KB limit (got ${dataSize} bytes)`,
        });
      }
    }

    try {
      const { data: exercise, error: lookupError } = await supabase
        .from('exercise_library')
        .select('id, name')
        .eq('id', exerciseId)
        .single();

      if (lookupError || !exercise) {
        return res.status(404).json({ success: false, error: 'Exercise not found' });
      }

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
