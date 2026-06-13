/**
 * Dashboard live test — real Supabase + real Backboard API calls.
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, BACKBOARD_API_KEY in .env
 *
 * Seeds a temporary user, calls the full dashboard endpoint, prints the
 * JSON response, then cleans up.
 *
 * Run: ts-node --transpile-only src/scripts/test-dashboard-live.ts
 */

import 'dotenv/config';
import { supabase } from '../lib/supabase';
import app from '../app';
import http from 'node:http';

const TEST_USER_ID = `live-dashboard-test-${Date.now()}`;

function get(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            reject(new Error(`JSON parse failed:\n${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function cleanup(): Promise<void> {
  await supabase.from('signal_data').delete().eq('user_id', TEST_USER_ID);
  await supabase.from('dimension_scores').delete().eq('user_id', TEST_USER_ID);
  await supabase.from('survey_responses').delete().eq('user_id', TEST_USER_ID);
}

async function run(): Promise<void> {
  console.log(`\nDashboard live test  (user: ${TEST_USER_ID})\n`);

  await cleanup();

  // 1. Seed survey
  const { error: survErr } = await supabase.from('survey_responses').insert({
    user_id: TEST_USER_ID,
    raw_answers: {
      phq_answers: [2, 2, 1, 2, 0, 1, 2, 0],
      gad_answers: [1, 2, 2, 1, 1, 2, 0],
    },
    phq_score: 10,
    gad_score: 9,
  });
  if (survErr) { console.error('Survey insert failed:', survErr); process.exit(1); }

  // 2. Seed dimension scores
  const { error: dimErr } = await supabase.from('dimension_scores').insert({
    user_id:              TEST_USER_ID,
    cognitive_load:       72,
    emotional_regulation: 41,
    recovery_capacity:    35,
    confidence_score:     60,
    explanation:          'Survey + transcript seeded for live test',
  });
  if (dimErr) { console.error('Dimension scores insert failed:', dimErr); process.exit(1); }

  // 3. Seed a transcript signal
  const { error: sigErr } = await supabase.from('signal_data').insert({
    user_id:                TEST_USER_ID,
    signal_type:            'transcript',
    processed_data: {
      gpa:           3.1,
      course_load:   7,
      has_ap_honors: true,
      grade_trend:   'declining',
    },
    confidence_contribution: 20,
  });
  if (sigErr) { console.error('Signal insert failed:', sigErr); process.exit(1); }

  // 4. Start server
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  console.log(`Server started on port ${port}`);

  try {
    console.log('\nCalling GET /api/dashboard/:userId (3 real Backboard calls)...\n');
    const start = Date.now();
    const { status, body } = await get(server, `/api/dashboard/${TEST_USER_ID}`);
    const ms = Date.now() - start;

    console.log(`HTTP ${status}  (${ms}ms)\n`);
    console.log(JSON.stringify(body, null, 2));

    if (status !== 200) {
      console.error('\nERROR: expected 200');
      process.exit(1);
    }

    const data = (body as { data: { dimensions: Record<string, { explanation: string; color: string; score: number }> } }).data;
    console.log('\n── Dimension explanations ──');
    for (const [dim, info] of Object.entries(data.dimensions)) {
      console.log(`\n${dim}  [${info.color}]  score=${info.score}`);
      console.log(`  "${info.explanation}"`);
    }

    console.log('\n✓ Live dashboard test passed');
  } finally {
    await cleanup();
    await new Promise<void>((r) => server.close(() => r()));
    console.log('\nCleaned up test data');
  }
}

run().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
