ALTER TABLE quota_events ADD COLUMN delivered_at timestamptz;
ALTER TABLE quota_events ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE quota_events ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE quota_events ADD COLUMN lease_until timestamptz;
ALTER TABLE user_squad_quotas ADD COLUMN threshold_percent integer NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 99);
ALTER TABLE user_squad_quotas ADD COLUMN threshold_sent boolean NOT NULL DEFAULT false;
CREATE INDEX quota_event_pending_idx ON quota_events(next_attempt_at) WHERE delivered_at IS NULL;
