import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { getLatestDimensionScores } from '../lib/dimensionUpdate';
import { callAI } from '../lib/aiClient';
import { dimensionColor, buildConfidenceBreakdown } from '../lib/dashboardHelpers';
import { getAssistantId, searchMemories } from '../lib/backboardMemory';
import { validateUUID } from '../lib/utils';

const router = Router();

const DISCLAIMER =
  'This is not a diagnosis. These insights are meant to support reflection, not replace professional evaluation.';

const AI_FALLBACK = "We're still analyzing this dimension.";

const EXPLANATION_SYSTEM_PROMPT = `You are a caring student wellbeing advisor reviewing a student's health and academic data. Write exactly ONE sentence in plain, warm language that explains what is most likely driving the student's situation in the dimension described.

Requirements:
- Be specific to the data provided — no generic filler statements
- Do not mention any numbers, scores, or percentages
- Do not use clinical terminology
- Write in second person ("your...")
- One sentence only — no lists, no line breaks
- Tone: caring school counselor, not a doctor or report`;

const FREQ = ['not at all', 'on several days', 'more than half the days', 'nearly every day'];
const freq = (v: number): string => FREQ[Math.min(3, Math.max(0, Math.round(v)))] ?? 'unknown';

type SurveyAnswers = { phq_answers: number[]; gad_answers: number[] };

interface TranscriptProcessed {
  gpa?: number;
  course_load?: number;
  has_ap_honors?: boolean;
  grade_trend?: string;
}

interface SleepProcessed {
  avg_sleep_hours?: number;
  sleep_variability_hours?: number;
  nights_analyzed?: number;
}

interface VoiceProcessed {
  duration_seconds?: number;
  speaking_ratio?: number;
  num_pauses?: number;
  pitch_variance_hz?: number;
}

function buildCognitiveLoadPrompt(
  score: number,
  survey: SurveyAnswers | null,
  transcript: TranscriptProcessed | null,
  priorContext: string,
): string {
  const lines = [];
  if (priorContext) {
    lines.push(priorContext);
    lines.push('');
  }
  lines.push(
    `DIMENSION: Cognitive Load — how much mental bandwidth is being consumed`,
    `Current level: ${score <= 33 ? 'low' : score <= 66 ? 'moderate' : 'high'} (${score}/100, where higher means more strain)`,
  );

  if (survey) {
    lines.push('\nSelf-reported challenges (from initial survey):');
    lines.push(`- Trouble concentrating: ${freq(survey.phq_answers[6])}`);
    lines.push(`- Uncontrollable worry: ${freq(survey.gad_answers[1])}`);
    lines.push(`- Excessive worry: ${freq(survey.gad_answers[2])}`);
    lines.push(`- Restlessness/inability to sit still: ${freq(survey.gad_answers[4])}`);
  }

  if (transcript) {
    lines.push('\nAcademic context (from uploaded transcript):');
    if (transcript.course_load !== undefined)
      lines.push(`- Courses this term: ${transcript.course_load}`);
    if (transcript.grade_trend !== undefined)
      lines.push(`- Grade trend vs previous term: ${transcript.grade_trend}`);
    if (transcript.has_ap_honors !== undefined)
      lines.push(`- Includes AP or Honors courses: ${transcript.has_ap_honors}`);
    if (transcript.gpa !== undefined)
      lines.push(`- Current GPA: ${transcript.gpa.toFixed(2)}`);
  }

  lines.push('\nWrite one sentence specific to this student\'s data.');
  return lines.join('\n');
}

function buildEmotionalRegulationPrompt(
  score: number,
  survey: SurveyAnswers | null,
  voice: VoiceProcessed | null,
  priorContext: string,
): string {
  const lines = [];
  if (priorContext) {
    lines.push(priorContext);
    lines.push('');
  }
  lines.push(
    `DIMENSION: Emotional Regulation — ability to manage and express emotions`,
    `Current level: ${score >= 67 ? 'good' : score >= 34 ? 'moderate' : 'low'} (${score}/100, where higher means better regulation)`,
  );

  if (survey) {
    lines.push('\nSelf-reported feelings (from initial survey):');
    lines.push(`- Loss of interest or pleasure: ${freq(survey.phq_answers[0])}`);
    lines.push(`- Feeling down or depressed: ${freq(survey.phq_answers[1])}`);
    lines.push(`- Feelings of worthlessness or guilt: ${freq(survey.phq_answers[5])}`);
    lines.push(`- Easily annoyed or irritable: ${freq(survey.gad_answers[5])}`);
  }

  if (voice) {
    lines.push('\nVoice sample analysis:');
    if (voice.speaking_ratio !== undefined)
      lines.push(`- Proportion of time speaking: ${Math.round(voice.speaking_ratio * 100)}%`);
    if (voice.num_pauses !== undefined)
      lines.push(`- Number of long pauses detected: ${voice.num_pauses}`);
    if (voice.pitch_variance_hz !== undefined) {
      const expressiveness =
        voice.pitch_variance_hz < 20 ? 'very flat (monotone)'
        : voice.pitch_variance_hz < 50 ? 'somewhat flat'
        : 'moderate range';
      lines.push(`- Vocal expressiveness: ${expressiveness}`);
    }
  }

  lines.push('\nWrite one sentence specific to this student\'s data.');
  return lines.join('\n');
}

