-- Migration 006: Saved exercises table
CREATE TABLE IF NOT EXISTS saved_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES exercise_library(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, exercise_id)
);
