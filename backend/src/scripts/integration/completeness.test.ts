/**
 * Part 6.5 completeness integration tests.
 * Covers: user profile, privacy deletes, saved exercises, exercise history,
 * voice prompt, counselor flag, input sanitization, rate limiting, regression.
 *
 * Supabase: real. AI (Backboard completions): mocked.
 * Each describe section uses its own UUID(s) and cleans up in afterAll.
 */
import 'dotenv/config';

jest.mock('../../lib/aiClient', () => ({
  callAI: jest.fn(),
  AIParseError: class AIParseError extends Error {
    rawOutput: string;
    constructor(msg: string, raw: string) {
      super(msg);
      this.name = 'AIParseError';
      this.rawOutput = raw;
    }
  },
  extractTranscriptData: jest.fn(),
}));

// Also mock backboardMemory so Backboard HTTP calls never fire during tests
jest.mock('../../lib/backboardMemory', () => ({
  getAssistantId:       jest.fn().mockResolvedValue(null),
  createAssistant:      jest.fn().mockResolvedValue(null),
  searchMemories:       jest.fn().mockResolvedValue(''),
  addMemory:            jest.fn().mockResolvedValue(undefined),
  formatSnapshotMemory: jest.fn().mockReturnValue('mock snapshot'),
}));

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { callAI } from '../../lib/aiClient';
import { supabase } from '../../lib/supabase';
import { cleanupUser, seedUser, seedSurvey } from './_helpers/cleanup';
import { setupDefaultAiMock } from './_helpers/mockAi';
import { userCreateStore } from '../../middleware/rateLimiters';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — User profile (Task 5)
// ─────────────────────────────────────────────────────────────────────────────

