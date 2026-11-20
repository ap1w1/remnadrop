CREATE TABLE node_metric_alert_states (
 node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
 metric text NOT NULL,
 active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(node_uuid,metric)
);
CREATE TABLE node_metric_alert_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 node_uuid uuid NOT NULL,
 metric text NOT NULL,
 active boolean NOT NULL,
 value double precision NOT NULL,
 threshold double precision NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz
);
CREATE INDEX node_metric_alert_pending_idx ON node_metric_alert_events(next_attempt_at) WHERE delivered_at IS NULL;
