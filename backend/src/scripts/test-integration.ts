/**
 * Integration test: POST /api/survey with a real Supabase DB.
 *
 * Requirements:
 *   SUPABASE_URL and SUPABASE_SERVICE_KEY set in .env (or env).
 *   Both migrations 001 and 002 applied to the target DB.
 *
 * Usage:
 *   npm run test:integration
 *
 * The test creates an isolated user, runs all assertions, then deletes the
 * user (which cascades to survey_responses and dimension_scores).
 */

import 'dotenv/config'; // must be first import so env vars are set before supabase.ts loads

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import type { Application } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Guard: skip gracefully when no real DB is configured ─────────────────────
const hasRealDb =
  Boolean(process.env.SUPABASE_URL) &&
  !process.env.SUPABASE_URL!.includes('placeholder') &&
  Boolean(process.env.SUPABASE_SERVICE_KEY) &&
  !process.env.SUPABASE_SERVICE_KEY!.includes('placeholder');

if (!hasRealDb) {
  console.log(
    '[integration] SKIPPED — set SUPABASE_URL + SUPABASE_SERVICE_KEY in .env to run these tests.',
  );
  process.exit(0);
}

// ── Test suite ────────────────────────────────────────────────────────────────

const BASE_SURVEY = {
  phq_answers: [2, 2, 3, 2, 1, 1, 2, 0, 0], // PHQ-A total = 13
  gad_answers: [2, 2, 2, 1, 1, 1, 1],        // GAD-7  total = 10
  // expected: cognitive_load=58, emotional_regulation=50, recovery_capacity=33
};

const ALT_SURVEY = {
  phq_answers: [1, 1, 1, 1, 1, 1, 1, 1, 0], // lower symptom burden
  gad_answers: [1, 1, 1, 1, 1, 1, 1],
};

describe('Integration: survey multi-submission', () => {
  let agent: ReturnType<typeof supertest>;
  let sb: SupabaseClient;
  let testUserId: string;
  let survey1Id: string;
  let survey2Id: string;

  before(async () => {
    // require() defers module load until here, after env vars are confirmed set
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = (require('../app') as { default: Application }).default;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sb = (require('../lib/supabase') as { supabase: SupabaseClient }).supabase;
    agent = supertest(app);

    // Create an isolated test user; email is timestamped to avoid collisions
    const { data, error } = await sb
      .from('users')
      .insert({ email: `integration-${Date.now()}@mosaic-test.local` })
      .select()
      .single();

    if (error) throw new Error(`Failed to create test user: ${error.message}`);
    testUserId = data.id as string;
  });

  after(async () => {
    // CASCADE removes survey_responses and dimension_scores for this user
    if (testUserId) {
      await sb.from('users').delete().eq('id', testUserId);
    }
  });

  // ── Test 1: first submission creates rows ──────────────────────────────────

  it('first survey submission returns 201 with correct scores', async () => {
    const res = await agent
      .post('/api/survey')
      .send({ user_id: testUserId, ...BASE_SURVEY });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);

    const { survey, dimension_scores } = res.body.data as {
      survey: { id: string; phq_a_score: number; gad7_score: number };
      dimension_scores: Record<string, unknown>;
    };

    assert.equal(survey.phq_a_score, 13);
    assert.equal(survey.gad7_score, 10);
    assert.equal(dimension_scores.cognitive_load, 58);
    assert.equal(dimension_scores.emotional_regulation, 50);
    assert.equal(dimension_scores.recovery_capacity, 33);
    assert.equal(dimension_scores.confidence_score, 40, 'first submission confidence should be 40');

    survey1Id = survey.id;
  });

  // ── Test 2: second submission creates ADDITIONAL rows, not replacements ────

  it('second survey submission (same user) creates a second independent row', async () => {
    const res = await agent
      .post('/api/survey')
      .send({ user_id: testUserId, ...ALT_SURVEY });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    survey2Id = res.body.data.survey.id as string;

    // IDs must be different — this is the uniqueness/independence check
    assert.notEqual(survey2Id, survey1Id, 'two submissions must produce distinct row IDs');
  });

  it('two survey_responses rows exist for the user after two submissions', async () => {
    const { data, error } = await sb
      .from('survey_responses')
      .select('id, phq_a_score, created_at')
      .eq('user_id', testUserId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    assert.equal(data.length, 2, 'exactly 2 survey_responses rows should exist');
    assert.equal(data[0].id, survey1Id, 'first row should be earliest submission');
    assert.equal(data[1].id, survey2Id, 'second row should be latest submission');
  });

  it('two dimension_scores rows exist and order correctly by created_at DESC', async () => {
    const { data, error } = await sb
      .from('dimension_scores')
      .select('id, confidence_score, created_at')
      .eq('user_id', testUserId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    assert.equal(data.length, 2, 'exactly 2 dimension_scores rows should exist');

    const [latest, oldest] = data as { id: string; confidence_score: number; created_at: string }[];
    // Ordering: latest row (from second submission) comes first in DESC order
    assert.ok(
      new Date(latest.created_at) >= new Date(oldest.created_at),
      'DESC order should return most recent row first',
    );
  });

  // ── Test 3: confidence_score preservation across retakes ───────────────────

  it('confidence_score is preserved from prior signals on survey retake', async () => {
    // Simulate a Part-3 signal boost: insert a dimension_scores row with confidence=75
    // (bypassing the API, as signals.ts would do in Part 3)
    const { error: insertErr } = await sb.from('dimension_scores').insert({
      user_id: testUserId,
      cognitive_load: 45,
      emotional_regulation: 60,
      recovery_capacity: 55,
      confidence_score: 75,
      explanation_text: 'Test: simulated signal boost (transcript + sleep)',
    });

    if (insertErr) throw insertErr;

    // Now retake the survey — confidence must not drop back to 40
    const res = await agent
      .post('/api/survey')
      .send({ user_id: testUserId, ...BASE_SURVEY });

    assert.equal(res.status, 201);

    const newDim = res.body.data.dimension_scores as Record<string, unknown>;
    assert.equal(
      newDim.confidence_score,
      75,
      'retaking the survey must preserve signal-boosted confidence (75), not reset to 40',
    );

    // Dimension values are refreshed from new survey answers (not from the signal-boosted row)
    assert.equal(newDim.cognitive_load, 58);
    assert.equal(newDim.emotional_regulation, 50);
    assert.equal(newDim.recovery_capacity, 33);
  });

  it('confidence_score stays at 40 if no prior score exceeded 40', async () => {
    // Create a fresh user with no signal history
    const { data: freshUser, error: freshErr } = await sb
      .from('users')
      .insert({ email: `integration-fresh-${Date.now()}@mosaic-test.local` })
      .select()
      .single();

    if (freshErr) throw freshErr;

    try {
      const res = await agent
        .post('/api/survey')
        .send({ user_id: freshUser.id, ...BASE_SURVEY });

      assert.equal(res.status, 201);
      assert.equal(
        res.body.data.dimension_scores.confidence_score,
        40,
        'first-time user with no signals should get confidence_score = 40',
      );
    } finally {
      await sb.from('users').delete().eq('id', freshUser.id);
    }
  });
});
