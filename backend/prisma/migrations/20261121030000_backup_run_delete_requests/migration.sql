-- Agent-side archive removal request; panel never needs filesystem/rclone access.
ALTER TABLE backup_runs
  ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delete_error TEXT;
CREATE INDEX IF NOT EXISTS backup_run_delete_requests_idx
  ON backup_runs(delete_requested_at) WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL;
