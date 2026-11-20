CREATE TABLE node_metric_agent_snapshots (
 node_uuid uuid PRIMARY KEY REFERENCES nodes(uuid) ON DELETE CASCADE,
 received_at timestamptz NOT NULL DEFAULT now(),
 cpu double precision NOT NULL CHECK (cpu BETWEEN 0 AND 100)
);
