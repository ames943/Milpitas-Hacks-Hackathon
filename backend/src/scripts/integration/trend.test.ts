/**
 * Integration tests — GET /api/trend/:userId
 * Supabase: real (seeds dimension_scores directly). No AI calls.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { supabase } from '../../lib/supabase';
import { cleanupUser, seedUser } from './_helpers/cleanup';

const USER = randomUUID();
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Insert a dimension_scores row with explicit created_at for deterministic ordering. */
async function insertSnapshot(
  userId: string,
  cl: number,
  er: number,
  rc: number,
  createdAt: string,
  confidence = 40,
): Promise<void> {
  const { error } = await supabase.from('dimension_scores').insert({
    user_id:              userId,
    cognitive_load:       cl,
    emotional_regulation: er,
    recovery_capacity:    rc,
    confidence_score:     confidence,
    explanation_text:     `Test snapshot cl=${cl} er=${er} rc=${rc}`,
    created_at:           createdAt,
  });
  if (error) throw error;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  await seedUser(USER);
});

afterAll(async () => {
  await cleanupUser(USER);
});

// ── No data ───────────────────────────────────────────────────────────────────

describe('GET /api/trend/:userId — no data', () => {
  it('unknown userId → 404', async () => {
    const res = await request(app).get(`/api/trend/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('user exists but 0 dimension_scores → 404', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.status).toBe(404);
  });
});

// ── 1 snapshot ────────────────────────────────────────────────────────────────

describe('GET /api/trend/:userId — 1 snapshot', () => {
  beforeAll(async () => {
    await insertSnapshot(USER, 55, 60, 65, daysAgo(7));
  });

  it('has_trend: false, trend: null, snapshot_count: 1', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.has_trend).toBe(false);
    expect(res.body.data.trend).toBeNull();
    expect(res.body.data.snapshot_count).toBe(1);
    expect(res.body.data.snapshots.length).toBe(1);
  });
});

// ── 2 snapshots — trend calculations ─────────────────────────────────────────

describe('GET /api/trend/:userId — 2 snapshots', () => {
  beforeAll(async () => {
    // Add second snapshot: CL rises (worsening), ER drops (worsening), RC drops (worsening)
    await insertSnapshot(USER, 76, 29, 36, daysAgo(1));
  });

  it('has_trend: true, snapshot_count: 2', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_trend).toBe(true);
    expect(res.body.data.snapshot_count).toBe(2);
  });

  it('CL went 55→76 → direction: worsening', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
    expect(res.body.data.trend.cognitive_load.delta).toBe(21);
  });

  it('ER went 60→29 → direction: worsening', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.body.data.trend.emotional_regulation.direction).toBe('worsening');
    expect(res.body.data.trend.emotional_regulation.delta).toBe(-31);
  });

  it('RC went 65→36 → direction: worsening', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.body.data.trend.recovery_capacity.direction).toBe('worsening');
    expect(res.body.data.trend.recovery_capacity.delta).toBe(-29);
  });

  it('latest field matches most recent snapshot', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.body.data.latest.cognitive_load).toBe(76);
    expect(res.body.data.latest.emotional_regulation).toBe(29);
    expect(res.body.data.latest.recovery_capacity).toBe(36);
  });
});

// ── 5 snapshots (add 3 more) ──────────────────────────────────────────────────

describe('GET /api/trend/:userId — 5 snapshots', () => {
  beforeAll(async () => {
    await insertSnapshot(USER, 58, 54, 60, daysAgo(6));
    await insertSnapshot(USER, 64, 47, 52, daysAgo(5));
    await insertSnapshot(USER, 70, 38, 44, daysAgo(3));
  });

  it('snapshot_count: 5, snapshots array length 5', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.snapshot_count).toBe(5);
    expect(res.body.data.snapshots.length).toBe(5);
  });

  it('snapshots are ASC ordered (oldest first)', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    const snaps = res.body.data.snapshots;
    for (let i = 1; i < snaps.length; i++) {
      expect(new Date(snaps[i].created_at).getTime())
        .toBeGreaterThan(new Date(snaps[i - 1].created_at).getTime());
    }
  });

  it('trend calculated from last 2 snapshots only (v4→v5: 70→76 CL = worsening)', async () => {
    const res = await request(app).get(`/api/trend/${USER}`);
    expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
    expect(res.body.data.trend.cognitive_load.delta).toBe(6);
  });
});

// ── Improving scenario ────────────────────────────────────────────────────────

describe('GET /api/trend/:userId — improving scenario', () => {
  const IMPROVE_USER = randomUUID();

  beforeAll(async () => {
    await seedUser(IMPROVE_USER);
    await insertSnapshot(IMPROVE_USER, 76, 29, 36, daysAgo(14));
    await insertSnapshot(IMPROVE_USER, 55, 60, 65, daysAgo(7));
  });

  afterAll(async () => {
    await cleanupUser(IMPROVE_USER);
  });

  it('CL goes 76→55 → "improving"', async () => {
    const res = await request(app).get(`/api/trend/${IMPROVE_USER}`);
    expect(res.body.data.trend.cognitive_load.direction).toBe('improving');
  });

  it('ER goes 29→60 → "improving"', async () => {
    const res = await request(app).get(`/api/trend/${IMPROVE_USER}`);
    expect(res.body.data.trend.emotional_regulation.direction).toBe('improving');
  });

  it('RC goes 36→65 → "improving"', async () => {
    const res = await request(app).get(`/api/trend/${IMPROVE_USER}`);
    expect(res.body.data.trend.recovery_capacity.direction).toBe('improving');
  });
});

// ── Stable scenario ───────────────────────────────────────────────────────────

describe('GET /api/trend/:userId — stable scenario (delta < 5)', () => {
  const STABLE_USER = randomUUID();

  beforeAll(async () => {
    await seedUser(STABLE_USER);
    await insertSnapshot(STABLE_USER, 50, 50, 50, daysAgo(14));
    await insertSnapshot(STABLE_USER, 53, 53, 53, daysAgo(7)); // delta = 3 — stable
  });

  afterAll(async () => {
    await cleanupUser(STABLE_USER);
  });

  it('delta = +3 → all dimensions "stable"', async () => {
    const res = await request(app).get(`/api/trend/${STABLE_USER}`);
    expect(res.body.data.trend.cognitive_load.direction).toBe('stable');
    expect(res.body.data.trend.emotional_regulation.direction).toBe('stable');
    expect(res.body.data.trend.recovery_capacity.direction).toBe('stable');
  });
});

// ── Boundary tests ────────────────────────────────────────────────────────────

describe('GET /api/trend/:userId — threshold boundaries', () => {
  const BOUNDARY_USER = randomUUID();

  beforeAll(async () => {
    await seedUser(BOUNDARY_USER);
    // delta = exactly +5 for CL (worsening), -5 for ER (worsening), +5 for RC (improving)
    await insertSnapshot(BOUNDARY_USER, 50, 55, 45, daysAgo(14));
    await insertSnapshot(BOUNDARY_USER, 55, 50, 50, daysAgo(7));
  });

  afterAll(async () => {
    await cleanupUser(BOUNDARY_USER);
  });

  it('CL delta = +5 → worsening (threshold inclusive)', async () => {
    const res = await request(app).get(`/api/trend/${BOUNDARY_USER}`);
    expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
    expect(res.body.data.trend.cognitive_load.delta).toBe(5);
  });

  it('ER delta = -5 → worsening (threshold inclusive)', async () => {
    const res = await request(app).get(`/api/trend/${BOUNDARY_USER}`);
    expect(res.body.data.trend.emotional_regulation.direction).toBe('worsening');
    expect(res.body.data.trend.emotional_regulation.delta).toBe(-5);
  });

  it('RC delta = +5 → improving (threshold inclusive)', async () => {
    const res = await request(app).get(`/api/trend/${BOUNDARY_USER}`);
    expect(res.body.data.trend.recovery_capacity.direction).toBe('improving');
    expect(res.body.data.trend.recovery_capacity.delta).toBe(5);
  });
});

// ── Demo student ──────────────────────────────────────────────────────────────

describe('GET /api/trend — demo student (seed must have run)', () => {
  it('demo student returns has_trend: true, snapshot_count: 5', async () => {
    const res = await request(app).get(`/api/trend/${DEMO_USER_ID}`);
    if (res.status === 404) {
      console.warn('Demo student not seeded. Run `npm run seed:demo` before this test.');
      return;
    }
    expect(res.status).toBe(200);
    expect(res.body.data.has_trend).toBe(true);
    expect(res.body.data.snapshot_count).toBeGreaterThanOrEqual(5);
  });

  it('demo student trend: CL worsening, ER worsening, RC worsening', async () => {
    const res = await request(app).get(`/api/trend/${DEMO_USER_ID}`);
    if (res.status === 404) return; // seed not run

    expect(res.body.data.trend.cognitive_load.direction).toBe('worsening');
    expect(res.body.data.trend.emotional_regulation.direction).toBe('worsening');
    expect(res.body.data.trend.recovery_capacity.direction).toBe('worsening');
  });

  it('demo student latest snapshot: CL=76, ER=29, RC=36', async () => {
    const res = await request(app).get(`/api/trend/${DEMO_USER_ID}`);
    if (res.status === 404) return;

    const { latest } = res.body.data;
    expect(Number(latest.cognitive_load)).toBe(76);
    expect(Number(latest.emotional_regulation)).toBe(29);
    expect(Number(latest.recovery_capacity)).toBe(36);
  });
});
