/**
 * Exercise endpoint integration tests.
 * Real Supabase DB, mocked Backboard fetch (no AI credits burned).
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_KEY in .env
 * Run: ts-node --transpile-only src/scripts/test-exercises-integration.ts
 */

import 'dotenv/config';
import assert from 'node:assert/strict';

// ── Patch global.fetch BEFORE importing anything that calls Backboard ─────────
const BACKBOARD_URL = 'https://app.backboard.io/api/threads/messages';
let mockMode: 'happy' | 'bad_json' | 'wrong_count' | 'bad_id' = 'happy';
let capturedExerciseIds: string[] = []; // filled from first real DB response

const _realFetch = global.fetch;
(global as unknown as Record<string, unknown>).fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (url !== BACKBOARD_URL) return _realFetch(input, init);

  if (mockMode === 'bad_json') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: '{ "recommendations": "not an array" }' }),
    } as Response;
  }

  if (mockMode === 'wrong_count') {
    const items = capturedExerciseIds.slice(0, 3).map((id) => ({
      exercise_id: id,
      match_reason: 'A reason.',
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: JSON.stringify({ recommendations: items }) }),
    } as Response;
  }

  if (mockMode === 'bad_id') {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const items = capturedExerciseIds.slice(0, 5).map((id, i) => ({
      exercise_id: i === 0 ? fakeId : id, // first one is invalid
      match_reason: 'A reason.',
    }));
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: JSON.stringify({ recommendations: items }) }),
    } as Response;
  }

  // happy path — return valid 5-exercise recommendation
  const items = capturedExerciseIds.slice(0, 5).map((id) => ({
    exercise_id: id,
    match_reason: 'Your specific pattern makes this exercise a great fit for you right now.',
  }));
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: JSON.stringify({ recommendations: items }) }),
  } as Response;
};

// ── Imports after fetch patch ──────────────────────────────────────────────────
import { supabase } from '../lib/supabase';
import app from '../app';
import http from 'node:http';

// ── Utilities ─────────────────────────────────────────────────────────────────
function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { reject(new Error(`JSON parse failed: ${data}`)); }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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

// ── Test data ─────────────────────────────────────────────────────────────────
const TEST_USER_ID = `test-exercises-${Date.now()}`;

async function seedUser(): Promise<void> {
  await supabase.from('dimension_scores').insert({
    user_id:              TEST_USER_ID,
    cognitive_load:       70,
    emotional_regulation: 30,
    recovery_capacity:    25,
    confidence_score:     40,
    explanation_text:     'Seeded for exercise integration test',
  });
}

