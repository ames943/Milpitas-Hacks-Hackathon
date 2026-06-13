/**
 * Dashboard integration test — real Supabase DB, mocked Backboard fetch.
 *
 * Requires:
 *   SUPABASE_URL + SUPABASE_SERVICE_KEY in .env
 *
 * What it tests:
 *   1. GET /api/dashboard/:userId returns 404 when user has no dimension_scores
 *   2. GET /api/dashboard/:userId returns 200 with correct shape after survey insert
 *   3. Confidence breakdown correctly reflects signal_data rows
 *   4. Backboard calls are intercepted (no real API cost); fallback used on error
 *
 * Run: ts-node --transpile-only src/scripts/test-dashboard-integration.ts
 */

import 'dotenv/config';
import assert from 'node:assert/strict';

// ── Patch global fetch BEFORE importing anything that uses it ─────────────────
const BACKBOARD_URL = 'https://app.backboard.io/api/threads/messages';
let backboardCallCount = 0;
let simulateBackboardError = false;

const _realFetch = global.fetch;
(global as unknown as Record<string, unknown>).fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (url === BACKBOARD_URL) {
    backboardCallCount++;
    if (simulateBackboardError) {
      return {
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: 'Your academic schedule is keeping your mind especially busy right now.',
      }),
    } as Response;
  }
  // Real fetch for Supabase
  return _realFetch(input, init);
};

// ── Now import app & helpers ──────────────────────────────────────────────────
import { supabase } from '../lib/supabase';

// Express app for supertest-style testing via direct route handler
import app from '../app';
import http from 'node:http';

