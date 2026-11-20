-- Keep actual backup files and run history when a destination is removed from the UI.
-- Existing destinations remain visible; a new installation starts with none.
ALTER TABLE backup_targets
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS backup_targets_active_idx
  ON backup_targets (created_at DESC) WHERE archived_at IS NULL;
