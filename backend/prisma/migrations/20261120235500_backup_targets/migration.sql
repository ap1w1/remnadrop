-- Separate policies and independent schedules for every backup destination.
CREATE TABLE backup_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(70) NOT NULL,
  provider VARCHAR(10) NOT NULL CHECK(provider IN ('local','s3','ftp','gdrive')),
  remote_name VARCHAR(64) NOT NULL DEFAULT '',
  remote_path VARCHAR(160) NOT NULL DEFAULT 'remnadrop',
  interval_minutes INTEGER NOT NULL DEFAULT 1440 CHECK(interval_minutes BETWEEN 15 AND 525600),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 3650),
  max_bytes BIGINT NOT NULL DEFAULT 10737418240 CHECK(max_bytes BETWEEN 1048576 AND 9007199254740991),
  auto_delete BOOLEAN NOT NULL DEFAULT TRUE,
  webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  last_status VARCHAR(12),
  last_usage_bytes BIGINT,
  last_usage_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(provider = 'local' OR remote_name <> '')
);
CREATE INDEX backup_targets_due_idx ON backup_targets(next_run_at) WHERE enabled;
CREATE TABLE backup_runs (
  id UUID PRIMARY KEY,
  target_id UUID NOT NULL REFERENCES backup_targets(id) ON DELETE RESTRICT,
  status VARCHAR(14) NOT NULL CHECK(status IN ('running','completed','failed')),
  file_name VARCHAR(160),
  size_bytes BIGINT,
  sha256 CHAR(64),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX backup_runs_target_idx ON backup_runs(target_id,started_at DESC);

-- Agent heartbeat helps distinguish an empty schedule from an offline worker.
CREATE TABLE backup_agent_status (
  singleton SMALLINT PRIMARY KEY DEFAULT 1 CHECK(singleton=1),
  last_seen TIMESTAMPTZ,
  last_error TEXT
);
INSERT INTO backup_agent_status(singleton) VALUES (1);
