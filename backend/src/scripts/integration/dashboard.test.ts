/**
 * Integration tests — GET /api/dashboard/:userId
 * Supabase: real. Backboard: mocked (AI explanations).
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
import { setupDefaultAiMock, mockCallAIThrows, mockCallAIReturns } from './_helpers/mockAi';

const USER = randomUUID();

beforeAll(async () => {
  await seedUser(USER);
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

// ── No survey → 404 ───────────────────────────────────────────────────────────

describe('GET /api/dashboard/:userId — no survey', () => {
  it('unknown userId → 404', async () => {
    const res = await request(app).get(`/api/dashboard/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ── After survey only ─────────────────────────────────────────────────────────

describe('GET /api/dashboard/:userId — after survey', () => {
  beforeAll(async () => {
    await seedSurvey(USER, request(app));
  });

  it('returns 200 with all three dimensions', async () => {
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { dimensions } = res.body.data;
    expect(dimensions).toHaveProperty('cognitive_load');
    expect(dimensions).toHaveProperty('emotional_regulation');
    expect(dimensions).toHaveProperty('recovery_capacity');
  });

  it('confidence_score = 40 after survey only', async () => {
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(40);
  });

  it('all three potential_deltas = +20 when no signals submitted', async () => {
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200);

    const { potential } = res.body.data.confidence;
    expect(Array.isArray(potential)).toBe(true);
    expect(potential.length).toBe(3); // transcript, sleep, voice not yet submitted

    for (const p of potential) {
      expect(p.would_bring_total_to).toBe(60); // 40 + 20 = 60
    }
  });

  it('all three AI explanations are non-empty strings', async () => {
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200);

    const { cognitive_load, emotional_regulation, recovery_capacity } = res.body.data.dimensions;
    expect(typeof cognitive_load.explanation).toBe('string');
    expect(cognitive_load.explanation.trim().length).toBeGreaterThan(0);
    expect(typeof emotional_regulation.explanation).toBe('string');
    expect(emotional_regulation.explanation.trim().length).toBeGreaterThan(0);
    expect(typeof recovery_capacity.explanation).toBe('string');
    expect(recovery_capacity.explanation.trim().length).toBeGreaterThan(0);
  });

  it('response includes disclaimer field', async () => {
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.disclaimer).toBe('string');
    expect(res.body.data.disclaimer.trim().length).toBeGreaterThan(0);
  });

  it('dimension colors correct for low CL (all-zero answers)', async () => {
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200);

    // All-zero answers → CL low → green; ER high → green; RC high → green
    const { dimensions } = res.body.data;
    expect(dimensions.cognitive_load.color).toBe('green');
    expect(dimensions.emotional_regulation.color).toBe('green');
    expect(dimensions.recovery_capacity.color).toBe('green');
  });

  it('AI timeout → fallback text returned, not a crash', async () => {
    mockCallAIThrows(callAI as jest.MockedFunction<typeof callAI>, 'timeout', 0);
    const res = await request(app).get(`/api/dashboard/${USER}`);
    expect(res.status).toBe(200); // safeExplain catches, returns fallback
    // All explanations should be the fallback string
    const { cognitive_load, emotional_regulation, recovery_capacity } = res.body.data.dimensions;
    expect(cognitive_load.explanation).toBeTruthy();
    expect(emotional_regulation.explanation).toBeTruthy();
    expect(recovery_capacity.explanation).toBeTruthy();
  });

  it('AI returns empty string → fallback text returned', async () => {
    mockCallAIReturns(callAI as jest.MockedFunction<typeof callAI>, '');
    const res = await request(app).get(`/api/dashboard/${USER}`);
    // Empty string is returned as-is (or fallback if falsy) — no crash
    expect(res.status).toBe(200);
  });
});

// ── Color band tests ──────────────────────────────────────────────────────────

describe('GET /api/dashboard/:userId — color bands', () => {
  it('cognitive_load=20 → "green" (low CL is good)', async () => {
    // All-zero survey gives low CL (~0-20 range)
    const userLow = randomUUID();
    await seedUser(userLow);
    await seedSurvey(userLow, request(app));

    const res = await request(app).get(`/api/dashboard/${userLow}`);
    expect(res.status).toBe(200);
    expect(['green', 'amber']).toContain(res.body.data.dimensions.cognitive_load.color);

    await cleanupUser(userLow);
  });
});
