/**
 * Pure audio feature extraction functions.
 * All operate on Float32Array PCM samples normalized to [-1, 1].
 *
 * Frame size convention: 20ms non-overlapping windows (per spec).
 *   frameSize = Math.round(sampleRate * 0.02)
 *
 * Pitch detection note: at 44100 Hz with 20ms frames (882 samples), reliable F0
 * detection covers ~100-500 Hz (2× the min period fits within the frame).
 * This covers the vast majority of adolescent/adult voice ranges.
 * Very low male voices (<100 Hz) will not produce a pitch estimate — documented
 * limitation for hackathon demo.
 */

/**
 * Computes mean squared energy for each non-overlapping frame.
 * Returns a Float64Array with one value per frame.
 */
export function computeFrameEnergies(samples: Float32Array, frameSize: number): Float64Array {
  const numFrames = Math.floor(samples.length / frameSize);
  const energies = new Float64Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    const offset = i * frameSize;
    for (let j = 0; j < frameSize; j++) {
      const s = samples[offset + j];
      sum += s * s;
    }
    energies[i] = sum / frameSize;
  }
  return energies;
}

/**
 * Adaptive silence threshold: 1.5× the 10th-percentile frame energy.
 * Calibrated to the file's own noise floor so quiet recordings are not
 * misclassified as all-voiced.
 */
export function computeAdaptiveThreshold(energies: Float64Array): number {
  if (energies.length === 0) return 0;
  const sorted = Array.from(energies).sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  return 1.5 * p10;
}

/** Classifies each frame as voiced (true) or silent (false). */
export function classifyFrames(energies: Float64Array, threshold: number): boolean[] {
  return Array.from(energies, (e) => e > threshold);
}

/**
 * Counts pauses: voiced→silent transitions where the silence run exceeds 300ms.
 * minSilentFrames = ceil(0.3 × sampleRate / frameSize).
 */
export function countPauses(voiced: boolean[], sampleRate: number, frameSize: number): number {
  const minSilentFrames = Math.ceil((0.3 * sampleRate) / frameSize);
  let pauses = 0;
  let silentRun = 0;
  let prevWasVoiced = false;

  for (const isVoiced of voiced) {
    if (isVoiced) {
      if (prevWasVoiced && silentRun >= minSilentFrames) pauses++;
      silentRun = 0;
      prevWasVoiced = true;
    } else {
      silentRun++;
    }
  }

  return pauses;
}

/**
 * Sample variance (unbiased estimator, n-1 denominator).
 * Returns 0 for arrays with fewer than 2 elements.
 */
export function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
}
