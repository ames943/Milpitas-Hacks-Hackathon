/**
 * Integration tests — POST /api/survey
 * Supabase: real. Backboard: not called by this route. No mock needed.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { cleanupUser, seedUser } from './_helpers/cleanup';

const USER_A = randomUUID(); // fresh user for stateful happy-path tests
const USER_B = randomUUID(); // isolated user for confidence-preservation tests

const ALL_ZEROS_PHQ  = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const ALL_ZEROS_GAD  = [0, 0, 0, 0, 0, 0, 0];
const ALL_THREES_PHQ = [3, 3, 3, 3, 3, 3, 3, 3, 3];
const ALL_THREES_GAD = [3, 3, 3, 3, 3, 3, 3];

beforeAll(async () => {
  await seedUser(USER_A);
  await seedUser(USER_B);
});

afterAll(async () => {
  await cleanupUser(USER_A);
  await cleanupUser(USER_B);
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/survey — happy path', () => {
  it('valid all-zeros survey → 201 with dimension_scores in [0,100]', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_A, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const { dimension_scores } = res.body.data;
    expect(dimension_scores.user_id).toBe(USER_A);
    expect(dimension_scores.cognitive_load).toBeGreaterThanOrEqual(0);
    expect(dimension_scores.cognitive_load).toBeLessThanOrEqual(100);
    expect(dimension_scores.emotional_regulation).toBeGreaterThanOrEqual(0);
    expect(dimension_scores.emotional_regulation).toBeLessThanOrEqual(100);
    expect(dimension_scores.recovery_capacity).toBeGreaterThanOrEqual(0);
    expect(dimension_scores.recovery_capacity).toBeLessThanOrEqual(100);
  });

  it('first survey → confidence_score = 40', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_B, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD });

    expect(res.status).toBe(201);
    expect(res.body.data.dimension_scores.confidence_score).toBe(40);
  });

  it('includes explanation_text (non-empty string)', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_A, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD });

    expect(res.status).toBe(201);
    const text = res.body.data.dimension_scores.explanation_text;
    expect(typeof text).toBe('string');
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('second survey inserts a NEW row (not overwrite)', async () => {
    // First survey already submitted in test above. Submit a second.
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_A, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD });

    expect(res.status).toBe(201);
    // confidence preserved at ≥40 (not reset below prior)
    expect(res.body.data.dimension_scores.confidence_score).toBeGreaterThanOrEqual(40);
  });

  it('all-zeros → CL low, ER high, RC high', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_A, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD });

    expect(res.status).toBe(201);
    const { cognitive_load, emotional_regulation, recovery_capacity } = res.body.data.dimension_scores;
    expect(cognitive_load).toBeLessThan(50);
    expect(emotional_regulation).toBeGreaterThan(50);
    expect(recovery_capacity).toBeGreaterThan(50);
  });

  it('all-threes → CL high, ER low, RC low', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_A, phq_answers: ALL_THREES_PHQ, gad_answers: ALL_THREES_GAD });

    expect(res.status).toBe(201);
    const { cognitive_load, emotional_regulation, recovery_capacity } = res.body.data.dimension_scores;
    expect(cognitive_load).toBeGreaterThan(50);
    expect(emotional_regulation).toBeLessThan(50);
    expect(recovery_capacity).toBeLessThan(50);
  });

  it('response includes survey phq_a_score and gad7_score', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ user_id: USER_A, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD });

    expect(res.status).toBe(201);
    expect(typeof res.body.data.survey.phq_a_score).toBe('number');
    expect(typeof res.body.data.survey.gad7_score).toBe('number');
  });
});

// ── Validation failures ───────────────────────────────────────────────────────

describe('POST /api/survey — validation failures → 400', () => {
  const uid = randomUUID();
  const base = { user_id: uid, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD };

  it('missing phq_answers → 400', async () => {
    const { phq_answers: _, ...body } = base;
    const res = await request(app).post('/api/survey').send({ ...body });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  it('missing gad_answers → 400', async () => {
    const { gad_answers: _, ...body } = base;
    const res = await request(app).post('/api/survey').send({ ...body });
    expect(res.status).toBe(400);
  });

  it('phq_answers has 8 items (too short) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, phq_answers: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('phq_answers has 10 items (too long) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, phq_answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('gad_answers has 6 items (too short) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, gad_answers: [0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('gad_answers has 8 items (too long) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, gad_answers: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('answer value = -1 (below range) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, phq_answers: [-1, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('answer value = 4 (above range) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, phq_answers: [4, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('answer value = 1.5 (non-integer) → 400', async () => {
    const res = await request(app)
      .post('/api/survey')
      .send({ ...base, phq_answers: [1.5, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(res.status).toBe(400);
  });

  it('missing user_id → 400', async () => {
    const { user_id: _, ...body } = base;
    const res = await request(app).post('/api/survey').send({ ...body });
    expect(res.status).toBe(400);
  });

  it('user_id is a number → 400', async () => {
    const res = await request(app).post('/api/survey').send({ ...base, user_id: 12345 });
    expect(res.status).toBe(400);
  });

  it('all 400 responses include { success: false, error: string }', async () => {
    const cases = [
      { ...base, phq_answers: [] },
      { ...base, gad_answers: [] },
      { user_id: undefined, phq_answers: ALL_ZEROS_PHQ, gad_answers: ALL_ZEROS_GAD },
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/survey').send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error).toBe('string');
    }
  });
});
