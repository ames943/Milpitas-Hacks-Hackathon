/**
 * Quick smoke test for POST /api/survey.
 * Usage:
 *   npm run test:survey                    # uses placeholder user_id (will 404 if FK enforced)
 *   npm run test:survey -- <real-user-id>  # pass a UUID from your users table
 *
 * PHQ-A answers[0..8]: anhedonia, depressed_mood, sleep, fatigue, appetite,
 *                        worthlessness, concentration, psychomotor, suicidality
 * GAD-7 answers[0..6]: nervous, uncontrollable_worry, excessive_worry,
 *                        relaxation, restlessness, irritability, dread
 */

import 'dotenv/config';

const BASE_URL = process.env.API_URL ?? 'http://localhost:3001';

// Moderate anxiety, some depressive symptoms, poor sleep — a realistic test case.
const payload = {
  user_id: process.argv[2] ?? '00000000-0000-0000-0000-000000000001',
  phq_answers: [2, 2, 3, 2, 1, 1, 2, 0, 0], // PHQ-A total = 13
  gad_answers: [2, 2, 2, 1, 1, 1, 1],        // GAD-7 total = 10
};

// Expected (rough):
//   cognitive_load      = round((phq[6]=2 + gad[1]=2 + gad[2]=2 + gad[4]=1) / 12 * 100) = round(58.3) = 58
//   emotional_regulation = round(100 - (phq[0]=2 + phq[1]=2 + phq[5]=1 + gad[5]=1) / 12 * 100) = round(100 - 50) = 50
//   recovery_capacity   = round(100 - (phq[2]=3 + phq[3]=2 + gad[3]=1) / 9 * 100) = round(100 - 66.7) = 33

async function main(): Promise<void> {
  console.log(`POST ${BASE_URL}/api/survey`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(`${BASE_URL}/api/survey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as Record<string, unknown>;
  console.log(`\nHTTP ${res.status}`);

  if (!body.success) {
    console.error('Error:', body.error ?? body);
    process.exit(1);
  }

  const data = body.data as { survey: unknown; dimension_scores: Record<string, unknown> };
  console.log('\nSurvey:', JSON.stringify(data.survey, null, 2));
  console.log('\nDimension scores:');
  console.log(JSON.stringify(data.dimension_scores, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
