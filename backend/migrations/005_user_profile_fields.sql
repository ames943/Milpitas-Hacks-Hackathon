-- Migration 005: Add profile fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backboard_assistant_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;

-- Ensure email is unique (required for upsert-by-email in POST /api/users)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
