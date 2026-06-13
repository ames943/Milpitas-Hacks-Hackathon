import 'dotenv/config';
import { supabase } from '../../../lib/supabase';

/** Delete all test data for a user in FK-safe order. */
export async function cleanupUser(userId: string): Promise<void> {
  await supabase.from('exercise_completions').delete().eq('user_id', userId);
  await supabase.from('saved_exercises').delete().eq('user_id', userId);
  await supabase.from('signal_data').delete().eq('user_id', userId);
  await supabase.from('survey_responses').delete().eq('user_id', userId);
  await supabase.from('dimension_scores').delete().eq('user_id', userId);
  await supabase.from('users').delete().eq('id', userId);
}

/** Upsert a users row so FK constraints on downstream tables are satisfied. */
export async function seedUser(userId: string): Promise<void> {
  const email = `test-${userId}@mosaic-test.invalid`;
  const { error } = await supabase
    .from('users')
    .upsert({ id: userId, email }, { onConflict: 'id' });
  if (error) throw error;
}

/** Submit a minimal all-zero survey for a user, returning the dimension_scores row. */
export async function seedSurvey(
  userId: string,
  request: { post(url: string): import('supertest').Test },
): Promise<void> {
  const res = await request
    .post('/api/survey')
    .send({
      user_id:     userId,
      phq_answers: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      gad_answers: [0, 0, 0, 0, 0, 0, 0],
    });
  if (res.status !== 201) {
    throw new Error(`seedSurvey failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}
