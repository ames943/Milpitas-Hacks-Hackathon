-- Enable UUID extension
create extension if not exists "pgcrypto";

-- users
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- survey_responses
create table if not exists survey_responses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  phq_a_score  numeric,
  gad7_score   numeric,
  raw_answers  jsonb,
  created_at   timestamptz not null default now()
);

-- signal_type enum
do $$ begin
  create type signal_type_enum as enum ('transcript', 'sleep', 'voice');
exception when duplicate_object then null;
end $$;

-- signal_data
create table if not exists signal_data (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references users(id) on delete cascade,
  signal_type             signal_type_enum not null,
  raw_data                jsonb,
  processed_data          jsonb,
  confidence_contribution numeric,
  created_at              timestamptz not null default now()
);

-- dimension_scores
create table if not exists dimension_scores (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  cognitive_load        numeric,
  emotional_regulation  numeric,
  recovery_capacity     numeric,
  confidence_score      numeric,
  explanation_text      text,
  created_at            timestamptz not null default now()
);

-- exercise_category enum
do $$ begin
  create type exercise_category_enum as enum ('Cognitive', 'Structural', 'Physical');
exception when duplicate_object then null;
end $$;

-- exercise_library
create table if not exists exercise_library (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     exercise_category_enum not null,
  description  text,
  full_ui      boolean not null default false,
  instructions jsonb
);

-- exercise_completions
create table if not exists exercise_completions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  exercise_id     uuid not null references exercise_library(id) on delete cascade,
  completion_data jsonb,
  created_at      timestamptz not null default now()
);

-- Indexes
create index if not exists idx_survey_responses_user_id   on survey_responses(user_id);
create index if not exists idx_signal_data_user_id        on signal_data(user_id);
create index if not exists idx_dimension_scores_user_id   on dimension_scores(user_id);
create index if not exists idx_exercise_completions_user  on exercise_completions(user_id);
create index if not exists idx_exercise_completions_ex    on exercise_completions(exercise_id);
