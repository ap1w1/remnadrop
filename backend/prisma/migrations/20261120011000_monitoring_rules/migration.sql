CREATE TABLE monitoring_rules (scope text PRIMARY KEY, settings jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE node_metric_alert_states ADD COLUMN pending_state boolean;
ALTER TABLE node_metric_alert_states ADD COLUMN pending_count integer NOT NULL DEFAULT 0;
