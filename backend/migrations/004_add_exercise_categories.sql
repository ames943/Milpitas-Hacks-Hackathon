-- Migration 004: multi-category support for exercise_library
-- Adds a categories text[] column alongside the existing exercise_category_enum.
-- The enum is NOT dropped — it remains for backward compat with any code that
-- already reads the `category` column.
-- A GIN index on categories[] enables the @> containment operator used by
-- GET /api/exercises?category=.

alter table exercise_library
  add column if not exists categories text[] not null default '{}';

-- Update all 10 seed rows with their full category sets.
-- Names are stable (seeded in 002 with ON CONFLICT DO NOTHING).
update exercise_library set categories = ARRAY['Cognitive', 'Structural']  where name = 'Pre-sleep review';
update exercise_library set categories = ARRAY['Cognitive', 'Structural']  where name = 'Brain dump';
update exercise_library set categories = ARRAY['Structural']               where name = 'Time boxing';
update exercise_library set categories = ARRAY['Cognitive']                where name = 'Stress reappraisal';
update exercise_library set categories = ARRAY['Structural', 'Physical']   where name = 'Hard shutdown ritual';
update exercise_library set categories = ARRAY['Physical', 'Cognitive']    where name = 'Zone 2 walking';
update exercise_library set categories = ARRAY['Physical', 'Structural']   where name = 'Sleep anchor';
update exercise_library set categories = ARRAY['Cognitive', 'Structural']  where name = 'Strategic incompletion';
update exercise_library set categories = ARRAY['Cognitive', 'Social']      where name = 'Process journaling';
update exercise_library set categories = ARRAY['Structural']               where name = 'Workload visibility map';

-- GIN index for array containment queries
create index if not exists idx_exercise_library_categories
  on exercise_library using gin(categories);
