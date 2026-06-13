import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { validateEmail, validateUUID, stripHtml } from '../lib/utils';
import { userCreateLimiter } from '../middleware/rateLimiters';

const router = Router();

// ── POST /api/users ───────────────────────────────────────────────────────────
// Upsert user by email. Returns existing user if email already exists.

router.post('/', userCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name } = req.body as { email?: unknown; name?: unknown };

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'email (string) is required' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const cleanName =
      name && typeof name === 'string'
        ? stripHtml(name.trim()).substring(0, 100)
        : undefined;

    // Check if user already exists by email
    const { data: existing, error: lookupErr } = await supabase
      .from('users')
      .select('id, email, name, onboarding_complete')
      .eq('email', email)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (existing) {
      // User exists — optionally update name if provided
      if (cleanName && cleanName !== existing.name) {
        await supabase.from('users').update({ name: cleanName }).eq('id', existing.id);
        existing.name = cleanName;
      }

      const { data: survey } = await supabase
        .from('survey_responses')
        .select('id')
        .eq('user_id', existing.id)
        .limit(1);

      return res.status(200).json({
        success: true,
        data: {
          user_id:             existing.id,
          email:               existing.email,
          name:                cleanName ?? existing.name,
          onboarding_complete: existing.onboarding_complete ?? false,
          has_survey:          (survey ?? []).length > 0,
        },
      });
    }

    // New user — generate UUID and insert
    const { randomUUID } = await import('crypto');
    const userId = randomUUID();

    const insertPayload: Record<string, unknown> = {
      id:    userId,
      email,
    };
    if (cleanName) insertPayload.name = cleanName;

    const { data: newUser, error: insertErr } = await supabase
      .from('users')
      .insert(insertPayload)
      .select('id, email, name, onboarding_complete')
      .single();

    if (insertErr) throw insertErr;

    return res.status(200).json({
      success: true,
      data: {
        user_id:             newUser.id,
        email:               newUser.email,
        name:                newUser.name ?? null,
        onboarding_complete: newUser.onboarding_complete ?? false,
        has_survey:          false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/users/:userId ────────────────────────────────────────────────────

router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  if (!validateUUID(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid ID format' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, onboarding_complete')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const [surveyResult, dimResult] = await Promise.all([
      supabase.from('survey_responses').select('id').eq('user_id', userId).limit(1),
      supabase
        .from('dimension_scores')
        .select('confidence_score')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        user_id:             user.id,
        email:               user.email,
        name:                user.name ?? null,
        onboarding_complete: user.onboarding_complete ?? false,
        has_survey:          (surveyResult.data ?? []).length > 0,
        confidence_score:
          dimResult.data?.[0]
            ? Number(dimResult.data[0].confidence_score)
            : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/users/:userId ──────────────────────────────────────────────────

const ALLOWED_PATCH_FIELDS = new Set(['name', 'onboarding_complete']);

router.patch('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  if (!validateUUID(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid ID format' });
  }

  try {
    const body = req.body as Record<string, unknown>;
    const unknown = Object.keys(body).filter((k) => !ALLOWED_PATCH_FIELDS.has(k));
    if (unknown.length > 0) {
      return res.status(400).json({
        success: false,
        error:   `Unknown field(s): ${unknown.join(', ')}. Allowed: name, onboarding_complete`,
      });
    }

    const updates: Record<string, unknown> = {};

    if ('name' in body) {
      const rawName = body.name;
      if (rawName !== null && typeof rawName !== 'string') {
        return res.status(400).json({ success: false, error: 'name must be a string or null' });
      }
      updates.name = rawName === null
        ? null
        : stripHtml((rawName as string).trim()).substring(0, 100);
    }

    if ('onboarding_complete' in body) {
      if (typeof body.onboarding_complete !== 'boolean') {
        return res.status(400).json({
          success: false,
          error:   'onboarding_complete must be a boolean',
        });
      }
      updates.onboarding_complete = body.onboarding_complete;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('id, email, name, onboarding_complete')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        user_id:             data.id,
        email:               data.email,
        name:                data.name ?? null,
        onboarding_complete: data.onboarding_complete ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/users/:userId ─────────────────────────────────────────────────
// Hard deletes all user data in FK-safe order.
// Also attempts to delete Backboard assistant (fire-and-forget).

router.delete('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  if (!validateUUID(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid ID format' });
  }

  try {
    // Check user exists + grab assistant_id for Backboard cleanup
    const { data: user, error: lookupErr } = await supabase
      .from('users')
      .select('id, backboard_assistant_id')
      .eq('id', userId)
      .maybeSingle();

    if (lookupErr) throw lookupErr;
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Delete in FK-safe order
    await supabase.from('exercise_completions').delete().eq('user_id', userId);
    await supabase.from('saved_exercises').delete().eq('user_id', userId);
    await supabase.from('signal_data').delete().eq('user_id', userId);
    await supabase.from('survey_responses').delete().eq('user_id', userId);
    await supabase.from('dimension_scores').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);

    // Fire-and-forget: delete Backboard assistant if one was created
    const assistantId = (user as { backboard_assistant_id?: string }).backboard_assistant_id;
    if (assistantId && process.env.BACKBOARD_API_KEY) {
      fetch(`https://app.backboard.io/api/assistants/${assistantId}`, {
        method:  'DELETE',
        headers: { 'X-API-Key': process.env.BACKBOARD_API_KEY },
      }).catch((err) =>
        console.warn('[users] Backboard assistant delete failed (non-fatal):', err),
      );
    }

    return res.status(200).json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
