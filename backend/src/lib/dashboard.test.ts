/**
 * Unit tests for dashboard helper functions.
 * Run: ts-node --transpile-only src/lib/dashboard.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionColor, buildConfidenceBreakdown } from './dashboardHelpers';

// ── dimensionColor ────────────────────────────────────────────────────────────

describe('dimensionColor — higherIsWorse: true (cognitive_load)', () => {
  it('score 0  → green  (lower bound)', () =>
    assert.equal(dimensionColor(0, true), 'green'));

  it('score 33 → green  (upper boundary)', () =>
    assert.equal(dimensionColor(33, true), 'green'));

  it('score 34 → amber  (lower boundary)', () =>
    assert.equal(dimensionColor(34, true), 'amber'));

  it('score 50 → amber  (midpoint)', () =>
    assert.equal(dimensionColor(50, true), 'amber'));

  it('score 66 → amber  (upper boundary)', () =>
    assert.equal(dimensionColor(66, true), 'amber'));

  it('score 67 → red    (lower boundary)', () =>
    assert.equal(dimensionColor(67, true), 'red'));

  it('score 100 → red   (upper bound)', () =>
    assert.equal(dimensionColor(100, true), 'red'));
});

describe('dimensionColor — higherIsWorse: false (emotional_regulation / recovery_capacity)', () => {
  it('score 100 → green (upper bound)', () =>
    assert.equal(dimensionColor(100, false), 'green'));

  it('score 67  → green (lower boundary)', () =>
    assert.equal(dimensionColor(67, false), 'green'));

  it('score 66  → amber (upper boundary)', () =>
    assert.equal(dimensionColor(66, false), 'amber'));

  it('score 50  → amber (midpoint)', () =>
    assert.equal(dimensionColor(50, false), 'amber'));

  it('score 34  → amber (lower boundary)', () =>
    assert.equal(dimensionColor(34, false), 'amber'));

  it('score 33  → red   (upper boundary)', () =>
    assert.equal(dimensionColor(33, false), 'red'));

  it('score 0   → red   (lower bound)', () =>
    assert.equal(dimensionColor(0, false), 'red'));
});

// ── buildConfidenceBreakdown ──────────────────────────────────────────────────

describe('buildConfidenceBreakdown — 0 optional signals submitted', () => {
  it('survey always in breakdown; transcript/sleep/voice in potential', () => {
    const { breakdown, potential } = buildConfidenceBreakdown([], 40);
    assert.equal(breakdown.length, 1);
    assert.equal(breakdown[0].source, 'survey');
    assert.equal(potential.length, 3);
    assert.deepEqual(
      potential.map((p) => p.source),
      ['transcript', 'sleep', 'voice'],
    );
  });

  it('would_bring_total_to = currentConfidence + contribution (40+20=60)', () => {
    const { potential } = buildConfidenceBreakdown([], 40);
    for (const p of potential) {
      assert.equal(p.would_bring_total_to, 40 + p.contribution);
    }
  });
});

describe('buildConfidenceBreakdown — 1 optional signal (transcript)', () => {
  it('breakdown has survey + transcript; potential has sleep + voice', () => {
    const { breakdown, potential } = buildConfidenceBreakdown(['transcript'], 60);
    assert.equal(breakdown.length, 2);
    assert.equal(breakdown[0].source, 'survey');
    assert.equal(breakdown[1].source, 'transcript');
    assert.equal(potential.length, 2);
    assert.deepEqual(potential.map((p) => p.source), ['sleep', 'voice']);
  });

  it('would_bring_total_to = 60 + 20 = 80', () => {
    const { potential } = buildConfidenceBreakdown(['transcript'], 60);
    for (const p of potential) assert.equal(p.would_bring_total_to, 80);
  });
});

describe('buildConfidenceBreakdown — 2 optional signals (transcript + sleep)', () => {
  it('breakdown has 3 entries; potential has voice only', () => {
    const { breakdown, potential } = buildConfidenceBreakdown(
      ['transcript', 'sleep'], 80,
    );
    assert.equal(breakdown.length, 3);
    assert.equal(potential.length, 1);
    assert.equal(potential[0].source, 'voice');
  });

  it('would_bring_total_to = min(80+20, 100) = 100', () => {
    const { potential } = buildConfidenceBreakdown(['transcript', 'sleep'], 80);
    assert.equal(potential[0].would_bring_total_to, 100);
  });
});

describe('buildConfidenceBreakdown — 3 optional signals (all submitted)', () => {
  it('breakdown has all 4 sources; potential is empty', () => {
    const { breakdown, potential } = buildConfidenceBreakdown(
      ['transcript', 'sleep', 'voice'], 100,
    );
    assert.equal(breakdown.length, 4);
    assert.equal(potential.length, 0);
  });
});

describe('buildConfidenceBreakdown — would_bring_total_to caps at 100', () => {
  it('currentConfidence=90, contribution=20 → capped at 100', () => {
    const { potential } = buildConfidenceBreakdown([], 90);
    // survey(40) + transcript(20) + sleep(20) + voice(20) would be 90+20=110, but cap 100
    for (const p of potential) assert.equal(p.would_bring_total_to, 100);
  });

  it('currentConfidence=100 → would_bring_total_to stays 100', () => {
    const { potential } = buildConfidenceBreakdown([], 100);
    for (const p of potential) assert.equal(p.would_bring_total_to, 100);
  });
});

describe('buildConfidenceBreakdown — order invariance of input', () => {
  it('signal types in any order produce the same breakdown', () => {
    const r1 = buildConfidenceBreakdown(['sleep', 'voice', 'transcript'], 100);
    const r2 = buildConfidenceBreakdown(['transcript', 'sleep', 'voice'], 100);
    assert.deepEqual(r1, r2);
  });
});

console.log('All dashboard unit tests passed.');