async function cleanup(): Promise<void> {
  await supabase.from('exercise_completions').delete().eq('user_id', TEST_USER_ID);
  await supabase.from('dimension_scores').delete().eq('user_id', TEST_USER_ID);
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  console.log('\nExercise endpoint integration tests\n');

  await cleanup();

  // Pre-fetch exercise IDs so the mock can return valid ones
  const { data: exercises } = await supabase
    .from('exercise_library')
    .select('id, full_ui')
    .order('name');
  if (!exercises || exercises.length < 5) {
    console.error('ERROR: Need at least 5 exercises in exercise_library (run migration 002 + 004 first)');
    process.exit(1);
  }
  capturedExerciseIds = exercises.map((e: { id: string }) => e.id);
  const fullUiIds = exercises.filter((e: { id: string; full_ui: boolean }) => e.full_ui).map((e: { id: string }) => e.id);
  console.log(`  Loaded ${capturedExerciseIds.length} exercises, ${fullUiIds.length} with full_ui=true\n`);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  try {
    // ── 404 when no dimension_scores ─────────────────────────────────────────
    await test('GET /recommended → 404 when no dimension_scores', async () => {
      const { status, body } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      assert.equal(status, 404);
      assert.equal((body as { success: boolean }).success, false);
    });

    await seedUser();

    // ── 200 happy path ────────────────────────────────────────────────────────
    mockMode = 'happy';
    await test('GET /recommended → 200 with 5 recommendations', async () => {
      const { status, body } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      assert.equal(status, 200);
      const d = (body as { success: boolean; data: Record<string, unknown> }).data;
      assert.equal((body as { success: boolean }).success, true);
      const recs = d.recommendations as unknown[];
      assert.equal(recs.length, 5);
    });

    await test('response has correct shape', async () => {
      const { body } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      const d = (body as { data: Record<string, unknown> }).data;
      assert.ok(typeof d.user_id === 'string');
      assert.ok(typeof d.generated_at === 'string');

      const snap = d.dimension_snapshot as Record<string, { score: number; color: string }>;
      for (const dim of ['cognitive_load', 'emotional_regulation', 'recovery_capacity']) {
        assert.ok(typeof snap[dim].score === 'number');
        assert.ok(['green', 'amber', 'red'].includes(snap[dim].color));
      }

      const recs = d.recommendations as Array<{ exercise: Record<string, unknown>; match_reason: string }>;
      for (const r of recs) {
        assert.ok(typeof r.match_reason === 'string' && r.match_reason.length > 0);
        assert.ok(typeof r.exercise.id === 'string');
        assert.ok(typeof r.exercise.name === 'string');
        assert.ok(Array.isArray(r.exercise.categories));
        assert.ok(typeof r.exercise.full_ui === 'boolean');
      }
    });

    // ── 422 on bad AI JSON ────────────────────────────────────────────────────
    mockMode = 'bad_json';
    await test('GET /recommended → 422 when AI returns non-array recommendations', async () => {
      const { status, body } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      assert.equal(status, 422);
      assert.equal((body as { success: boolean }).success, false);
      assert.ok('raw_ai_output' in body, 'should include raw_ai_output for debugging');
    });

    mockMode = 'wrong_count';
    await test('GET /recommended → 422 when AI returns wrong count', async () => {
      const { status } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      assert.equal(status, 422);
    });

    mockMode = 'bad_id';
    await test('GET /recommended → 422 when AI returns invalid exercise_id', async () => {
      const { status } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      assert.equal(status, 422);
    });

    // ── full_ui guarantee ─────────────────────────────────────────────────────
    mockMode = 'happy';
    await test('at least one recommendation has full_ui=true', async () => {
      const { body } = await request(server, 'GET', `/api/exercises/recommended/${TEST_USER_ID}`);
      const recs = (body as { data: { recommendations: Array<{ exercise: { full_ui: boolean } }> } })
        .data.recommendations;
      const hasFullUi = recs.some((r) => r.exercise.full_ui);
      assert.ok(hasFullUi, 'at least one recommendation should have full_ui=true');
    });

    // ── GET / — full library ──────────────────────────────────────────────────
    await test('GET /api/exercises returns all exercises', async () => {
      const { status, body } = await request(server, 'GET', '/api/exercises');
      assert.equal(status, 200);
      const data = (body as { data: unknown[] }).data;
      assert.ok(data.length >= 10, `expected ≥ 10 exercises, got ${data.length}`);
    });

    await test('GET /api/exercises?category=Cognitive returns subset', async () => {
      const { status, body } = await request(server, 'GET', '/api/exercises?category=Cognitive');
      assert.equal(status, 200);
      const data = (body as { data: Array<{ categories: string[] }> }).data;
      assert.ok(data.length > 0);
      for (const ex of data) {
        assert.ok(ex.categories.includes('Cognitive'), `${JSON.stringify(ex.categories)} missing Cognitive`);
      }
    });

    // ── POST /:id/complete ────────────────────────────────────────────────────
    await test('POST /:id/complete → 400 without user_id', async () => {
      const { status } = await request(
        server, 'POST', `/api/exercises/${capturedExerciseIds[0]}/complete`,
        { completion_data: { notes: 'test' } },
      );
      assert.equal(status, 400);
    });

    await test('POST /:id/complete → 404 with non-existent exercise', async () => {
      const { status } = await request(
        server, 'POST', '/api/exercises/00000000-0000-0000-0000-000000000000/complete',
        { user_id: TEST_USER_ID, completion_data: { notes: 'test' } },
      );
      assert.equal(status, 404);
    });

  } finally {
    await cleanup();
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
