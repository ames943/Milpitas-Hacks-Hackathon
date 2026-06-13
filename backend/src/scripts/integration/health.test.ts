/**
 * Integration tests — GET /health
 * Supabase: real. No AI calls. No test user needed.
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';

describe('GET /health', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('returns success: true and supabase: "connected"', async () => {
    const res = await request(app).get('/health');
    expect(res.body.success).toBe(true);
    expect(res.body.supabase).toBe('connected');
  });

  it('returns exercise_count = 10 (seeded library intact)', async () => {
    const res = await request(app).get('/health');
    expect(typeof res.body.exercise_count).toBe('number');
    expect(res.body.exercise_count).toBe(10);
  });

  it('responds in under 3000ms', async () => {
    const start = Date.now();
    await request(app).get('/health');
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
