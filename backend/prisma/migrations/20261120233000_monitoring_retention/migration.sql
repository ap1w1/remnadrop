-- Global monitoring retention. 1 row; does not affect per-node alert rules.
CREATE TABLE IF NOT EXISTS monitoring_preferences (
    id smallint PRIMARY KEY CHECK (id = 1),
    retention_days integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 1 AND 365)
);
INSERT INTO monitoring_preferences(id, retention_days) VALUES (1,90) ON CONFLICT(id) DO NOTHING;
