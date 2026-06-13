/**
 * Integration tests — GET /api/exercises, GET /api/exercises/recommended/:userId,
 * POST /api/exercises/:id/complete
 * Supabase: real. Backboard: mocked (AI matching).
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

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { callAI } from '../../lib/aiClient';
import { cleanupUser, seedUser, seedSurvey } from './_helpers/cleanup';
import { setupDefaultAiMock, mockCallAIReturns } from './_helpers/mockAi';

const USER = randomUUID();

beforeAll(async () => {
  await seedUser(USER);
  await seedSurvey(USER, request(app));
});

afterAll(async () => {
  await cleanupUser(USER);
});

beforeEach(() => {
  setupDefaultAiMock(callAI as jest.MockedFunction<typeof callAI>);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── GET /api/exercises ────────────────────────────────────────────────────────

describe('GET /api/exercises', () => {
  it('returns array of 10 exercises', async () => {
    const res = await request(app).get('/api/exercises');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(10);
  });

  it('each exercise has id, name, description, categories (array), full_ui (bool)', async () => {
    const res = await request(app).get('/api/exercises');
    expect(res.status).toBe(200);

    for (const ex of res.body.data) {
      expect(typeof ex.id).toBe('string');
      expect(typeof ex.name).toBe('string');
      expect(Array.isArray(ex.categories)).toBe(true);
      expect(typeof ex.full_ui).toBe('boolean');
    }
  });

  it('?category=Cognitive → only exercises with "Cognitive" in categories', async () => {
    const res = await request(app).get('/api/exercises?category=Cognitive');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const ex of res.body.data) {
      expect(ex.categories).toContain('Cognitive');
    }
  });

  it('?category=Physical → only Physical exercises', async () => {
    const res = await request(app).get('/api/exercises?category=Physical');
    expect(res.status).toBe(200);
    for (const ex of res.body.data) {
      expect(ex.categories).toContain('Physical');
    }
  });

  it('?category=Social → returns Process Journaling (only Social exercise)', async () => {
    const res = await request(app).get('/api/exercises?category=Social');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const ex of res.body.data) {
      expect(ex.categories).toContain('Social');
    }
  });

  it('?category=NonExistent → 400 (category whitelist enforced)', async () => {
    const res = await request(app).get('/api/exercises?category=NonExistent');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ── GET /api/exercises/recommended/:userId ────────────────────────────────────

describe('GET /api/exercises/recommended/:userId', () => {
  it('no survey → 404', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it('returns exactly 5 recommendations', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations.length).toBe(5);
  });

  it('each rec has exercise (full row) and match_reason (non-empty string)', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(res.status).toBe(200);

    for (const rec of res.body.data.recommendations) {
      expect(typeof rec.exercise.id).toBe('string');
      expect(typeof rec.exercise.name).toBe('string');
      expect(Array.isArray(rec.exercise.categories)).toBe(true);
      expect(typeof rec.match_reason).toBe('string');
      expect(rec.match_reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('at least 1 recommendation has full_ui = true (full_ui guarantee)', async () => {
    const res = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(res.status).toBe(200);
    const hasFullUi = res.body.data.recommendations.some((r: { exercise: { full_ui: boolean } }) => r.exercise.full_ui);
    expect(hasFullUi).toBe(true);
  });

  it('all 5 returned IDs exist in the exercise library', async () => {
    const libraryRes = await request(app).get('/api/exercises');
    const libraryIds = new Set(libraryRes.body.data.map((e: { id: string }) => e.id));

    const recRes = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(recRes.status).toBe(200);

    for (const rec of recRes.body.data.recommendations) {
      expect(libraryIds.has(rec.exercise.id)).toBe(true);
    }
  });

  it('AI returns wrong count (mock returns 4) → 422', async () => {
    // Get real IDs to return valid-but-wrong-count output
    const libRes = await request(app).get('/api/exercises');
    const ids = libRes.body.data.slice(0, 4).map((e: { id: string }) => e.id);

    mockCallAIReturns(callAI as jest.MockedFunction<typeof callAI>, {
      recommendations: ids.map((id: string) => ({ exercise_id: id, match_reason: 'test' })),
    });

    const res = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('AI returns invalid exercise ID → 422', async () => {
    mockCallAIReturns(callAI as jest.MockedFunction<typeof callAI>, {
      recommendations: [
        { exercise_id: 'not-a-real-id-1', match_reason: 'test' },
        { exercise_id: 'not-a-real-id-2', match_reason: 'test' },
        { exercise_id: 'not-a-real-id-3', match_reason: 'test' },
        { exercise_id: 'not-a-real-id-4', match_reason: 'test' },
        { exercise_id: 'not-a-real-id-5', match_reason: 'test' },
      ],
    });

    const res = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(res.status).toBe(422);
  });

  it('AI returns empty match_reason → 422', async () => {
    const libRes = await request(app).get('/api/exercises');
    const ids = libRes.body.data.slice(0, 5).map((e: { id: string }) => e.id);

    mockCallAIReturns(callAI as jest.MockedFunction<typeof callAI>, {
      recommendations: ids.map((id: string) => ({ exercise_id: id, match_reason: '' })),
    });

    const res = await request(app).get(`/api/exercises/recommended/${USER}`);
    expect(res.status).toBe(422);
  });
});

// ── POST /api/exercises/:id/complete ─────────────────────────────────────────

describe('POST /api/exercises/:id/complete', () => {
  let exerciseId: string;

  beforeAll(async () => {
    // Get a real exercise ID from the library
    const libRes = await request(app).get('/api/exercises');
    exerciseId = libRes.body.data[0].id;
  });

  it('valid exercise_id + user_id → 201 with inserted row', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user_id).toBe(USER);
    expect(res.body.data.exercise_id).toBe(exerciseId);
  });

  it('missing user_id → 400', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('non-existent exercise_id → 404', async () => {
    const fakeId = randomUUID();
    const res = await request(app)
      .post(`/api/exercises/${fakeId}/complete`)
      .send({ user_id: USER });
    expect(res.status).toBe(404);
  });

  it('completion_data is optional — omitting it returns 201', async () => {
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER });
    expect(res.status).toBe(201);
  });

  it('completion_data is stored as-is (jsonb roundtrip)', async () => {
    const completionData = { duration_seconds: 300, notes: 'felt calm', rating: 4 };
    const res = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER, completion_data: completionData });

    expect(res.status).toBe(201);
    expect(res.body.data.completion_data).toEqual(completionData);
  });

  it('same user can complete same exercise multiple times (no uniqueness error)', async () => {
    const res1 = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER });
    const res2 = await request(app)
      .post(`/api/exercises/${exerciseId}/complete`)
      .send({ user_id: USER });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
  });
});
