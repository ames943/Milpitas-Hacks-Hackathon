-- Migration 003: constraints and index improvements
-- Safe to re-run (idempotent where possible).

-- ─── Task 2: composite index for dimension_scores ───────────────────────────
-- The "get latest scores for user" query used by dashboard and signals routes is:
--   SELECT ... FROM dimension_scores WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
-- A single-column (user_id) index covers the filter but not the sort; the planner
-- must then sort the matching rows.  A composite (user_id, created_at DESC) index
-- serves both in a single index scan.
drop index if exists idx_dimension_scores_user_id;
create index if not exists idx_dimension_scores_user_created
  on dimension_scores(user_id, created_at desc);

-- Same treatment for survey_responses — trend queries (Part 6) will also need
-- chronological order per user.
drop index if exists idx_survey_responses_user_id;
create index if not exists idx_survey_responses_user_created
  on survey_responses(user_id, created_at desc);


-- ─── Task 3: raw_answers shape constraint ────────────────────────────────────
-- The app-level guard in survey.ts already constructs raw_answers from validated
-- arrays only, so no extra fields can arrive via the API.  This CHECK adds
-- belt-and-suspenders enforcement at the persistence layer so that direct DB
-- writes (migrations, admin scripts) also conform.
--
-- The constraint:
--   • Allows NULL (column is nullable for legacy compatibility)
--   • When present, requires exactly the two expected keys and correct lengths
--   • Rejects any extra keys via the subtraction operator (raw_answers - known keys = {})
alter table survey_responses
  add constraint survey_responses_raw_answers_shape check (
    raw_answers is null
    or (
      raw_answers ? 'phq_answers'
      and raw_answers ? 'gad_answers'
      and jsonb_array_length(raw_answers->'phq_answers') = 9
      and jsonb_array_length(raw_answers->'gad_answers') = 7
      and (raw_answers - 'phq_answers' - 'gad_answers') = '{}'::jsonb
    )
  );


-- ─── Task 4: no UNIQUE on survey_responses(user_id) — confirmed intentional ──
-- survey_responses has no unique constraint on user_id.  Multiple rows per user
-- are by design: each submission is a longitudinal snapshot used by the trend
-- endpoint (Part 6).  No DDL change needed; this comment is the explicit audit
-- record confirming the absence of such a constraint is correct.