function buildRecoveryCapacityPrompt(
  score: number,
  survey: SurveyAnswers | null,
  sleep: SleepProcessed | null,
  priorContext: string,
): string {
  const lines = [];
  if (priorContext) {
    lines.push(priorContext);
    lines.push('');
  }
  lines.push(
    `DIMENSION: Recovery Capacity — ability to physically and mentally recharge`,
    `Current level: ${score >= 67 ? 'good' : score >= 34 ? 'moderate' : 'low'} (${score}/100, where higher means better recovery)`,
  );

  if (survey) {
    lines.push('\nSelf-reported recovery challenges (from initial survey):');
    lines.push(`- Sleep problems: ${freq(survey.phq_answers[2])}`);
    lines.push(`- Fatigue or low energy: ${freq(survey.phq_answers[3])}`);
    lines.push(`- Trouble relaxing: ${freq(survey.gad_answers[3])}`);
  }

  if (sleep) {
    lines.push('\nSleep data (from uploaded CSV):');
    if (sleep.avg_sleep_hours !== undefined)
      lines.push(`- Average nightly sleep: ${sleep.avg_sleep_hours.toFixed(1)} hours`);
    if (sleep.sleep_variability_hours !== undefined)
      lines.push(`- Night-to-night variability: ±${sleep.sleep_variability_hours.toFixed(1)} hours (sample std dev)`);
    if (sleep.nights_analyzed !== undefined)
      lines.push(`- Nights analyzed: ${sleep.nights_analyzed}`);
  }

  lines.push('\nWrite one sentence specific to this student\'s data.');
  return lines.join('\n');
}

async function safeExplain(call: Promise<string>, dimension: string): Promise<string> {
  try {
    return await call;
  } catch (err) {
    console.error(`[dashboard] ${dimension} explanation failed:`, (err as Error).message ?? err);
    return AI_FALLBACK;
  }
}

// ── GET /api/dashboard/:userId ────────────────────────────────────────────────

router.get(
  '/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;

    if (!validateUUID(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }

    try {
      const latest = await getLatestDimensionScores(userId);
      if (!latest) {
        return res.status(404).json({
          success: false,
          error: 'No scores found for this user. Please complete the initial survey first.',
        });
      }

      // Fetch signals (active only) + survey in parallel
      const [signalsResult, surveyResult] = await Promise.all([
        supabase
          .from('signal_data')
          .select('signal_type, processed_data, confidence_contribution, created_at')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('survey_responses')
          .select('raw_answers, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      if (signalsResult.error) throw signalsResult.error;
      if (surveyResult.error) throw surveyResult.error;

      const signals = signalsResult.data ?? [];
      const surveyAnswers =
        (surveyResult.data?.[0]?.raw_answers as SurveyAnswers | null) ?? null;

      const distinctTypes = [...new Set(signals.map((s) => s.signal_type as string))];
      const { breakdown, potential } = buildConfidenceBreakdown(
        distinctTypes,
        Number(latest.confidence_score),
      );

      const transcriptSignal = signals.find((s) => s.signal_type === 'transcript');
      const sleepSignal      = signals.find((s) => s.signal_type === 'sleep');
      const voiceSignal      = signals.find((s) => s.signal_type === 'voice');

      const clScore = Math.round(Number(latest.cognitive_load));
      const erScore = Math.round(Number(latest.emotional_regulation));
      const rcScore = Math.round(Number(latest.recovery_capacity));

      // Fetch Backboard prior context — race against 3s to keep dashboard latency bounded
      let priorContext = '';
      try {
        const assistantId = await getAssistantId(userId);
        if (assistantId) {
          priorContext = await Promise.race([
            searchMemories(assistantId, 'dimension score history trend performance'),
            new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3_000)),
          ]);
        }
      } catch {
        // prior context is best-effort; proceed without it
      }

      const clPrompt = buildCognitiveLoadPrompt(
        clScore, surveyAnswers,
        (transcriptSignal?.processed_data as TranscriptProcessed) ?? null,
        priorContext,
      );
      const erPrompt = buildEmotionalRegulationPrompt(
        erScore, surveyAnswers,
        (voiceSignal?.processed_data as VoiceProcessed) ?? null,
        priorContext,
      );
      const rcPrompt = buildRecoveryCapacityPrompt(
        rcScore, surveyAnswers,
        (sleepSignal?.processed_data as SleepProcessed) ?? null,
        priorContext,
      );

      const [clExpl, erExpl, rcExpl] = await Promise.all([
        safeExplain(
          callAI(EXPLANATION_SYSTEM_PROMPT, clPrompt, { timeoutMs: 15_000 }),
          'cognitive_load',
        ),
        safeExplain(
          callAI(EXPLANATION_SYSTEM_PROMPT, erPrompt, { timeoutMs: 15_000 }),
          'emotional_regulation',
        ),
        safeExplain(
          callAI(EXPLANATION_SYSTEM_PROMPT, rcPrompt, { timeoutMs: 15_000 }),
          'recovery_capacity',
        ),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          user_id:      userId,
          generated_at: new Date().toISOString(),
          confidence: {
            total: Number(latest.confidence_score),
            breakdown,
            potential,
          },
          dimensions: {
            cognitive_load: {
              score:       clScore,
              color:       dimensionColor(clScore, true),
              explanation: clExpl,
            },
            emotional_regulation: {
              score:       erScore,
              color:       dimensionColor(erScore, false),
              explanation: erExpl,
            },
            recovery_capacity: {
              score:       rcScore,
              color:       dimensionColor(rcScore, false),
              explanation: rcExpl,
            },
          },
          disclaimer: DISCLAIMER,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
