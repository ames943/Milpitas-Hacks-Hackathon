-- Migration 007: Counselor flag on exercises
ALTER TABLE exercise_library
  ADD COLUMN IF NOT EXISTS counselor_flag boolean DEFAULT false;

UPDATE exercise_library SET counselor_flag = true
WHERE name IN (
  'Process journaling',
  'Sleep anchor',
  'Hard shutdown ritual'
);