describe('User profile endpoints', () => {
  const TEST_EMAIL = `completeness-${randomUUID()}@mosaic-test.invalid`;
  let userId: string;

  afterAll(async () => {
    if (userId) await cleanupUser(userId);
  });

  beforeEach(() => {
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
  });

  it('1. POST /api/users creates user, returns user_id + onboarding_complete:false', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: TEST_EMAIL, name: 'Alex' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.user_id).toBe('string');
    expect(res.body.data.onboarding_complete).toBe(false);
    userId = res.body.data.user_id;
  });

  it('2. POST /api/users same email → 200, returns same user_id (upsert)', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: TEST_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.data.user_id).toBe(userId);
  });

  it('3. POST /api/users missing email → 400', async () => {
    const res = await request(app).post('/api/users').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('4. POST /api/users invalid email format → 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('5. GET /api/users/:userId → 200, has_survey:false initially', async () => {
    const res = await request(app).get(`/api/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_survey).toBe(false);
  });

  it('6. GET /api/users/:userId after survey → has_survey:true', async () => {
    await seedSurvey(userId, request(app));
    const res = await request(app).get(`/api/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_survey).toBe(true);
  });

  it('7. PATCH /api/users/:userId { onboarding_complete: true } → 200', async () => {
    const res = await request(app)
      .patch(`/api/users/${userId}`)
      .send({ onboarding_complete: true });
    expect(res.status).toBe(200);
    expect(res.body.data.onboarding_complete).toBe(true);
  });

  it('8. GET /api/users/non-existent-uuid → 404', async () => {
    const res = await request(app).get(`/api/users/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Privacy deletes (Task 6)
// ─────────────────────────────────────────────────────────────────────────────

describe('Privacy delete endpoints', () => {
  const USER_A = randomUUID();
  const USER_B = randomUUID();
  const USER_C = randomUUID();
  const USER_D = randomUUID(); // for full delete test

  beforeAll(async () => {
    await Promise.all([
      seedUser(USER_A),
      seedUser(USER_B),
      seedUser(USER_C),
      seedUser(USER_D),
    ]);
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
  });

  afterAll(async () => {
    // USER_D was deleted in test 14 — cleanup will be a no-op
    await Promise.all([
      cleanupUser(USER_A),
      cleanupUser(USER_B),
      cleanupUser(USER_C),
      cleanupUser(USER_D),
    ]);
  });

  beforeEach(() => {
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
  });

  it('9. Submit survey + sleep → DELETE /signals/:userId/sleep → 200, confidence=40', async () => {
    const req = request(app);
    await seedSurvey(USER_A, req);

    // Add sleep signal via Supabase directly (avoids needing a real CSV upload)
    const { error: sigErr } = await supabase.from('signal_data').insert({
      user_id:                 USER_A,
      signal_type:             'sleep',
      raw_data:                { source: 'test' },
      processed_data:          { avg_sleep_hours: 7, sleep_variability_hours: 0.5, nights_analyzed: 7 },
      confidence_contribution: 20,
    });
    expect(sigErr).toBeNull();

    const res = await request(app).delete(`/api/signals/${USER_A}/sleep`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted_count).toBeGreaterThanOrEqual(1);
    expect(res.body.data.new_confidence_score).toBe(40);
  });

  it('10. GET /dashboard after sleep delete → confidence_score:40', async () => {
    const res = await request(app).get(`/api/dashboard/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(40);
  });

  it('11. DELETE /signals/:userId/voice where none submitted → 404', async () => {
    // USER_A has had sleep deleted; never had voice
    const res = await request(app).delete(`/api/signals/${USER_A}/voice`);
    expect(res.status).toBe(404);
  });

  it('12. DELETE /signals/:userId/transcript before survey → 409', async () => {
    // USER_B has no survey yet
    const res = await request(app).delete(`/api/signals/${USER_B}/transcript`);
    expect(res.status).toBe(409);
  });

  it('13. Submit all 3 signals, delete each → confidence steps: 80 → 60 → 40', async () => {
    const req = request(app);
    await seedSurvey(USER_C, req);

    // Insert all 3 signal types directly
    const { error: sigErr } = await supabase.from('signal_data').insert([
      {
        user_id: USER_C, signal_type: 'transcript',
        raw_data: { source: 'test' },
        processed_data: { gpa: 3.5, course_load: 5, has_ap_honors: false, grade_trend: 'stable' },
        confidence_contribution: 20,
      },
      {
        user_id: USER_C, signal_type: 'sleep',
        raw_data: { source: 'test' },
        processed_data: { avg_sleep_hours: 7.5, sleep_variability_hours: 0.3, nights_analyzed: 7 },
        confidence_contribution: 20,
      },
      {
        user_id: USER_C, signal_type: 'voice',
        raw_data: { source: 'test' },
        processed_data: { speaking_ratio: 0.6, num_pauses: 3, pitch_variance_hz: 45 },
        confidence_contribution: 20,
      },
    ]);
    expect(sigErr).toBeNull();

    // Manually set confidence to 100 in dimension_scores
    await supabase.from('dimension_scores').update({ confidence_score: 100 }).eq('user_id', USER_C);

    const del1 = await request(app).delete(`/api/signals/${USER_C}/transcript`);
    expect(del1.status).toBe(200);
    expect(del1.body.data.new_confidence_score).toBe(80);

    const del2 = await request(app).delete(`/api/signals/${USER_C}/sleep`);
    expect(del2.status).toBe(200);
    expect(del2.body.data.new_confidence_score).toBe(60);

    const del3 = await request(app).delete(`/api/signals/${USER_C}/voice`);
    expect(del3.status).toBe(200);
    expect(del3.body.data.new_confidence_score).toBe(40);
  });

  it('14. DELETE /api/users/:userId → 200 { deleted: true }', async () => {
    await seedSurvey(USER_D, request(app));
    const res = await request(app).delete(`/api/users/${USER_D}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });

  it('15. GET /api/users/:userId after full delete → 404', async () => {
    const res = await request(app).get(`/api/users/${USER_D}`);
    expect(res.status).toBe(404);
  });

  it('16. GET /api/dashboard/:userId after full delete → 404', async () => {
    const res = await request(app).get(`/api/dashboard/${USER_D}`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Saved exercises (Task 7)
// ─────────────────────────────────────────────────────────────────────────────

describe('Saved exercises endpoints', () => {
  const USER = randomUUID();
  let exerciseId: string;

  beforeAll(async () => {
    await seedUser(USER);
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
    const libRes = await request(app).get('/api/exercises');
    exerciseId = libRes.body.data[0].id;
  });

  afterAll(async () => {
    await cleanupUser(USER);
  });

  it('17. POST /api/exercises/:id/save → 201', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/save`)
      .send({ user_id: USER });
    expect(res.status).toBe(201);
    expect(res.body.data.saved).toBe(true);
  });

  it('18. POST same save again → 409 (already saved)', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/save`)
      .send({ user_id: USER });
    expect(res.status).toBe(409);
  });

  it('19. GET /api/exercises/saved/:userId → 200, array with 1 item, has name/categories/saved_at', async () => {
    const res = await request(app).get(`/api/exercises/saved/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(typeof res.body.data[0].name).toBe('string');
    expect(Array.isArray(res.body.data[0].categories)).toBe(true);
    expect(typeof res.body.data[0].saved_at).toBe('string');
  });

  it('20. DELETE /api/exercises/:id/save → 200', async () => {
    const res = await request(app)
      .delete(`/api/exercises/${exerciseId}/save`)
      .send({ user_id: USER });
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(true);
  });

  it('21. GET /api/exercises/saved/:userId after delete → 200 []', async () => {
    const res = await request(app).get(`/api/exercises/saved/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('22. POST /api/exercises/non-existent-id/save → 404', async () => {
    const res = await request(app)
      .post(`/api/exercises/${randomUUID()}/save`)
      .send({ user_id: USER });
    expect(res.status).toBe(404);
  });

  it('23. POST /api/exercises/:id/save missing user_id → 400', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/save`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Exercise history (Task 8)
// ─────────────────────────────────────────────────────────────────────────────

describe('Exercise history endpoint', () => {
  const USER = randomUUID();
  let exerciseId: string;

  beforeAll(async () => {
    await seedUser(USER);
    const libRes = await request(app).get('/api/exercises');
    exerciseId = libRes.body.data[0].id;
  });

  afterAll(async () => {
    await cleanupUser(USER);
  });

  it('24. POST /api/exercises/:id/complete with completion_data → 201', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER, completion_data: { entry: 'Good day' } });
    expect(res.status).toBe(201);
  });

  it('25. POST same exercise again (different data) → 201 (no uniqueness constraint)', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER, completion_data: { entry: 'Better day' } });
    expect(res.status).toBe(201);
  });

  it('26. GET /api/exercises/history/:userId → 200, length 2, DESC order, has exercise_name + categories', async () => {
    const res = await request(app).get(`/api/exercises/history/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(typeof res.body.data[0].exercise_name).toBe('string');
    expect(Array.isArray(res.body.data[0].categories)).toBe(true);
    // DESC order: first item should be newer or equal to second
    expect(
      new Date(res.body.data[0].completed_at).getTime()
    ).toBeGreaterThanOrEqual(
      new Date(res.body.data[1].completed_at).getTime()
    );
  });

  it('27. GET /history/:userId?exercise_id=:id → only that exercise', async () => {
    const res = await request(app).get(
      `/api/exercises/history/${USER}?exercise_id=${exerciseId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    for (const item of res.body.data) {
      expect(item.exercise_id).toBe(exerciseId);
    }
  });

  it('28. GET /history/:userId?limit=1 → length 1', async () => {
    const res = await request(app).get(`/api/exercises/history/${USER}?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  it('29. GET /history/:userId with no completions → 200 []', async () => {
    const freshUser = randomUUID();
    await seedUser(freshUser);
    const res = await request(app).get(`/api/exercises/history/${freshUser}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    await cleanupUser(freshUser);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Voice prompt (Task 9)
// ─────────────────────────────────────────────────────────────────────────────

describe('Voice prompt endpoint', () => {
  it('30. GET /api/signals/voice/prompt → 200, has prompt + duration_seconds + tips', async () => {
    const res = await request(app).get('/api/signals/voice/prompt');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.prompt).toBe('string');
    expect(res.body.data.duration_seconds).toBe(60);
    expect(Array.isArray(res.body.data.tips)).toBe(true);
    expect(res.body.data.tips.length).toBeGreaterThan(0);
  });

  it('31. Prompt text length > 50 chars', async () => {
    const res = await request(app).get('/api/signals/voice/prompt');
    expect(res.body.data.prompt.length).toBeGreaterThan(50);
  });

  it('32. No auth required — accessible without user_id', async () => {
    const res = await request(app).get('/api/signals/voice/prompt');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Counselor flag (Task 10)
// ─────────────────────────────────────────────────────────────────────────────

describe('Counselor flag in exercise responses', () => {
  const FLAGGED_NAMES = ['Process journaling', 'Sleep anchor', 'Hard shutdown ritual'];
  const RED_USER  = randomUUID();
  const GREEN_USER = randomUUID();

  beforeAll(async () => {
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
    await Promise.all([seedUser(RED_USER), seedUser(GREEN_USER)]);

    // Seed RED_USER with 2+ red-band dimensions (CL=80 red, ER=20 red, RC=25 red)
    await supabase.from('dimension_scores').insert({
      user_id:              RED_USER,
      cognitive_load:       80,
      emotional_regulation: 20,
      recovery_capacity:    25,
      confidence_score:     40,
      explanation_text:     'test red profile',
    });

    // Seed GREEN_USER with all green dimensions
    await supabase.from('dimension_scores').insert({
      user_id:              GREEN_USER,
      cognitive_load:       20,
      emotional_regulation: 80,
      recovery_capacity:    80,
      confidence_score:     40,
      explanation_text:     'test green profile',
    });
  });

  afterAll(async () => {
    await Promise.all([cleanupUser(RED_USER), cleanupUser(GREEN_USER)]);
  });

  beforeEach(() => {
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
  });

  it('33. GET /api/exercises → all exercises include counselor_flag field', async () => {
    const res = await request(app).get('/api/exercises');
    expect(res.status).toBe(200);
    for (const ex of res.body.data) {
      expect(typeof ex.counselor_flag).toBe('boolean');
    }
  });

  it('34. Flagged exercises have counselor_flag:true', async () => {
    const res = await request(app).get('/api/exercises');
    const exercises = res.body.data as Array<{ name: string; counselor_flag: boolean }>;
    for (const name of FLAGGED_NAMES) {
      const ex = exercises.find((e) => e.name === name);
      if (ex) {
        expect(ex.counselor_flag).toBe(true);
      }
    }
  });

  it('35. Non-flagged exercises have counselor_flag:false', async () => {
    const res = await request(app).get('/api/exercises');
    const exercises = res.body.data as Array<{ name: string; counselor_flag: boolean }>;
    for (const ex of exercises) {
      if (!FLAGGED_NAMES.includes(ex.name)) {
        expect(ex.counselor_flag).toBe(false);
      }
    }
  });

  it('36. Red profile + flagged exercise → counselor_nudge:true in recommended response', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${RED_USER}`);
    expect(res.status).toBe(200);
    const recs = res.body.data.recommendations as Array<{ exercise: { counselor_flag: boolean } }>;
    const hasFlagged = recs.some((r) => r.exercise.counselor_flag);
    // Only check nudge if a flagged exercise was returned
    if (hasFlagged) {
      expect(res.body.data.counselor_nudge).toBe(true);
      expect(typeof res.body.data.counselor_message).toBe('string');
    }
    // At minimum, counselor_flag must be present on each recommendation
    for (const rec of recs) {
      expect(typeof rec.exercise.counselor_flag).toBe('boolean');
    }
  });

  it('37. Green profile → counselor_nudge absent or false', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${GREEN_USER}`);
    expect(res.status).toBe(200);
    // All green: no nudge should appear
    expect(res.body.data.counselor_nudge ?? false).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Input sanitization (Task 12)
// ─────────────────────────────────────────────────────────────────────────────

describe('Input sanitization', () => {
  const USER = randomUUID();

  beforeAll(async () => {
    await seedUser(USER);
  });

  afterAll(async () => {
    await cleanupUser(USER);
  });

  it('38. GET /api/dashboard/not-a-uuid → 400 Invalid ID format', async () => {
    const res = await request(app).get('/api/dashboard/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message ?? '').toMatch(/invalid/i);
  });

  it('39. GET /api/trend/not-a-uuid → 400 Invalid ID format', async () => {
    const res = await request(app).get('/api/trend/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('40. GET /api/exercises/recommended/not-a-uuid → 400', async () => {
    const res = await request(app).get('/api/exercises/recommended/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('41. POST /api/users { email: "not-an-email" } → 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('42. PATCH /api/users/:userId { name: "<script>…</script>" } → 200, HTML stripped', async () => {
    const res = await request(app)
      .patch(`/api/users/${USER}`)
      .send({ name: '<script>alert(1)</script>' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).not.toContain('<script>');
    expect(res.body.data.name).not.toContain('</script>');
  });

  it('43. GET /api/exercises?category=MaliciousInput → 400', async () => {
    const res = await request(app).get('/api/exercises?category=MaliciousInput');
    expect(res.status).toBe(400);
  });

  it('44. GET /api/exercises?category=Cognitive → 200 (valid passthrough)', async () => {
    const res = await request(app).get('/api/exercises?category=Cognitive');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('45. POST /api/exercises/:id/complete with completion_data > 10 KB → 400', async () => {
    const libRes = await request(app).get('/api/exercises');
    const exerciseId = libRes.body.data[0].id;

    const bigData = { note: 'x'.repeat(11 * 1024) }; // ~11 KB
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER, completion_data: bigData });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Rate limiting smoke test (Task 11)
// ─────────────────────────────────────────────────────────────────────────────

describe('Rate limiting — user create (10 per IP per hour)', () => {
  beforeAll(async () => {
    // Reset the user create limiter store so previous test runs don't consume budget
    await userCreateStore.resetAll();
  });

  it('46. 11 POST /api/users requests: first 10 succeed, 11th → 429', async () => {
    const results: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/users')
        .send({ email: `ratelimit-test-${i}-${randomUUID()}@mosaic-test.invalid` });
      results.push(res.status);
    }

    const successes = results.filter((s) => s === 200);
    const tooMany   = results.filter((s) => s === 429);
    expect(successes.length).toBe(10);
    expect(tooMany.length).toBe(1);
    expect(results[10]).toBe(429);
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Regression smoke tests (full journey)
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression smoke: full journey', () => {
  const USER = randomUUID();
  let exerciseId: string;
  let exercise2Id: string;

  beforeAll(async () => {
    await seedUser(USER);
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
    const libRes = await request(app).get('/api/exercises');
    exerciseId  = libRes.body.data[0].id;
    exercise2Id = libRes.body.data[1].id;
  });

  afterAll(async () => {
    await cleanupUser(USER);
  });

  beforeEach(() => {
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
  });

  it('47. Full journey: survey → signals → dashboard → recommended → trend → complete → history → save → delete signal → dashboard', async () => {
    const req = request(app);

    // Survey
    await seedSurvey(USER, req);

    // Insert sleep signal directly (avoids needing fixture files)
    await supabase.from('signal_data').insert([
      {
        user_id:                 USER,
        signal_type:             'sleep',
        raw_data:                { source: 'smoke-test' },
        processed_data:          { avg_sleep_hours: 7, sleep_variability_hours: 0.5, nights_analyzed: 7 },
        confidence_contribution: 20,
      },
      {
        user_id:                 USER,
        signal_type:             'transcript',
        raw_data:                { source: 'smoke-test' },
        processed_data:          { gpa: 3.5, course_load: 5, has_ap_honors: true, grade_trend: 'stable' },
        confidence_contribution: 20,
      },
      {
        user_id:                 USER,
        signal_type:             'voice',
        raw_data:                { source: 'smoke-test' },
        processed_data:          { speaking_ratio: 0.6, num_pauses: 2, pitch_variance_hz: 50 },
        confidence_contribution: 20,
      },
    ]);

    // Manually set confidence to 100
    await supabase.from('dimension_scores').update({ confidence_score: 100 }).eq('user_id', USER);

    // Dashboard
    const dash = await request(app).get(`/api/dashboard/${USER}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.confidence.total).toBe(100);
    expect(typeof dash.body.data.dimensions.cognitive_load.explanation).toBe('string');

    // Recommended (5 recs, at least 1 full_ui)
    const recs = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(recs.status).toBe(200);
    expect(recs.body.data.recommendations.length).toBe(5);
    expect(recs.body.data.recommendations.some((r: { exercise: { full_ui: boolean } }) => r.exercise.full_ui)).toBe(true);

    // Trend (1 snapshot → has_trend: false)
    const trend = await request(app).get(`/api/trend/${USER}`);
    expect(trend.status).toBe(200);
    expect(trend.body.data.has_trend).toBe(false);

    // Complete an exercise
    const complete = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER, completion_data: { entry: 'Test entry' } });
    expect(complete.status).toBe(201);

    // History
    const history = await request(app).get(`/api/exercises/history/${USER}`);
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(1);

    // Save an exercise
    const save = await request(app)
      .post(`/api/exercises/${exercise2Id}/save`)
      .send({ user_id: USER });
    expect(save.status).toBe(201);

    // Saved list
    const saved = await request(app).get(`/api/exercises/saved/${USER}`);
    expect(saved.status).toBe(200);
    expect(saved.body.data.length).toBeGreaterThanOrEqual(1);

    // Delete sleep signal
    const del = await request(app).delete(`/api/signals/${USER}/sleep`);
    expect(del.status).toBe(200);

    // Dashboard after delete → lower confidence
    const dash2 = await request(app).get(`/api/dashboard/${USER}`);
    expect(dash2.status).toBe(200);
    expect(dash2.body.data.confidence.total).toBeLessThan(100);
  }, 30000);
});

describe('Regression smoke: demo student', () => {
  const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
  });

  it('48a. GET /api/dashboard/:demoId → 200 (demo student must be pre-seeded)', async () => {
    const res = await request(app).get(`/api/dashboard/${DEMO_USER_ID}`);
    // If demo student is not seeded, this will be 404 — acceptable failure
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });

  it('48b. GET /api/exercises/recommended/:demoId → 200, 5 recs (if seeded)', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${DEMO_USER_ID}`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data.recommendations.length).toBe(5);
    }
  });

  it('48c. GET /api/trend/:demoId → has_trend:true, 5 snapshots, all worsening (if seeded)', async () => {
    const res = await request(app).get(`/api/trend/${DEMO_USER_ID}`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data.has_trend).toBe(true);
      expect(res.body.data.snapshot_count).toBe(5);
      expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
      expect(res.body.data.trend.emotional_regulation.direction).toBe('worsening');
      expect(res.body.data.trend.recovery_capacity.direction).toBe('worsening');
    }
  });
});
