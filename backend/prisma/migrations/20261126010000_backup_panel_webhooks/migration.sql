ALTER TABLE backup_runs
  ADD COLUMN webhook_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN webhook_enqueued_at timestamptz,
  ADD COLUMN webhook_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN webhook_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN webhook_lease_until timestamptz;

-- Do not replay historical backup results during the upgrade.
UPDATE backup_runs SET webhook_enqueued_at=now() WHERE status IN ('completed','failed');

CREATE INDEX backup_runs_webhook_pending_idx ON backup_runs(webhook_next_attempt_at,finished_at)
  WHERE webhook_enqueued_at IS NULL AND status IN ('completed','failed');
