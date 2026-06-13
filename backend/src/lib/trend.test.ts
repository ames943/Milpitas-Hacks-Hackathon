/**
 * Unit tests for calculateTrend() — pure function, no network/DB.
 * Run: ts-node --transpile-only src/lib/trend.test.ts
 *
 * Key rules:
 *   cognitive_load      — lower is better: delta <= -5 → improving, delta >= 5 → worsening
 *   emotional_regulation — higher is better: delta >= 5 → improving, delta <= -5 → worsening
 *   recovery_capacity   — higher is better: same as emotional_regulation
 *   |delta| < 5        → stable for all dimensions
 *
 *   Route note: when only 1 snapshot exists, the route returns has_trend: false
 *   without calling calculateTrend(). That is route-level logic tested in integration.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTrend } from './trendCalculation';

function snap(cl: number, er: number, rc: number) {
  return { cognitive_load: cl, emotional_regulation: er, recovery_capacity: rc };
}

// ── cognitive_load (inverted: lower = better) ─────────────────────────────────

describe('calculateTrend — cognitive_load (lower is better)', () => {
  it('delta = -10 → improving', () => {
    const r = calculateTrend(snap(60, 50, 50), snap(50, 50, 50));
    assert.equal(r.cognitive_load.direction, 'improving');
    assert.equal(r.cognitive_load.delta, -10);
  });

  it('delta = +10 → worsening', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(60, 50, 50));
    assert.equal(r.cognitive_load.direction, 'worsening');
    assert.equal(r.cognitive_load.delta, 10);
  });

  it('delta = +4 → stable (below threshold)', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(54, 50, 50));
    assert.equal(r.cognitive_load.direction, 'stable');
  });

  it('delta = -4 → stable (below threshold)', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(46, 50, 50));
    assert.equal(r.cognitive_load.direction, 'stable');
  });

  it('delta = -5 → improving (threshold inclusive)', () => {
    const r = calculateTrend(snap(55, 50, 50), snap(50, 50, 50));
    assert.equal(r.cognitive_load.direction, 'improving');
    assert.equal(r.cognitive_load.delta, -5);
  });

  it('delta = +5 → worsening (threshold inclusive)', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(55, 50, 50));
    assert.equal(r.cognitive_load.direction, 'worsening');
    assert.equal(r.cognitive_load.delta, 5);
  });
});

// ── emotional_regulation (higher = better) ────────────────────────────────────

describe('calculateTrend — emotional_regulation (higher is better)', () => {
  it('delta = +10 → improving', () => {
    const r = calculateTrend(snap(50, 40, 50), snap(50, 50, 50));
    assert.equal(r.emotional_regulation.direction, 'improving');
    assert.equal(r.emotional_regulation.delta, 10);
  });

  it('delta = -10 → worsening', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(50, 40, 50));
    assert.equal(r.emotional_regulation.direction, 'worsening');
    assert.equal(r.emotional_regulation.delta, -10);
  });

  it('delta = +4 → stable', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(50, 54, 50));
    assert.equal(r.emotional_regulation.direction, 'stable');
  });

  it('delta = +5 → improving (threshold inclusive)', () => {
    const r = calculateTrend(snap(50, 45, 50), snap(50, 50, 50));
    assert.equal(r.emotional_regulation.direction, 'improving');
  });

  it('delta = -5 → worsening (threshold inclusive)', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(50, 45, 50));
    assert.equal(r.emotional_regulation.direction, 'worsening');
  });
});

// ── recovery_capacity (higher = better) ──────────────────────────────────────

describe('calculateTrend — recovery_capacity (higher is better)', () => {
  it('delta = +10 → improving', () => {
    const r = calculateTrend(snap(50, 50, 40), snap(50, 50, 50));
    assert.equal(r.recovery_capacity.direction, 'improving');
    assert.equal(r.recovery_capacity.delta, 10);
  });

  it('delta = -10 → worsening', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(50, 50, 40));
    assert.equal(r.recovery_capacity.direction, 'worsening');
    assert.equal(r.recovery_capacity.delta, -10);
  });
});

// ── Full multi-dimension scenarios ────────────────────────────────────────────

describe('calculateTrend — full scenarios', () => {
  it('all dimensions improving', () => {
    // CL drops (good), ER rises, RC rises
    const r = calculateTrend(snap(70, 30, 30), snap(60, 40, 40));
    assert.equal(r.cognitive_load.direction,       'improving');
    assert.equal(r.emotional_regulation.direction, 'improving');
    assert.equal(r.recovery_capacity.direction,    'improving');
  });

  it('all dimensions worsening', () => {
    // CL rises (bad), ER drops, RC drops
    const r = calculateTrend(snap(50, 60, 60), snap(60, 50, 50));
    assert.equal(r.cognitive_load.direction,       'worsening');
    assert.equal(r.emotional_regulation.direction, 'worsening');
    assert.equal(r.recovery_capacity.direction,    'worsening');
  });

  it('all dimensions stable (delta = 0)', () => {
    const r = calculateTrend(snap(50, 50, 50), snap(50, 50, 50));
    assert.equal(r.cognitive_load.direction,       'stable');
    assert.equal(r.emotional_regulation.direction, 'stable');
    assert.equal(r.recovery_capacity.direction,    'stable');
  });

  it('mixed: CL worsening, ER improving, RC stable', () => {
    const r = calculateTrend(snap(50, 40, 50), snap(60, 50, 52));
    assert.equal(r.cognitive_load.direction,       'worsening');
    assert.equal(r.emotional_regulation.direction, 'improving');
    assert.equal(r.recovery_capacity.direction,    'stable');
  });

  it('inversion: same absolute delta (+10) → CL worsening, ER improving', () => {
    // Confirms the two direction rules diverge on equal positive delta
    const r = calculateTrend(snap(40, 40, 50), snap(50, 50, 50));
    assert.equal(r.cognitive_load.direction,       'worsening');
    assert.equal(r.emotional_regulation.direction, 'improving');
  });

  it('demo student trajectory: visit 4→5 shows all worsening', () => {
    // Mirrors the synthetic demo seed (Part 6 Task 3)
    const r = calculateTrend(
      snap(70, 38, 44),
      snap(76, 29, 36),
    );
    assert.equal(r.cognitive_load.direction,       'worsening');
    assert.equal(r.emotional_regulation.direction, 'worsening');
    assert.equal(r.recovery_capacity.direction,    'worsening');
    assert.equal(r.cognitive_load.delta,        6);
    assert.equal(r.emotional_regulation.delta, -9);
    assert.equal(r.recovery_capacity.delta,    -8);
  });
});
