/**
 * Seed the synthetic demo student.
 *
 * Narrative: a student who appeared fine on survey alone (CL moderate, ER moderate)
 * but whose voice + sleep signals revealed a real decline over 5 weeks.
 * A single-signal tool (survey only) would have missed it.
 *
 * Fixed UUID: 00000000-0000-0000-0000-000000000001
 * Idempotent: delete-then-reinsert all related rows; upsert the users row.
 *
 * Run: ts-node --transpile-only src/scripts/seed-demo-student.ts
 */

import 'dotenv/config';
import { supabase } from '../lib/supabase';
import { createAssistant, getAssistantId } from '../lib/backboardMemory';

const DEMO_USER_ID    = '00000000-0000-0000-0000-000000000001';
const DEMO_USER_EMAIL = 'demo-mosaic@example.com';
const DEMO_USER_NAME  = 'Demo Student';

function weeksAgo(n: number): string {
  return new Date(Date.now() - n * 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function run(): Promise<void> {
  console.log(`\nSeeding demo student  (user_id: ${DEMO_USER_ID})\n`);

  // ── 1. Upsert users row ────────────────────────────────────────────────────
  const { error: userErr } = await supabase
    .from('users')
    .upsert(
      {
        id:                  DEMO_USER_ID,
        email:               DEMO_USER_EMAIL,
        name:                DEMO_USER_NAME,
        onboarding_complete: true,
      },
      { onConflict: 'id' },
    );
  if (userErr) {
    console.error('users upsert failed:', userErr);
    process.exit(1);
  }
  console.log('✓ users row upserted');

  // ── 2. Wipe existing data for this user (idempotency) ──────────────────────
  await supabase.from('exercise_completions').delete().eq('user_id', DEMO_USER_ID);
  await supabase.from('saved_exercises').delete().eq('user_id', DEMO_USER_ID);
  await supabase.from('dimension_scores').delete().eq('user_id', DEMO_USER_ID);
  await supabase.from('signal_data').delete().eq('user_id', DEMO_USER_ID);
  await supabase.from('survey_responses').delete().eq('user_id', DEMO_USER_ID);
  console.log('✓ prior demo data cleared');

  // ── 3. Survey response (baseline visit) ────────────────────────────────────
  const { error: surveyErr } = await supabase.from('survey_responses').insert({
    user_id:     DEMO_USER_ID,
    phq_a_score: 6,
    gad7_score:  7,
    raw_answers: {
      note: 'Demo student baseline — moderate scores on survey alone, decline hidden in signals.',
    },
    created_at: weeksAgo(5),
  });
  if (surveyErr) {
    console.error('survey_responses insert failed:', surveyErr);
    process.exit(1);
  }
  console.log('✓ survey_responses inserted');

  // ── 4. Signal data (transcript + sleep + voice) ─────────────────────────────

  const signals: Array<{
    user_id:                 string;
    signal_type:             'transcript' | 'sleep' | 'voice';
    raw_data:                Record<string, unknown>;
    processed_data:          Record<string, unknown>;
    confidence_contribution: number;
    created_at:              string;
  }> = [
    {
      user_id:    DEMO_USER_ID,
      signal_type: 'transcript',
      raw_data:    { source: 'demo_seed' },
      processed_data: {
        gpa:           3.1,
        course_load:   7,
        has_ap_honors: true,
        grade_trend:   'declining',
      },
      confidence_contribution: 20,
      created_at: weeksAgo(1),
    },
    {
      user_id:    DEMO_USER_ID,
      signal_type: 'sleep',
      raw_data:    { source: 'demo_seed' },
      processed_data: {
        avg_sleep_hours:           5.4,
        sleep_variability_hours:   1.8,
        nights_analyzed:           14,
      },
      confidence_contribution: 20,
      created_at: weeksAgo(1),
    },
    {
      user_id:    DEMO_USER_ID,
      signal_type: 'voice',
      raw_data:    { source: 'demo_seed' },
      processed_data: {
        speaking_ratio:    0.38,
        num_pauses:        9,
        pitch_variance_hz: 12,
      },
      confidence_contribution: 20,
      created_at: weeksAgo(1),
    },
  ];

  const { error: sigErr } = await supabase.from('signal_data').insert(signals);
  if (sigErr) {
    console.error('signal_data insert failed:', sigErr);
    process.exit(1);
  }
  console.log('✓ signal_data inserted (transcript, sleep, voice)');

  // ── 5. Five weekly dimension_scores snapshots ───────────────────────────────

  const snapshots = [
    {
      user_id:              DEMO_USER_ID,
      cognitive_load:       55,
      emotional_regulation: 60,
      recovery_capacity:    65,
      confidence_score:     40,
      explanation_text:     'Survey only — baseline established.',
      created_at:           weeksAgo(5),
    },
    {
      user_id:              DEMO_USER_ID,
      cognitive_load:       58,
      emotional_regulation: 54,
      recovery_capacity:    60,
      confidence_score:     60,
      explanation_text:     'Sleep data added. Minor recovery dip.',
      created_at:           weeksAgo(4),
    },
    {
      user_id:              DEMO_USER_ID,
      cognitive_load:       64,
      emotional_regulation: 47,
      recovery_capacity:    52,
      confidence_score:     80,
      explanation_text:     'Voice signal detected flat affect. Emotional regulation declining.',
      created_at:           weeksAgo(3),
    },
    {
      user_id:              DEMO_USER_ID,
      cognitive_load:       70,
      emotional_regulation: 38,
      recovery_capacity:    44,
      confidence_score:     80,
      explanation_text:     'Cognitive load now high. Sleep variability worsening.',
      created_at:           weeksAgo(2),
    },
    {
      user_id:              DEMO_USER_ID,
      cognitive_load:       76,
      emotional_regulation: 29,
      recovery_capacity:    36,
      confidence_score:     100,
      explanation_text:     'All signals present. Significant stress pattern confirmed across all dimensions.',
      created_at:           weeksAgo(1),
    },
  ];

  const { error: dimErr } = await supabase.from('dimension_scores').insert(snapshots);
  if (dimErr) {
    console.error('dimension_scores insert failed:', dimErr);
    process.exit(1);
  }
  console.log('✓ dimension_scores inserted (5 weekly snapshots)');

  // ── 6. Backboard assistant (fire-and-forget) ───────────────────────────────
  if (process.env.BACKBOARD_API_KEY) {
    const existing = await getAssistantId(DEMO_USER_ID);
    if (!existing) {
      const assistantId = await createAssistant(DEMO_USER_ID);
      if (assistantId) {
        console.log(`✓ Backboard assistant created: ${assistantId}`);
      } else {
        console.log('⚠ Backboard assistant creation skipped (non-fatal)');
      }
    } else {
      console.log(`✓ Backboard assistant already exists: ${existing}`);
    }
  } else {
    console.log('⚠ BACKBOARD_API_KEY not set — Backboard assistant creation skipped');
  }

  // ── 7. Summary ─────────────────────────────────────────────────────────────
  console.log('\nDemo student seeded successfully.\n');
  console.log('Visit 1 → CL=55, ER=60, RC=65  (survey only — looks fine)');
  console.log('Visit 2 → CL=58, ER=54, RC=60  (sleep: minor dip)');
  console.log('Visit 3 → CL=64, ER=47, RC=52  (voice: flat affect)');
  console.log('Visit 4 → CL=70, ER=38, RC=44  (all signals: clear decline)');
  console.log('Visit 5 → CL=76, ER=29, RC=36  (all signals: crisis pattern)');
  console.log('\nTrend v4→v5: CL +6 (worsening), ER -9 (worsening), RC -8 (worsening)');
  console.log(`\nTest with:\n  GET /api/trend/${DEMO_USER_ID}`);
  console.log(`  GET /api/exercises/recommended/${DEMO_USER_ID}`);
  console.log(`  GET /api/dashboard/${DEMO_USER_ID}`);
}

run().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
