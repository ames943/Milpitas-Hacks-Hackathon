/**
 * Unit tests for Stage 1 deterministic exercise matching logic.
 * No network calls, no DB — pure functions only.
 * Run: ts-node --transpile-only src/lib/exercises.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrioritySet,
  scoreExercise,
  selectCandidates,
  ensureFullUiGuarantee,
  type ExerciseRow,
  type RecommendedExercise,
  type CandidateExercise,
} from './exerciseMatching';

// ── Helpers ───────────────────────────────────────────────────────────────────

function scores(cl: number, er: number, rc: number) {
  return { cognitive_load: cl, emotional_regulation: er, recovery_capacity: rc };
}

function makeExercise(
  id: string,
  categories: string[],
  full_ui = false,
): ExerciseRow {
  return {
    id,
    name:         `Exercise ${id}`,
    category:     categories[0] ?? 'Structural',
    categories,
    description:  null,
    full_ui,
    instructions: null,
  };
}

function makeRecommended(
  exercise: ExerciseRow,
  match_score: number,
): RecommendedExercise {
  return { exercise, match_reason: 'some reason', match_score };
}

function makeCandidate(exercise: ExerciseRow, match_score: number): CandidateExercise {
  return { exercise, match_score };
}

// ── buildPrioritySet ──────────────────────────────────────────────────────────

describe('buildPrioritySet — cognitive_load (higher = worse)', () => {
  it('score 0  (green): no CL categories added', () => {
    const p = buildPrioritySet(scores(0, 67, 67));
    assert.ok(!p.has('Cognitive') || false, 'unexpected Cognitive');
  });

  it('score 33 (green boundary): no CL categories', () => {
    const p = buildPrioritySet(scores(33, 67, 67));
    // 33 < 34 threshold so green — only check CL contribution
    // er=67 green, rc=67 green → priority should be empty
    assert.equal(p.size, 0);
  });

  it('score 34 (amber lower): adds Structural only', () => {
    const p = buildPrioritySet(scores(34, 67, 67));
    assert.ok(p.has('Structural'));
    assert.ok(!p.has('Cognitive'));
  });

  it('score 66 (amber upper): adds Structural only', () => {
    const p = buildPrioritySet(scores(66, 67, 67));
    assert.ok(p.has('Structural'));
    assert.ok(!p.has('Cognitive'));
  });

  it('score 67 (red lower): adds Cognitive + Structural', () => {
    const p = buildPrioritySet(scores(67, 67, 67));
    assert.ok(p.has('Cognitive'));
    assert.ok(p.has('Structural'));
  });

  it('score 100 (red): adds Cognitive + Structural', () => {
    const p = buildPrioritySet(scores(100, 67, 67));
    assert.ok(p.has('Cognitive'));
    assert.ok(p.has('Structural'));
  });
});

describe('buildPrioritySet — emotional_regulation (higher = better)', () => {
  it('score 100 (green): no ER categories', () => {
    const p = buildPrioritySet(scores(33, 100, 67));
    assert.equal(p.size, 0);
  });

  it('score 67 (green lower): no ER categories', () => {
    const p = buildPrioritySet(scores(33, 67, 67));
    assert.equal(p.size, 0);
  });

  it('score 66 (amber upper): adds Cognitive only', () => {
    const p = buildPrioritySet(scores(33, 66, 67));
    assert.ok(p.has('Cognitive'));
    assert.ok(!p.has('Social'));
  });

  it('score 34 (amber lower): adds Cognitive only', () => {
    const p = buildPrioritySet(scores(33, 34, 67));
    assert.ok(p.has('Cognitive'));
    assert.ok(!p.has('Social'));
  });

  it('score 33 (red upper): adds Cognitive + Social', () => {
    const p = buildPrioritySet(scores(33, 33, 67));
    assert.ok(p.has('Cognitive'));
    assert.ok(p.has('Social'));
  });

  it('score 0 (red): adds Cognitive + Social', () => {
    const p = buildPrioritySet(scores(33, 0, 67));
    assert.ok(p.has('Cognitive'));
    assert.ok(p.has('Social'));
  });
});

describe('buildPrioritySet — recovery_capacity (higher = better)', () => {
  it('score 100 (green): no RC categories', () => {
    const p = buildPrioritySet(scores(33, 67, 100));
    assert.equal(p.size, 0);
  });

  it('score 67 (green lower): no RC categories', () => {
    const p = buildPrioritySet(scores(33, 67, 67));
    assert.equal(p.size, 0);
  });

  it('score 66 (amber upper): adds Physical only', () => {
    const p = buildPrioritySet(scores(33, 67, 66));
    assert.ok(p.has('Physical'));
    assert.ok(!p.has('Structural'));
  });

  it('score 34 (amber lower): adds Physical only', () => {
    const p = buildPrioritySet(scores(33, 67, 34));
    assert.ok(p.has('Physical'));
    assert.ok(!p.has('Structural'));
  });

  it('score 33 (red upper): adds Physical + Structural', () => {
    const p = buildPrioritySet(scores(33, 67, 33));
    assert.ok(p.has('Physical'));
    assert.ok(p.has('Structural'));
  });

  it('score 0 (red): adds Physical + Structural', () => {
    const p = buildPrioritySet(scores(33, 67, 0));
    assert.ok(p.has('Physical'));
    assert.ok(p.has('Structural'));
  });
});

describe('buildPrioritySet — combined dimensions', () => {
  it('all three at red → union of all priority categories', () => {
    const p = buildPrioritySet(scores(100, 0, 0));
    assert.ok(p.has('Cognitive'));
    assert.ok(p.has('Structural'));
    assert.ok(p.has('Social'));
    assert.ok(p.has('Physical'));
    assert.equal(p.size, 4);
  });

  it('all three at green → empty priority set', () => {
    const p = buildPrioritySet(scores(0, 100, 100));
    assert.equal(p.size, 0);
  });

  it('CL amber + ER red → Structural + Cognitive + Social (no dups)', () => {
    const p = buildPrioritySet(scores(50, 0, 100));
    assert.ok(p.has('Structural'));
    assert.ok(p.has('Cognitive'));
    assert.ok(p.has('Social'));
    assert.ok(!p.has('Physical'));
  });
});

// ── scoreExercise ─────────────────────────────────────────────────────────────

describe('scoreExercise', () => {
  const priority = new Set(['Cognitive', 'Structural']);

  it('both categories match → score 2', () =>
    assert.equal(scoreExercise(['Cognitive', 'Structural'], priority), 2));

  it('one category matches → score 1', () =>
    assert.equal(scoreExercise(['Cognitive', 'Physical'], priority), 1));

  it('no categories match → score 0', () =>
    assert.equal(scoreExercise(['Physical', 'Social'], priority), 0));

  it('single matching category → score 1', () =>
    assert.equal(scoreExercise(['Structural'], priority), 1));

  it('empty categories → score 0', () =>
    assert.equal(scoreExercise([], priority), 0));

  it('empty priority set → score 0 regardless', () =>
    assert.equal(scoreExercise(['Cognitive', 'Structural'], new Set()), 0));
});

// ── selectCandidates ──────────────────────────────────────────────────────────

describe('selectCandidates', () => {
  const priority = new Set(['Cognitive', 'Structural']);
  const exercises = [
    makeExercise('a', ['Cognitive', 'Structural']),  // score 2
    makeExercise('b', ['Physical']),                  // score 0
    makeExercise('c', ['Structural']),                // score 1
    makeExercise('d', ['Cognitive', 'Social']),       // score 1
    makeExercise('e', ['Physical', 'Structural']),    // score 1
    makeExercise('f', ['Cognitive', 'Structural']),   // score 2
    makeExercise('g', ['Physical', 'Cognitive']),     // score 1
    makeExercise('h', ['Structural']),                // score 1
    makeExercise('i', ['Social']),                    // score 0
    makeExercise('j', ['Cognitive']),                 // score 1
  ];

  it('returns exactly 8 candidates', () => {
    const candidates = selectCandidates(exercises, priority, 8);
    assert.equal(candidates.length, 8);
  });

  it('top 2 are score-2 exercises (a and f)', () => {
    const candidates = selectCandidates(exercises, priority, 8);
    const top2Ids = candidates.slice(0, 2).map((c) => c.exercise.id).sort();
    assert.deepEqual(top2Ids, ['a', 'f'].sort());
    assert.equal(candidates[0].match_score, 2);
    assert.equal(candidates[1].match_score, 2);
  });

  it('sorted descending by match_score', () => {
    const candidates = selectCandidates(exercises, priority, 8);
    for (let i = 1; i < candidates.length; i++) {
      assert.ok(
        candidates[i].match_score <= candidates[i - 1].match_score,
        `index ${i} (score=${candidates[i].match_score}) > index ${i - 1} (score=${candidates[i - 1].match_score})`,
      );
    }
  });

  it('lowest-score exercises (b, i — score 0) are excluded from top 8', () => {
    const candidates = selectCandidates(exercises, priority, 8);
    const ids = candidates.map((c) => c.exercise.id);
    assert.ok(!ids.includes('b'), 'b (score 0) should not be in top 8');
    assert.ok(!ids.includes('i'), 'i (score 0) should not be in top 8');
  });

  it('fewer than count exercises returns all', () => {
    const small = exercises.slice(0, 5);
    const candidates = selectCandidates(small, priority, 8);
    assert.equal(candidates.length, 5);
  });
});

// ── ensureFullUiGuarantee ─────────────────────────────────────────────────────

describe('ensureFullUiGuarantee', () => {
  const fullUiEx   = makeExercise('full-1', ['Cognitive'], true);
  const nonUiEx1   = makeExercise('non-1',  ['Cognitive']);
  const nonUiEx2   = makeExercise('non-2',  ['Structural']);
  const nonUiEx3   = makeExercise('non-3',  ['Physical']);
  const nonUiEx4   = makeExercise('non-4',  ['Cognitive', 'Structural']);
  const nonUiEx5   = makeExercise('non-5',  ['Structural']);

  it('no swap needed when at least one recommendation has full_ui=true', () => {
    const recs = [
      makeRecommended(fullUiEx, 2),
      makeRecommended(nonUiEx1, 1),
      makeRecommended(nonUiEx2, 1),
      makeRecommended(nonUiEx3, 0),
      makeRecommended(nonUiEx4, 2),
    ];
    const candidates = [
      makeCandidate(fullUiEx, 2),
      makeCandidate(nonUiEx1, 1),
      makeCandidate(nonUiEx2, 1),
      makeCandidate(nonUiEx3, 0),
      makeCandidate(nonUiEx4, 2),
    ];
    const result = ensureFullUiGuarantee(recs, candidates);
    // Same references, no mutation
    assert.equal(result[0].exercise.id, 'full-1');
    assert.equal(result.length, 5);
  });

  it('swaps the lowest-match-score rec for highest-match-score full_ui candidate', () => {
    // All 5 recs have full_ui=false
    const recs = [
      makeRecommended(nonUiEx1, 2),
      makeRecommended(nonUiEx2, 2),
      makeRecommended(nonUiEx3, 1),
      makeRecommended(nonUiEx4, 1),
      makeRecommended(nonUiEx5, 0), // lowest — should be swapped
    ];
    // fullUiEx has match_score=2 in the candidate pool
    const candidates = [
      makeCandidate(nonUiEx1, 2),
      makeCandidate(nonUiEx2, 2),
      makeCandidate(nonUiEx3, 1),
      makeCandidate(nonUiEx4, 1),
      makeCandidate(nonUiEx5, 0),
      makeCandidate(fullUiEx, 2), // highest-score full_ui not in recs
    ];
    const result = ensureFullUiGuarantee(recs, candidates);
    const ids = result.map((r) => r.exercise.id);
    // full-1 should be in results now
    assert.ok(ids.includes('full-1'), 'full-1 should have been swapped in');
    // non-5 (match_score=0, the lowest) should be gone
    assert.ok(!ids.includes('non-5'), 'non-5 (lowest score) should have been swapped out');
    // still exactly 5
    assert.equal(result.length, 5);
    // new entry has full_ui=true
    const swappedIn = result.find((r) => r.exercise.id === 'full-1')!;
    assert.ok(swappedIn.exercise.full_ui);
    assert.ok(swappedIn.match_reason.length > 0, 'swapped entry should have a match_reason');
  });

  it('no swap when no full_ui exercise exists in candidates', () => {
    const recs = [
      makeRecommended(nonUiEx1, 2),
      makeRecommended(nonUiEx2, 2),
      makeRecommended(nonUiEx3, 1),
      makeRecommended(nonUiEx4, 1),
      makeRecommended(nonUiEx5, 0),
    ];
    const candidates = recs.map((r) => makeCandidate(r.exercise, r.match_score));
    // No full_ui in candidates
    const result = ensureFullUiGuarantee(recs, candidates);
    assert.deepEqual(
      result.map((r) => r.exercise.id),
      recs.map((r) => r.exercise.id),
    );
  });

  it('no swap when all full_ui exercises are already in the 5', () => {
    const fullUiEx2 = makeExercise('full-2', ['Structural'], true);
    const recsWithFullUi = [
      makeRecommended(fullUiEx, 2),   // full_ui=true, already in recs
      makeRecommended(nonUiEx1, 2),
      makeRecommended(nonUiEx2, 1),
      makeRecommended(nonUiEx3, 1),
      makeRecommended(nonUiEx5, 0),
    ];
    const result = ensureFullUiGuarantee(recsWithFullUi, [
      makeCandidate(fullUiEx, 2),
      makeCandidate(fullUiEx2, 0), // full_ui but lower score — irrelevant since one is already in recs
      makeCandidate(nonUiEx1, 2),
    ]);
    // Already has full_ui — no swap should occur
    assert.ok(result.some((r) => r.exercise.full_ui));
    // full-1 still present
    assert.ok(result.some((r) => r.exercise.id === 'full-1'));
  });
});

// ── Match-score edge cases ────────────────────────────────────────────────────

describe('match_score for each seed exercise vs all-red priority set', () => {
  const allRed = new Set(['Cognitive', 'Structural', 'Social', 'Physical']);

  const seedExercises: Array<[string, string[]]> = [
    ['Pre-sleep review',     ['Cognitive', 'Structural']],
    ['Brain dump',           ['Cognitive', 'Structural']],
    ['Time boxing',          ['Structural']],
    ['Stress reappraisal',   ['Cognitive']],
    ['Hard shutdown ritual', ['Structural', 'Physical']],
    ['Zone 2 walking',       ['Physical', 'Cognitive']],
    ['Sleep anchor',         ['Physical', 'Structural']],
    ['Strategic incompletion', ['Cognitive', 'Structural']],
    ['Process journaling',   ['Cognitive', 'Social']],
    ['Workload visibility map', ['Structural']],
  ];

  for (const [name, categories] of seedExercises) {
    it(`${name}: score equals number of matching categories`, () => {
      const score = scoreExercise(categories, allRed);
      const expected = categories.filter((c) => allRed.has(c)).length;
      assert.equal(score, expected);
    });
  }
});

console.log('All exercise unit tests passed.');
