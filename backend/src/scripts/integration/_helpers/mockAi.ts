/**
 * AI mock helpers for integration tests.
 * Call jest.mock('../../lib/aiClient') in the test file first, then use
 * these helpers in beforeEach/afterEach to configure call behaviour.
 */

import type { callAI as CallAIType, extractTranscriptData as ExtractType } from '../../../lib/aiClient';

type MockFn = jest.MockedFunction<typeof CallAIType>;
type MockExtract = jest.MockedFunction<typeof ExtractType>;

const DEFAULT_TRANSCRIPT = {
  gpa: 3.8,
  course_load: 6,
  has_ap_honors: true,
  grade_trend: 'stable' as const,
};

const DEFAULT_EXPLANATION = 'Your academic workload and patterns suggest a need for balance.';

/**
 * Returns AI mock return value based on the call context.
 * Detects exercise-matching vs transcript vs dashboard calls by inspecting
 * the user prompt.
 */
function defaultCallAIImpl(
  _system: string,
  user: string,
  opts?: { jsonOutput?: boolean },
): unknown {
  if (opts?.jsonOutput) {
    if (user.includes('CANDIDATE EXERCISES')) {
      // Exercise matching — parse candidate IDs from the prompt and return first 5.
      const ids = [...user.matchAll(/^ID: (.+)$/gm)].slice(0, 5).map((m) => m[1].trim());
      return Promise.resolve({
        recommendations: ids.map((id) => ({
          exercise_id:  id,
          match_reason: `Mock: this exercise targets your current stress pattern.`,
        })),
      });
    }
    // Transcript or other JSON call — return default transcript data
    return Promise.resolve(DEFAULT_TRANSCRIPT);
  }
  return Promise.resolve(DEFAULT_EXPLANATION);
}

/** Apply the default mock implementations for callAI and extractTranscriptData. */
export function setupDefaultAiMock(
  callAIMock: MockFn,
  extractMock?: MockExtract,
): void {
  callAIMock.mockImplementation(defaultCallAIImpl as typeof CallAIType);
  if (extractMock) {
    extractMock.mockResolvedValue(DEFAULT_TRANSCRIPT);
  }
}

/** Make callAI reject with an error after `delayMs` milliseconds. */
export function mockCallAIThrows(callAIMock: MockFn, message = 'AI timeout', delayMs = 0): void {
  callAIMock.mockImplementation(
    () => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), delayMs)),
  );
}

/** Make callAI return a fixed raw value (use for invalid AI output tests). */
export function mockCallAIReturns(callAIMock: MockFn, value: unknown): void {
  callAIMock.mockResolvedValue(value as Awaited<ReturnType<typeof CallAIType>>);
}
