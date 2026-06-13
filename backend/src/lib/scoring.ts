/**
 * PHQ-A item indices (phqAnswers[0..8], each 0-3):
 *   [0] anhedonia          — little interest or pleasure in doing things
 *   [1] depressed_mood     — feeling down, depressed, or hopeless
 *   [2] sleep_disturbance  — trouble falling/staying asleep, or sleeping too much
 *   [3] fatigue            — feeling tired or having little energy
 *   [4] appetite           — poor appetite or overeating
 *   [5] worthlessness      — feeling bad about yourself / failure / guilt
 *   [6] concentration      — trouble concentrating on things
 *   [7] psychomotor        — moving/speaking slowly, or fidgety/restless
 *   [8] suicidality        — thoughts of being better off dead / self-harm
 *
 * GAD-7 item indices (gadAnswers[0..6], each 0-3):
 *   [0] nervous            — feeling nervous, anxious, or on edge
 *   [1] uncontrollable_worry — not being able to stop or control worrying
 *   [2] excessive_worry    — worrying too much about different things
 *   [3] relaxation         — trouble relaxing
 *   [4] restlessness       — so restless that it is hard to sit still
 *   [5] irritability       — becoming easily annoyed or irritable
 *   [6] dread              — feeling afraid as if something awful might happen
 *
 * Dimension mapping (SURVEY-ONLY baseline — extended by signals in later parts):
 *
 *   cognitive_load (0 = none, 100 = maximum — lower is better):
 *     PHQ-A[6] concentration + GAD-7[1] uncontrollable_worry +
 *     GAD-7[2] excessive_worry + GAD-7[4] restlessness
 *     max = 12  →  (sum / 12) * 100
 *     TODO (signals): add transcript word-retrieval difficulty, voice speech-rate deviation
 *
 *   emotional_regulation (0 = poor, 100 = excellent — higher is better):
 *     inverted PHQ-A[0] anhedonia + PHQ-A[1] depressed_mood +
 *     PHQ-A[5] worthlessness + GAD-7[5] irritability
 *     max = 12  →  100 - (sum / 12) * 100
 *     TODO (signals): add transcript sentiment/rumination ratio, voice affect features
 *
 *   recovery_capacity (0 = depleted, 100 = full — higher is better):
 *     inverted PHQ-A[2] sleep_disturbance + PHQ-A[3] fatigue + GAD-7[3] relaxation
 *     max = 9   →  100 - (sum / 9) * 100
 *     TODO (signals): add wearable sleep duration/efficiency, HRV, resting heart rate
 */

export interface DimensionScores {
  cognitive_load: number;
  emotional_regulation: number;
  recovery_capacity: number;
}

function validateAnswers(answers: number[], expected: number, label: string): void {
  if (!Array.isArray(answers) || answers.length !== expected) {
    throw new Error(`${label} requires exactly ${expected} answers, got ${answers?.length ?? 0}`);
  }
  for (let i = 0; i < answers.length; i++) {
    const v = answers[i];
    if (!Number.isInteger(v) || v < 0 || v > 3) {
      throw new Error(`${label}[${i}] must be an integer 0-3, got ${v}`);
    }
  }
}

/** Returns total PHQ-A score (0-27). */
export function scorePHQA(answers: number[]): number {
  validateAnswers(answers, 9, 'PHQ-A');
  return answers.reduce((sum, v) => sum + v, 0);
}

/** Returns total GAD-7 score (0-21). */
export function scoreGAD7(answers: number[]): number {
  validateAnswers(answers, 7, 'GAD-7');
  return answers.reduce((sum, v) => sum + v, 0);
}

/**
 * Derives the three dimension scores from PHQ-A and GAD-7 answer arrays.
 * All values are rounded integers on a 0-100 scale.
 */
export function calculateDimensions(phqAnswers: number[], gadAnswers: number[]): DimensionScores {
  validateAnswers(phqAnswers, 9, 'PHQ-A');
  validateAnswers(gadAnswers, 7, 'GAD-7');

  const cogSum = phqAnswers[6] + gadAnswers[1] + gadAnswers[2] + gadAnswers[4];
  const cognitive_load = Math.round((cogSum / 12) * 100);

  const emoSum = phqAnswers[0] + phqAnswers[1] + phqAnswers[5] + gadAnswers[5];
  const emotional_regulation = Math.round(100 - (emoSum / 12) * 100);

  const recSum = phqAnswers[2] + phqAnswers[3] + gadAnswers[3];
  const recovery_capacity = Math.round(100 - (recSum / 9) * 100);

  return { cognitive_load, emotional_regulation, recovery_capacity };
}
