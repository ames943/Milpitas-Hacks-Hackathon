import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { scorePHQA, scoreGAD7, calculateDimensions } from '../lib/scoring';

const router = Router();

// POST /api/survey
// Body: { user_id: string, phq_answers: number[9], gad_answers: number[7] }
// Each answer is an integer 0-3 (standard PHQ-A / GAD-7 Likert scale).
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, phq_answers, gad_answers } = req.body as {
      user_id?: string;
      phq_answers?: unknown;
      gad_answers?: unknown;
    };

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ success: false, error: 'user_id (string) is required' });
    }
    if (!Array.isArray(phq_answers) || phq_answers.length !== 9) {
      return res.status(400).json({ success: false, error: 'phq_answers must be an array of 9 integers (0-3)' });
    }
    if (!Array.isArray(gad_answers) || gad_answers.length !== 7) {
      return res.status(400).json({ success: false, error: 'gad_answers must be an array of 7 integers (0-3)' });
    }

    let phq_a_score: number;
    let gad7_score: number;
    let dimensions: ReturnType<typeof calculateDimensions>;

    try {
      phq_a_score = scorePHQA(phq_answers as number[]);
      gad7_score = scoreGAD7(gad_answers as number[]);
      dimensions = calculateDimensions(phq_answers as number[], gad_answers as number[]);
    } catch (validationErr) {
      return res.status(400).json({
        success: false,
        error: (validationErr as Error).message,
      });
    }

    // raw_answers is constructed explicitly from validated arrays only —
    // extra fields from req.body are never forwarded here.
    const { data: surveyRow, error: surveyErr } = await supabase
      .from('survey_responses')
      .insert({
        user_id,
        phq_a_score,
        gad7_score,
        raw_answers: { phq_answers, gad_answers },
      })
      .select()
      .single();

    if (surveyErr) throw surveyErr;

    // Fetch the user's latest confidence score before inserting a new dimension_scores row.
    // Survey resubmission resets the three dimension values to survey-only baselines, but
    // must NOT lower confidence that was already raised by transcript/sleep/voice signals.
    const { data: priorRows, error: priorErr } = await supabase
      .from('dimension_scores')
      .select('confidence_score')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (priorErr) throw priorErr;

    const priorConfidence = Number(priorRows?.[0]?.confidence_score ?? 0);
    // Floor is 40 (survey-only baseline); preserve any higher value from signals.
    const confidence_score = Math.max(40, priorConfidence);

    const { data: dimRow, error: dimErr } = await supabase
      .from('dimension_scores')
      .insert({
        user_id,
        cognitive_load: dimensions.cognitive_load,
        emotional_regulation: dimensions.emotional_regulation,
        recovery_capacity: dimensions.recovery_capacity,
        confidence_score,
        explanation_text:
          confidence_score > 40
            ? `Survey-only dimension values (PHQ-A + GAD-7); confidence preserved from prior signals (${confidence_score}).`
            : 'Survey-only baseline (PHQ-A + GAD-7). Confidence will increase as transcript, sleep, and voice signals are provided.',
      })
      .select()
      .single();

    if (dimErr) throw dimErr;

    return res.status(201).json({
      success: true,
      data: {
        survey: {
          id: surveyRow.id,
          phq_a_score,
          gad7_score,
        },
        dimension_scores: dimRow,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
