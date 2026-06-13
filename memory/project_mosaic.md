---
name: project-mosaic
description: Mosaic — mental health prediction app for high school students. Backend skeleton built; Claude API and Backboard.io integration pending.
metadata:
  type: project
---

Mosaic is a mental health prediction app for high school students.

**Stack:** Node.js + Express + TypeScript + Supabase (Postgres)

**Backend location:** `backend/` in the repo root

**DB tables:** users, survey_responses, signal_data (enum: transcript/sleep/voice), dimension_scores, exercise_library, exercise_completions

**Migrations:** `backend/migrations/001_create_tables.sql` (schema), `002_seed_exercises.sql` (10 exercises, 5 with full_ui=true)

**Routes implemented (stubs):**
- POST /api/survey
- POST /api/signals/transcript|sleep|voice
- GET /api/dashboard/:userId
- GET /api/exercises/recommended/:userId
- POST /api/exercises/:id/complete
- GET /api/trend/:userId
- GET /health (live Supabase check via exercise_library count)

**Why:** Hackathon project (Milpitas Hacks).

**How to apply:** Claude API and Backboard.io integration are explicitly deferred to a later phase. Frontend is handled separately via v0.
