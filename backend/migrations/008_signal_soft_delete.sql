-- Migration 008: Soft delete support for signal_data
-- All signal queries must add WHERE deleted_at IS NULL to exclude soft-deleted rows.
ALTER TABLE signal_data
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT null;
