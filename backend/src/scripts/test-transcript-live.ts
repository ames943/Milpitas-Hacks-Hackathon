/**
 * Live test: Backboard.io → transcript extraction → dimension adjustment.
 *
 * Usage:
 *   BACKBOARD_API_KEY=<key> npx ts-node --transpile-only src/scripts/test-transcript-live.ts
 *
 * Or add BACKBOARD_API_KEY to .env and run:
 *   npm run test:transcript-live
 *
 * This consumes Backboard credits. Do NOT run in CI.
 */

import 'dotenv/config';
import { extractTranscriptData, BackboardError } from '../lib/claudeClient';
import { computeNewCognitiveLoad } from '../lib/signalAdjustments';

const SAMPLE_TRANSCRIPT = `
Jefferson High School — Unofficial Transcript
Student: Jane Smith | Grade: 11

Fall Semester 2023
  AP Biology           A-
  AP US History        B+
  Honors English 11    B
  Pre-Calculus         B+
  Spanish 3            A
  PE/Health            A

Spring Semester 2023
  AP Environmental Sci A
  AP World History     A-
  Honors English 10    A
  Geometry Honors      A-
  Spanish 2            A
  PE                   A
`.trim();

async function main() {
  if (!process.env.BACKBOARD_API_KEY) {
    console.error('Error: BACKBOARD_API_KEY not set. Add it to .env or pass it inline.');
    process.exit(1);
  }

  console.log('── Transcript text ─────────────────────────────────');
  console.log(SAMPLE_TRANSCRIPT);
  console.log('\n── Calling Backboard (anthropic/claude-sonnet-4-6) ──');

  let result: Awaited<ReturnType<typeof extractTranscriptData>>;
  try {
    result = await extractTranscriptData(SAMPLE_TRANSCRIPT);
  } catch (err) {
    if (err instanceof BackboardError) {
      console.error('Backboard error:', err.message);
      console.error('Raw output:', err.rawOutput);
    } else {
      console.error('Unexpected error:', err);
    }
    process.exit(1);
  }

  console.log('\n── Extracted fields ─────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));

  const prior_cognitive_load = 55;
  const new_cl = computeNewCognitiveLoad(
    prior_cognitive_load,
    result.grade_trend,
    result.course_load,
    result.has_ap_honors,
  );

  console.log('\n── Adjustment (prior cognitive_load = 55) ───────────');
  console.log(`  grade_trend:    ${result.grade_trend}`);
  console.log(`  course_load:    ${result.course_load} (≥6? ${result.course_load >= 6})`);
  console.log(`  has_ap_honors:  ${result.has_ap_honors}`);
  console.log(`  cognitive_load: 55 → ${new_cl}`);
  console.log('\nDone. ✓');
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