// ── Simple HTTP client (avoids supertest dependency) ─────────────────────────
function request(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            reject(new Error(`JSON parse failed: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Test helpers ──────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    fail++;
  }
}

// ── Seed / cleanup helpers ───────────────────────────────────────────────────
const TEST_USER_ID = `test-dashboard-${Date.now()}`;

async function seedSurveyAndDimensionScores(): Promise<void> {
  const { error: survErr } = await supabase.from('survey_responses').insert({
    user_id: TEST_USER_ID,
    raw_answers: {
      phq_answers: [1, 2, 0, 1, 0, 0, 2, 0],
      gad_answers: [0, 1, 2, 1, 0, 1, 0],
    },
    phq_score: 6,
    gad_score: 5,
  });
  if (survErr) throw survErr;

  const { error: dimErr } = await supabase.from('dimension_scores').insert({
    user_id:              TEST_USER_ID,
    cognitive_load:       55,
    emotional_regulation: 60,
    recovery_capacity:    45,
    confidence_score:     40,
    explanation:          'Initial survey complete',
  });
  if (dimErr) throw dimErr;
}

async function seedSignalData(signalType: string, processedData: object): Promise<void> {
  const { error } = await supabase.from('signal_data').insert({
    user_id:                TEST_USER_ID,
    signal_type:            signalType,
    processed_data:         processedData,
    confidence_contribution: 20,
  });
  if (error) throw error;
}

async function cleanup(): Promise<void> {
  await supabase.from('signal_data').delete().eq('user_id', TEST_USER_ID);
  await supabase.from('dimension_scores').delete().eq('user_id', TEST_USER_ID);
  await supabase.from('survey_responses').delete().eq('user_id', TEST_USER_ID);
}

// ── Main test run ─────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  console.log('\nDashboard integration tests\n');

  await cleanup(); // clean any leftover from a previous failed run

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  try {
    // ── Test 1: 404 when no dimension_scores ─────────────────────────────────
    await test('returns 404 when user has no dimension_scores', async () => {
      const { status, body } = await request(server, `/api/dashboard/${TEST_USER_ID}`);
      assert.equal(status, 404);
      assert.equal((body as { success: boolean }).success, false);
    });

    // ── Seed baseline ─────────────────────────────────────────────────────────
    await seedSurveyAndDimensionScores();

    // ── Test 2: 200 with correct shape (survey only) ─────────────────────────
    backboardCallCount = 0;
    await test('returns 200 with correct shape for survey-only user', async () => {
      const { status, body } = await request(server, `/api/dashboard/${TEST_USER_ID}`);
      assert.equal(status, 200);
      const d = body as { success: boolean; data: Record<string, unknown> };
      assert.equal(d.success, true);
      const data = d.data;
      assert.equal(data.user_id, TEST_USER_ID);
      assert.ok(typeof data.generated_at === 'string', 'generated_at should be a string');

      // Confidence
      const conf = data.confidence as { total: number; breakdown: unknown[]; potential: unknown[] };
      assert.equal(conf.total, 40);
      assert.equal(conf.breakdown.length, 1); // survey only
      assert.equal(conf.potential.length, 3); // transcript, sleep, voice

      // Dimensions
      const dims = data.dimensions as Record<string, { score: number; color: string; explanation: string }>;
      assert.equal(typeof dims.cognitive_load.score, 'number');
      assert.ok(['green', 'amber', 'red'].includes(dims.cognitive_load.color));
      assert.ok(dims.cognitive_load.explanation.length > 0);
      assert.ok(dims.emotional_regulation.explanation.length > 0);
      assert.ok(dims.recovery_capacity.explanation.length > 0);

      assert.ok(typeof data.disclaimer === 'string');
    });

    await test('makes exactly 3 Backboard calls (one per dimension)', async () => {
      backboardCallCount = 0;
      await request(server, `/api/dashboard/${TEST_USER_ID}`);
      assert.equal(backboardCallCount, 3);
    });

    // ── Test 3: color band correctness ───────────────────────────────────────
    await test('cognitive_load=55 → amber color', async () => {
      const { body } = await request(server, `/api/dashboard/${TEST_USER_ID}`);
      const dims = (body as { data: { dimensions: Record<string, { color: string }> } })
        .data.dimensions;
      assert.equal(dims.cognitive_load.color, 'amber');
    });

    // ── Test 4: confidence breakdown reflects submitted signals ──────────────
    await seedSignalData('transcript', {
      gpa: 3.5,
      course_load: 6,
      has_ap_honors: true,
      grade_trend: 'declining',
    });

    // Bump confidence_score in dimension_scores to reflect transcript submission
    await supabase.from('dimension_scores').insert({
      user_id:              TEST_USER_ID,
      cognitive_load:       65,
      emotional_regulation: 58,
      recovery_capacity:    42,
      confidence_score:     60,
      explanation:          'After transcript upload',
    });

    await test('confidence breakdown includes transcript after signal inserted', async () => {
      const { body } = await request(server, `/api/dashboard/${TEST_USER_ID}`);
      const conf = (body as { data: { confidence: { breakdown: { source: string }[]; potential: { source: string }[] } } })
        .data.confidence;
      const breakdownSources = conf.breakdown.map((b) => b.source);
      assert.ok(breakdownSources.includes('survey'));
      assert.ok(breakdownSources.includes('transcript'));
      const potentialSources = conf.potential.map((p) => p.source);
      assert.ok(!potentialSources.includes('transcript'));
    });

    // ── Test 5: graceful fallback on Backboard error ─────────────────────────
    simulateBackboardError = true;
    await test('returns 200 with fallback text when Backboard fails', async () => {
      const { status, body } = await request(server, `/api/dashboard/${TEST_USER_ID}`);
      assert.equal(status, 200);
      const dims = (body as { data: { dimensions: Record<string, { explanation: string }> } })
        .data.dimensions;
      const FALLBACK = "We're still analyzing this dimension.";
      assert.equal(dims.cognitive_load.explanation, FALLBACK);
      assert.equal(dims.emotional_regulation.explanation, FALLBACK);
      assert.equal(dims.recovery_capacity.explanation, FALLBACK);
    });
    simulateBackboardError = false;

    // ── Test 6: would_bring_total_to caps at 100 ─────────────────────────────
    await test('potential would_bring_total_to never exceeds 100', async () => {
      // Seed a user already at 80 confidence with 2 signals
      const highConfUserId = `test-dashboard-highconf-${Date.now()}`;
      await supabase.from('dimension_scores').insert({
        user_id:              highConfUserId,
        cognitive_load:       50,
        emotional_regulation: 50,
        recovery_capacity:    50,
        confidence_score:     80,
        explanation:          'High confidence user',
      });
      await seedSignalData('transcript', { gpa: 3.0, course_load: 5, has_ap_honors: false, grade_trend: 'stable' });
      await seedSignalData('sleep', { avg_sleep_hours: 7.2, sleep_variability_hours: 0.8, nights_analyzed: 14 });

      // Use high-confidence user to check cap
      const { body } = await request(server, `/api/dashboard/${highConfUserId}`);
      const potential = (body as { data: { confidence: { potential: { would_bring_total_to: number }[] } } })
        .data.confidence.potential;
      for (const p of potential) {
        assert.ok(p.would_bring_total_to <= 100, `would_bring_total_to ${p.would_bring_total_to} exceeds 100`);
      }

      // Cleanup this extra user
      await supabase.from('dimension_scores').delete().eq('user_id', highConfUserId);
    });

  } finally {
    await cleanup();
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
