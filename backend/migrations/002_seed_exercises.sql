-- Seed exercise_library
-- Note: exercise_category_enum only supports one value per row; exercises with
-- multiple categories use the primary category as the enum value and the
-- secondary category is noted in description. If you need multi-category
-- support, alter to a text[] or junction table in a future migration.

insert into exercise_library (name, category, description, full_ui, instructions) values

  (
    'Pre-sleep review',
    'Cognitive',
    'Spend 12 minutes passively scanning notes before sleep. Replaces a full hour of late-night studying with better retention via sleep consolidation.',
    true,
    '{"type": "timer", "duration_minutes": 12, "fields": ["notes"]}'::jsonb
  ),

  (
    'Brain dump',
    'Cognitive',
    'Write every task, worry, and half-finished thought onto paper before bed or between sessions. Closes mental "open loops" draining working memory.',
    true,
    '{"type": "free_write", "duration_minutes": 10}'::jsonb
  ),

  (
    'Time boxing',
    'Structural',
    'Assign every task a fixed time slot on a calendar rather than a to-do list. Forces realistic time estimation, removes "infinite queue" feeling.',
    true,
    '{"type": "calendar_builder"}'::jsonb
  ),

  (
    'Stress reappraisal',
    'Cognitive',
    'Replace "I''m anxious" with "I''m excited" before high-stakes moments. Anxiety and excitement share physiological signatures; relabeling redirects energy.',
    true,
    '{"type": "before_after_reframe"}'::jsonb
  ),

  (
    'Hard shutdown ritual',
    'Structural',
    'Fixed end-of-day sequence — write tomorrow''s top three tasks, note one win, do a physical transition. Trains nervous system to treat sleep as recovery. (Also: Physical)',
    false,
    null
  ),

  (
    'Zone 2 walking',
    'Physical',
    '20-minute brisk walk between study blocks. Elevates BDNF for memory consolidation and focus. (Also: Cognitive)',
    false,
    null
  ),

  (
    'Sleep anchor',
    'Physical',
    'Fix wake time within a 30-minute window daily, including weekends. Regulates circadian rhythm and mood. (Also: Structural)',
    false,
    null
  ),

  (
    'Strategic incompletion',
    'Cognitive',
    'Stop tasks deliberately mid-flow, leave a one-sentence note on where you stopped. Brain continues processing overnight; faster re-entry next session. (Also: Structural)',
    false,
    null
  ),

  (
    'Process journaling',
    'Cognitive',
    'Three sentences nightly — what went well, what was learned, one thing to do differently tomorrow. Interrupts perfectionist spirals. (Also: Social)',
    true,
    '{"type": "three_field_form", "fields": ["went_well", "learned", "do_differently"]}'::jsonb
  ),

  (
    'Workload visibility map',
    'Structural',
    'List every commitment for the week with honest time estimates, plotted onto days. Seeing finite workload is calming.',
    false,
    null
  )

on conflict do nothing;
