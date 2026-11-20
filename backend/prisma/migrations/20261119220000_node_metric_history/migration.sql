CREATE TABLE node_metric_samples (
 node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
 sampled_at timestamptz NOT NULL,
 metrics jsonb NOT NULL,
 PRIMARY KEY (node_uuid, sampled_at)
);
CREATE INDEX node_metric_samples_retention_idx ON node_metric_samples(sampled_at);
