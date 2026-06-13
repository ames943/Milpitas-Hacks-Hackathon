/**
 * End-to-end user journey tests.
 * JOURNEY A — Full signal collection
 * JOURNEY B — Survey-only dropout user
 * JOURNEY C — Demo student validation
 *
 * Supabase: real. Backboard: mocked.
 * Each journey uses a fresh UUID. Cleanup runs after all journeys.
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
import { callAI, extractTranscriptData } from '../../lib/aiClient';
import { cleanupUser, seedUser } from './_helpers/cleanup';
import { setupDefaultAiMock } from './_helpers/mockAi';
import { generateSineWav, createTestPDF, APPLE_HEALTH_CSV } from './_helpers/fixtures';

const USER_A = randomUUID(); // Journey A — full signal collection
const USER_B = randomUUID(); // Journey B — survey only
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

const req = () => request(app);

beforeAll(async () => {
  await seedUser(USER_A);
  await seedUser(USER_B);
});

afterAll(async () => {
  await cleanupUser(USER_A);
  await cleanupUser(USER_B);
  // Demo student (DEMO_USER_ID) is NOT cleaned up — kept for live demos.
});

beforeEach(() => {
  setupDefaultAiMock(
    callAI as jest.MockedFunction<typeof callAI>,
    extractTranscriptData as jest.MockedFunction<typeof extractTranscriptData>,
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY A — First-time user, full signal collection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey A — full signal collection', () => {
  let firstExerciseId: string;

  it('A1: GET /health → 200', async () => {
    const res = await req().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.supabase).toBe('connected');
  });

  it('A2: POST /api/survey (all zeros) → 201, confidence=40', async () => {
    const res = await req()
      .post('/api/survey')
      .send({
        user_id:     USER_A,
        phq_answers: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        gad_answers: [0, 0, 0, 0, 0, 0, 0],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.dimension_scores.confidence_score).toBe(40);
    // All dimensions in range
    const { cognitive_load, emotional_regulation, recovery_capacity } = res.body.data.dimension_scores;
    expect(cognitive_load).toBeGreaterThanOrEqual(0);
    expect(emotional_regulation).toBeLessThanOrEqual(100);
    expect(recovery_capacity).toBeLessThanOrEqual(100);
  });

  it('A3: GET /api/dashboard → 200, confidence=40, 3 potential_deltas each +20 headroom', async () => {
    const res = await req().get(`/api/dashboard/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(40);
    expect(res.body.data.confidence.potential.length).toBe(3);
    for (const p of res.body.data.confidence.potential) {
      expect(p.would_bring_total_to).toBe(60);
    }
  });

  it('A4: GET /api/exercises/recommended → 200, 5 recs, at least 1 full_ui', async () => {
    const res = await req().get(`/api/exercises/recommended/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations.length).toBe(5);
    const hasFullUi = res.body.data.recommendations.some((r: { exercise: { full_ui: boolean } }) => r.exercise.full_ui);
    expect(hasFullUi).toBe(true);

    firstExerciseId = res.body.data.recommendations[0].exercise.id;
  });

  it('A5: GET /api/trend → has_trend: false (only 1 snapshot)', async () => {
    const res = await req().get(`/api/trend/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_trend).toBe(false);
  });

  it('A6: POST /api/signals/transcript → 200, confidence=60', async () => {
    const PDF = createTestPDF();
    const res = await req()
      .post('/api/signals/transcript')
      .field('user_id', USER_A)
      .attach('file', PDF, { filename: 'transcript.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.dimension_scores.confidence_score).toBe(60);
  });

  it('A7: GET /api/dashboard → confidence=60, transcript potential_delta is 0', async () => {
    const res = await req().get(`/api/dashboard/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(60);

    // transcript should be in breakdown, not in potential
    const submittedTypes = (res.body.data.confidence.breakdown as Array<{ source: string }>)
      .map(b => b.source);
    expect(submittedTypes).toContain('transcript');

    const pendingTypes = (res.body.data.confidence.potential as Array<{ source: string }>)
      .map(p => p.source);
    expect(pendingTypes).not.toContain('transcript');
  });

  it('A8: POST /api/signals/sleep → 201, confidence=80', async () => {
    const CSV = Buffer.from(APPLE_HEALTH_CSV);
    const res = await req()
      .post('/api/signals/sleep')
      .field('user_id', USER_A)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.data.dimension_scores.confidence_score).toBe(80);
  });

  it('A9: POST /api/signals/voice → 201, confidence=100', async () => {
    const WAV = generateSineWav(220, 6);
    const res = await req()
      .post('/api/signals/voice')
      .field('user_id', USER_A)
      .attach('file', WAV, { filename: 'voice.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(201);
    expect(res.body.data.dimension_scores.confidence_score).toBe(100);
  });

  it('A10: GET /api/dashboard → confidence=100, all potential_deltas gone', async () => {
    const res = await req().get(`/api/dashboard/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(100);
    expect(res.body.data.confidence.potential.length).toBe(0);
  });

  it('A11: POST /api/exercises/:id/complete → 201', async () => {
    // firstExerciseId is set in A4 — tests run sequentially
    const res = await req()
      .post(`/api/exercises/${firstExerciseId}/complete`)
      .send({ user_id: USER_A, completion_data: { duration_seconds: 180 } });
    expect(res.status).toBe(201);
  });

  it('A12: Second survey (all 3s) → 201, new snapshot, confidence stays 100', async () => {
    const res = await req()
      .post('/api/survey')
      .send({
        user_id:     USER_A,
        phq_answers: [3, 3, 3, 3, 3, 3, 3, 3, 3],
        gad_answers: [3, 3, 3, 3, 3, 3, 3],
      });

    expect(res.status).toBe(201);
    // Confidence must not drop below prior level (100)
    expect(res.body.data.dimension_scores.confidence_score).toBe(100);
  });

  it('A13: GET /api/trend → has_trend: true, snapshot_count ≥ 2', async () => {
    const res = await req().get(`/api/trend/${USER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_trend).toBe(true);
    expect(res.body.data.snapshot_count).toBeGreaterThanOrEqual(2);
  });

  it('A14: Trend from all-zero → all-three survey: CL worsening', async () => {
    const res = await req().get(`/api/trend/${USER_A}`);
    // CL goes from low (all-zero) to high (all-three) = worsening
    expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY B — Survey-only dropout user
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey B — survey-only user (never adds signals)', () => {
  it('B1: POST /api/survey → 201', async () => {
    const res = await req()
      .post('/api/survey')
      .send({
        user_id:     USER_B,
        phq_answers: [1, 1, 1, 1, 1, 1, 1, 1, 1],
        gad_answers: [1, 1, 1, 1, 1, 1, 1],
      });
    expect(res.status).toBe(201);
  });

  it('B2: GET /api/dashboard → confidence=40, all 3 potential_deltas=+20', async () => {
    const res = await req().get(`/api/dashboard/${USER_B}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(40);
    expect(res.body.data.confidence.potential.length).toBe(3);
  });

  it('B3: GET /api/exercises/recommended → 200 (works with survey-only data)', async () => {
    const res = await req().get(`/api/exercises/recommended/${USER_B}`);
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations.length).toBe(5);
  });

  it('B4: GET /api/trend → has_trend: false (only 1 snapshot)', async () => {
    const res = await req().get(`/api/trend/${USER_B}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_trend).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY C — Demo student validation (requires seed:demo to have run)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey C — demo student validation', () => {
  it('C1: GET /api/dashboard demo student → 200', async () => {
    const res = await req().get(`/api/dashboard/${DEMO_USER_ID}`);
    if (res.status === 404) {
      console.warn('[Journey C] Demo student not seeded — run `npm run seed:demo` first.');
      return;
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('C2: GET /api/exercises/recommended demo student → 200, 5 recs', async () => {
    const res = await req().get(`/api/exercises/recommended/${DEMO_USER_ID}`);
    if (res.status === 404) return;
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations.length).toBe(5);
  });

  it('C3: GET /api/trend demo student → has_trend: true, 5 snapshots', async () => {
    const res = await req().get(`/api/trend/${DEMO_USER_ID}`);
    if (res.status === 404) return;
    expect(res.status).toBe(200);
    expect(res.body.data.has_trend).toBe(true);
    expect(res.body.data.snapshot_count).toBeGreaterThanOrEqual(5);
  });

  it('C4: Demo trend: CL worsening, ER worsening, RC worsening', async () => {
    const res = await req().get(`/api/trend/${DEMO_USER_ID}`);
    if (res.status === 404) return;
    expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
    expect(res.body.data.trend.emotional_regulation.direction).toBe('worsening');
    expect(res.body.data.trend.recovery_capacity.direction).toBe('worsening');
  });

  it('C5: Demo latest snapshot: CL=76, ER=29, RC=36', async () => {
    const res = await req().get(`/api/trend/${DEMO_USER_ID}`);
    if (res.status === 404) return;
    const { latest } = res.body.data;
    expect(Number(latest.cognitive_load)).toBe(76);
    expect(Number(latest.emotional_regulation)).toBe(29);
    expect(Number(latest.recovery_capacity)).toBe(36);
  });
});
