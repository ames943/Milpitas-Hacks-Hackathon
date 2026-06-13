/**
 * Route tests for POST /api/survey.
 *
 * Supabase is NOT mocked — the before() hook sets placeholder env vars so
 * createClient() succeeds without real credentials.  Validation-error paths
 * (400) are exercised without ever reaching Supabase.  The happy-path test
 * expects a 500 (network error against the placeholder URL) when no real DB is
 * configured, or a 201 when a live Supabase is configured via SUPABASE_URL /
 * SUPABASE_SERVICE_KEY env vars.
 *
 * Uses require() for app loading (not static import) so that env vars set in
 * before() are visible to supabase.ts at module-load time.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import type { Express } from 'express';

let agent: ReturnType<typeof supertest>;

const VALID_PAYLOAD = {
  user_id: '00000000-0000-0000-0000-000000000001',
  phq_answers: [2, 2, 3, 2, 1, 1, 2, 0, 0],
  gad_answers: [2, 2, 2, 1, 1, 1, 1],
};

describe('POST /api/survey', () => {
  before(() => {
    // Must happen before require('../app') so supabase.ts sees non-empty values.
    process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'placeholder-service-key';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = (require('../app') as { default: Express }).default;
    agent = supertest(app);
  });

  // ── missing / malformed user_id ────────────────────────────────────────────

  it('400 when body is empty', async () => {
    const res = await agent.post('/api/survey').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(typeof res.body.error === 'string', 'error should be a string');
  });

  it('400 when user_id is missing', async () => {
    const { user_id: _omit, ...rest } = VALID_PAYLOAD;
    const res = await agent.post('/api/survey').send(rest);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /user_id/);
  });

  it('400 when user_id is null', async () => {
    const res = await agent.post('/api/survey').send({ ...VALID_PAYLOAD, user_id: null });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /user_id/);
  });

  it('400 when user_id is empty string', async () => {
    const res = await agent.post('/api/survey').send({ ...VALID_PAYLOAD, user_id: '' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /user_id/);
  });

  it('400 when user_id is a number', async () => {
    const res = await agent.post('/api/survey').send({ ...VALID_PAYLOAD, user_id: 42 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /user_id/);
  });

  // ── malformed phq_answers ──────────────────────────────────────────────────

  it('400 when phq_answers is missing', async () => {
    const { phq_answers: _omit, ...rest } = VALID_PAYLOAD;
    const res = await agent.post('/api/survey').send(rest);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /phq_answers/);
  });

  it('400 when phq_answers is not an array', async () => {
    const res = await agent.post('/api/survey').send({ ...VALID_PAYLOAD, phq_answers: 'bad' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /phq_answers/);
  });

  it('400 when phq_answers has 8 items (too short)', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      phq_answers: [0, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /phq_answers/);
  });

  it('400 when phq_answers has 10 items (too long)', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      phq_answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /phq_answers/);
  });

  it('400 when a phq_answers item is 4 (out of range)', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      phq_answers: [0, 0, 0, 0, 0, 0, 0, 0, 4],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('400 when a phq_answers item is -1 (out of range)', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      phq_answers: [-1, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
  });

  it('400 when a phq_answers item is a float', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      phq_answers: [1.5, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
  });

  it('400 when a phq_answers item is a string', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      phq_answers: ['2', 0, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
  });

  // ── malformed gad_answers ──────────────────────────────────────────────────

  it('400 when gad_answers is missing', async () => {
    const { gad_answers: _omit, ...rest } = VALID_PAYLOAD;
    const res = await agent.post('/api/survey').send(rest);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /gad_answers/);
  });

  it('400 when gad_answers is not an array', async () => {
    const res = await agent.post('/api/survey').send({ ...VALID_PAYLOAD, gad_answers: 99 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /gad_answers/);
  });

  it('400 when gad_answers has 6 items (too short)', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      gad_answers: [0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /gad_answers/);
  });

  it('400 when gad_answers has 8 items (too long)', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      gad_answers: [0, 0, 0, 0, 0, 0, 0, 0],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /gad_answers/);
  });

  it('400 when a gad_answers item is out of range', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      gad_answers: [0, 0, 0, 0, 0, 0, 5],
    });
    assert.equal(res.status, 400);
  });

  it('400 when a gad_answers item is a float', async () => {
    const res = await agent.post('/api/survey').send({
      ...VALID_PAYLOAD,
      gad_answers: [0, 0, 0, 0, 0, 0, 2.1],
    });
    assert.equal(res.status, 400);
  });

  // ── response shape ─────────────────────────────────────────────────────────

  it('400 responses always include { success: false, error: string }', async () => {
    const cases = [
      {},
      { user_id: 'x' },
      { user_id: 'x', phq_answers: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    ];
    for (const body of cases) {
      const res = await agent.post('/api/survey').send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.ok(typeof res.body.error === 'string', `expected string error for body ${JSON.stringify(body)}`);
    }
  });

  // ── happy-path shape (validates without real DB) ───────────────────────────

  it('valid payload passes validation and reaches Supabase layer', async () => {
    const res = await agent.post('/api/survey').send(VALID_PAYLOAD);
    // Without real Supabase: expect 500 (network error reaching placeholder URL).
    // With real Supabase configured: expect 201.
    const hasRealDb = (process.env.SUPABASE_URL ?? '').includes('supabase.co')
      && !process.env.SUPABASE_URL?.includes('placeholder');
    if (hasRealDb) {
      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.survey.phq_a_score === 13, 'phq_a_score should be 13');
      assert.ok(res.body.data.survey.gad7_score === 10, 'gad7_score should be 10');
      assert.equal(res.body.data.dimension_scores.cognitive_load, 58);
      assert.equal(res.body.data.dimension_scores.emotional_regulation, 50);
      assert.equal(res.body.data.dimension_scores.recovery_capacity, 33);
      assert.equal(res.body.data.dimension_scores.confidence_score, 40);
    } else {
      // Placeholder URL → fetch fails → error handler fires → 500
      assert.equal(res.status, 500);
      assert.equal(res.body.success, false);
    }
  });
});
