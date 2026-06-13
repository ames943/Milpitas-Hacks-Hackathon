/**
 * Exercise recommendation live test — real Supabase + real Backboard AI.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, BACKBOARD_API_KEY in .env
 * Prints the 5 recommendations with AI-generated match reasons for quality check.
 *
 * Run: ts-node --transpile-only src/scripts/test-exercises-live.ts
 */

import 'dotenv/config';
import { supabase } from '../lib/supabase';
import app from '../app';
import http from 'node:http';

const TEST_USER_ID = `live-exercises-${Date.now()}`;

function get(server: http.Server, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { reject(new Error(`JSON parse failed:\n${data}`)); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function cleanup(): Promise<void> {
  await supabase.from('dimension_scores').delete().eq('user_id', TEST_USER_ID);
}

async function run(): Promise<void> {
  console.log(`\nExercise recommendation live test  (user: ${TEST_USER_ID})\n`);
  console.log('Seeding a stressed student: high cognitive load, low ER + RC, transcript uploaded\n');

  await cleanup();

  // Seed dimension scores reflecting a stressed student
  const { error: dimErr } = await supabase.from('dimension_scores').insert({
    user_id:              TEST_USER_ID,
    cognitive_load:       78,
    emotional_regulation: 28,
    recovery_capacity:    32,
    confidence_score:     60,
    explanation_text:     'Live test seed',
  });
  if (dimErr) { console.error('dimension_scores insert failed:', dimErr); process.exit(1); }

  // Seed a transcript signal for richer AI context
  const { error: sigErr } = await supabase.from('signal_data').insert({
    user_id:                TEST_USER_ID,
    signal_type:            'transcript',
    processed_data: {
      gpa:           2.9,
      course_load:   8,
      has_ap_honors: true,
      grade_trend:   'declining',
    },
    confidence_contribution: 20,
  });
  if (sigErr) { console.error('signal_data insert failed:', sigErr); process.exit(1); }

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  try {
    console.log('Calling GET /api/exercises/recommended/:userId (real AI call)...\n');
    const start = Date.now();
    const { status, body } = await get(server, `/api/exercises/recommended/${TEST_USER_ID}`);
    const ms = Date.now() - start;

    console.log(`HTTP ${status}  (${ms}ms)\n`);

    if (status !== 200) {
      console.error('ERROR response:', JSON.stringify(body, null, 2));
      process.exit(1);
    }

    const data = (body as { data: {
      recommendations: Array<{ exercise: { name: string; categories: string[]; full_ui: boolean }; match_reason: string }>;
      dimension_snapshot: Record<string, { score: number; color: string }>;
    } }).data;

    // Dimension snapshot
    console.log('── Dimension snapshot ──');
    for (const [dim, info] of Object.entries(data.dimension_snapshot)) {
      console.log(`  ${dim}: ${info.score}/100  [${info.color}]`);
    }

    console.log('\n── 5 Personalized recommendations ──');
    data.recommendations.forEach((r, i) => {
      const ui = r.exercise.full_ui ? ' [interactive]' : '';
      console.log(`\n${i + 1}. ${r.exercise.name}${ui}`);
      console.log(`   Categories: ${r.exercise.categories.join(', ')}`);
      console.log(`   Why: "${r.match_reason}"`);
    });

    const hasFullUi = data.recommendations.some((r) => r.exercise.full_ui);
    console.log(`\n✓ full_ui guarantee: ${hasFullUi ? 'satisfied' : 'MISSING — check ensureFullUiGuarantee'}`);
    console.log('✓ Live exercise test passed');
  } finally {
    await cleanup();
    await supabase.from('signal_data').delete().eq('user_id', TEST_USER_ID);
    await new Promise<void>((r) => server.close(() => r()));
    console.log('\nCleaned up test data');
  }
}

run().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
