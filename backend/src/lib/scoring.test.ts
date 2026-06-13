import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scorePHQA, scoreGAD7, calculateDimensions } from './scoring';

// ─── scorePHQA ────────────────────────────────────────────────────────────────

describe('scorePHQA', () => {
  it('returns 0 for all-zero answers', () => {
    assert.equal(scorePHQA([0, 0, 0, 0, 0, 0, 0, 0, 0]), 0);
  });

  it('returns 27 for all-max answers', () => {
    assert.equal(scorePHQA([3, 3, 3, 3, 3, 3, 3, 3, 3]), 27);
  });

  it('sums mixed answers correctly', () => {
    assert.equal(scorePHQA([2, 2, 3, 2, 1, 1, 2, 0, 0]), 13);
    assert.equal(scorePHQA([1, 0, 1, 0, 1, 0, 1, 0, 1]), 5);
  });

  it('throws for too few answers', () => {
    assert.throws(() => scorePHQA([]), /PHQ-A/);
    assert.throws(() => scorePHQA([1, 2, 3, 4, 5, 6, 7, 8]), /PHQ-A/);
  });

  it('throws for too many answers', () => {
    assert.throws(() => scorePHQA([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), /PHQ-A/);
  });

  it('throws for value > 3', () => {
    assert.throws(() => scorePHQA([0, 0, 0, 0, 0, 0, 0, 0, 4]), /PHQ-A\[8\]/);
    assert.throws(() => scorePHQA([4, 0, 0, 0, 0, 0, 0, 0, 0]), /PHQ-A\[0\]/);
  });

  it('throws for negative value', () => {
    assert.throws(() => scorePHQA([0, 0, 0, 0, 0, -1, 0, 0, 0]), /PHQ-A\[5\]/);
  });

  it('throws for non-integer value', () => {
    assert.throws(() => scorePHQA([1.5, 0, 0, 0, 0, 0, 0, 0, 0]), /PHQ-A\[0\]/);
    assert.throws(() => scorePHQA([0, 0, 0, 0, 0, 0, 0, 0, 2.9]), /PHQ-A\[8\]/);
  });

  it('throws for non-number values', () => {
    assert.throws(() => scorePHQA(['2', 0, 0, 0, 0, 0, 0, 0, 0] as unknown as number[]), /PHQ-A\[0\]/);
    assert.throws(() => scorePHQA([null, 0, 0, 0, 0, 0, 0, 0, 0] as unknown as number[]), /PHQ-A\[0\]/);
  });

  it('throws for non-array input', () => {
    assert.throws(() => scorePHQA(null as unknown as number[]), /PHQ-A/);
    assert.throws(() => scorePHQA(undefined as unknown as number[]), /PHQ-A/);
  });
});

// ─── scoreGAD7 ────────────────────────────────────────────────────────────────

describe('scoreGAD7', () => {
  it('returns 0 for all-zero answers', () => {
    assert.equal(scoreGAD7([0, 0, 0, 0, 0, 0, 0]), 0);
  });

  it('returns 21 for all-max answers', () => {
    assert.equal(scoreGAD7([3, 3, 3, 3, 3, 3, 3]), 21);
  });

  it('sums mixed answers correctly', () => {
    assert.equal(scoreGAD7([2, 2, 2, 1, 1, 1, 1]), 10);
    assert.equal(scoreGAD7([1, 0, 1, 0, 1, 0, 1]), 4);
  });

  it('throws for too few answers', () => {
    assert.throws(() => scoreGAD7([]), /GAD-7/);
    assert.throws(() => scoreGAD7([1, 2, 3, 4, 5, 6]), /GAD-7/);
  });

  it('throws for too many answers', () => {
    assert.throws(() => scoreGAD7([0, 0, 0, 0, 0, 0, 0, 0]), /GAD-7/);
  });

  it('throws for value > 3', () => {
    assert.throws(() => scoreGAD7([0, 0, 0, 0, 0, 0, 4]), /GAD-7\[6\]/);
    assert.throws(() => scoreGAD7([5, 0, 0, 0, 0, 0, 0]), /GAD-7\[0\]/);
  });

  it('throws for negative value', () => {
    assert.throws(() => scoreGAD7([0, -1, 0, 0, 0, 0, 0]), /GAD-7\[1\]/);
  });

  it('throws for non-integer value', () => {
    assert.throws(() => scoreGAD7([0, 0, 0, 0, 0, 0, 0.1]), /GAD-7\[6\]/);
  });

  it('throws for non-array input', () => {
    assert.throws(() => scoreGAD7(42 as unknown as number[]), /GAD-7/);
  });
});

// ─── calculateDimensions ─────────────────────────────────────────────────────

describe('calculateDimensions', () => {
  const zeros9 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const zeros7 = [0, 0, 0, 0, 0, 0, 0];
  const max9 = [3, 3, 3, 3, 3, 3, 3, 3, 3];
  const max7 = [3, 3, 3, 3, 3, 3, 3];

  it('returns 0/100/100 for no symptoms (all zeros)', () => {
    const d = calculateDimensions(zeros9, zeros7);
    assert.equal(d.cognitive_load, 0);
    assert.equal(d.emotional_regulation, 100);
    assert.equal(d.recovery_capacity, 100);
  });

  it('returns 100/0/0 for max symptoms (all threes)', () => {
    const d = calculateDimensions(max9, max7);
    assert.equal(d.cognitive_load, 100);
    assert.equal(d.emotional_regulation, 0);
    assert.equal(d.recovery_capacity, 0);
  });

  it('matches expected values for the canonical test-survey payload', () => {
    // phq[6]=2, gad[1]=2, gad[2]=2, gad[4]=1  → cogSum=7  → round(7/12*100) = 58
    // phq[0]=2, phq[1]=2, phq[5]=1, gad[5]=1  → emoSum=6  → round(100-6/12*100) = 50
    // phq[2]=3, phq[3]=2, gad[3]=1             → recSum=6  → round(100-6/9*100) = 33
    const d = calculateDimensions(
      [2, 2, 3, 2, 1, 1, 2, 0, 0],
      [2, 2, 2, 1, 1, 1, 1],
    );
    assert.equal(d.cognitive_load, 58);
    assert.equal(d.emotional_regulation, 50);
    assert.equal(d.recovery_capacity, 33);
  });

  it('cognitive_load is driven by PHQ-A[6] concentration', () => {
    // Only PHQ-A[6]=3; all else 0 → cogSum=3 → round(3/12*100)=25
    const d = calculateDimensions([0, 0, 0, 0, 0, 0, 3, 0, 0], zeros7);
    assert.equal(d.cognitive_load, 25);
    assert.equal(d.emotional_regulation, 100);
    assert.equal(d.recovery_capacity, 100);
  });

  it('cognitive_load is driven by GAD-7[1] uncontrollable worry', () => {
    const d = calculateDimensions(zeros9, [0, 3, 0, 0, 0, 0, 0]);
    assert.equal(d.cognitive_load, 25);
    assert.equal(d.emotional_regulation, 100);
    assert.equal(d.recovery_capacity, 100);
  });

  it('cognitive_load is driven by GAD-7[2] excessive worry', () => {
    const d = calculateDimensions(zeros9, [0, 0, 3, 0, 0, 0, 0]);
    assert.equal(d.cognitive_load, 25);
  });

  it('cognitive_load is driven by GAD-7[4] restlessness', () => {
    const d = calculateDimensions(zeros9, [0, 0, 0, 0, 3, 0, 0]);
    assert.equal(d.cognitive_load, 25);
  });

  it('emotional_regulation is driven by PHQ-A[0] anhedonia', () => {
    const d = calculateDimensions([3, 0, 0, 0, 0, 0, 0, 0, 0], zeros7);
    assert.equal(d.cognitive_load, 0);
    assert.equal(d.emotional_regulation, 75); // round(100 - 3/12*100) = 75
    assert.equal(d.recovery_capacity, 100);
  });

  it('emotional_regulation is driven by PHQ-A[1] depressed mood', () => {
    const d = calculateDimensions([0, 3, 0, 0, 0, 0, 0, 0, 0], zeros7);
    assert.equal(d.emotional_regulation, 75);
  });

  it('emotional_regulation is driven by PHQ-A[5] worthlessness', () => {
    const d = calculateDimensions([0, 0, 0, 0, 0, 3, 0, 0, 0], zeros7);
    assert.equal(d.emotional_regulation, 75);
  });

  it('emotional_regulation is driven by GAD-7[5] irritability', () => {
    const d = calculateDimensions(zeros9, [0, 0, 0, 0, 0, 3, 0]);
    assert.equal(d.emotional_regulation, 75);
  });

  it('recovery_capacity is driven by PHQ-A[2] sleep disturbance', () => {
    const d = calculateDimensions([0, 0, 3, 0, 0, 0, 0, 0, 0], zeros7);
    assert.equal(d.cognitive_load, 0);
    assert.equal(d.emotional_regulation, 100);
    assert.equal(d.recovery_capacity, 67); // round(100 - 3/9*100) = round(66.67) = 67
  });

  it('recovery_capacity is driven by PHQ-A[3] fatigue', () => {
    const d = calculateDimensions([0, 0, 0, 3, 0, 0, 0, 0, 0], zeros7);
    assert.equal(d.recovery_capacity, 67);
  });

  it('recovery_capacity is driven by GAD-7[3] trouble relaxing', () => {
    const d = calculateDimensions(zeros9, [0, 0, 0, 3, 0, 0, 0]);
    assert.equal(d.recovery_capacity, 67);
  });

  it('non-mapped items (appetite, psychomotor, suicidality, dread) do not affect any dimension', () => {
    // PHQ-A[4] appetite, PHQ-A[7] psychomotor, PHQ-A[8] suicidality
    // GAD-7[0] nervous, GAD-7[6] dread — none mapped
    const d = calculateDimensions(
      [0, 0, 0, 0, 3, 0, 0, 3, 3],
      [3, 0, 0, 0, 0, 0, 3],
    );
    assert.equal(d.cognitive_load, 0);
    assert.equal(d.emotional_regulation, 100);
    assert.equal(d.recovery_capacity, 100);
  });

  it('dimensions are independent — changing one set of items does not shift another dimension', () => {
    // Set all cognitive items to max, keep emotional and recovery at 0
    const d = calculateDimensions(
      [0, 0, 0, 0, 0, 0, 3, 0, 0], // only [6] concentration = 3
      [0, 3, 3, 0, 3, 0, 0],        // [1],[2],[4] all = 3
    );
    assert.equal(d.cognitive_load, 100);
    assert.equal(d.emotional_regulation, 100);
    assert.equal(d.recovery_capacity, 100);
  });

  it('all outputs are integers in [0, 100]', () => {
    // Run a sweep of corner cases
    const cases: [number[], number[]][] = [
      [[1, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]],
      [[0, 0, 1, 0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 0, 0, 0]],
      [[2, 2, 2, 2, 2, 2, 2, 2, 2], [1, 1, 1, 1, 1, 1, 1]],
    ];
    for (const [phq, gad] of cases) {
      const d = calculateDimensions(phq, gad);
      for (const [key, val] of Object.entries(d)) {
        assert.ok(Number.isInteger(val), `${key} should be an integer, got ${val}`);
        assert.ok(val >= 0 && val <= 100, `${key} should be in [0,100], got ${val}`);
      }
    }
  });

  it('throws for PHQ-A wrong length', () => {
    assert.throws(() => calculateDimensions([0, 0, 0, 0, 0, 0, 0, 0], zeros7), /PHQ-A/);
    assert.throws(() => calculateDimensions([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], zeros7), /PHQ-A/);
  });

  it('throws for GAD-7 wrong length', () => {
    assert.throws(() => calculateDimensions(zeros9, [0, 0, 0, 0, 0, 0]), /GAD-7/);
    assert.throws(() => calculateDimensions(zeros9, [0, 0, 0, 0, 0, 0, 0, 0]), /GAD-7/);
  });

  it('throws for out-of-range PHQ-A values', () => {
    assert.throws(() => calculateDimensions([0, 0, 0, 0, 0, 0, 4, 0, 0], zeros7), /PHQ-A\[6\]/);
    assert.throws(() => calculateDimensions([0, 0, -1, 0, 0, 0, 0, 0, 0], zeros7), /PHQ-A\[2\]/);
  });

  it('throws for out-of-range GAD-7 values', () => {
    assert.throws(() => calculateDimensions(zeros9, [0, 4, 0, 0, 0, 0, 0]), /GAD-7\[1\]/);
  });
});
