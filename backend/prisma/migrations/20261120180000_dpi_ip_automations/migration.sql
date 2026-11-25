-- DPI jobs deliberately never persist VLESS URIs or API credentials.
CREATE TABLE dpi_check_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 remote_id integer UNIQUE,
 user_uuid uuid REFERENCES users(uuid) ON DELETE SET NULL,
 host_uuids uuid[] NOT NULL,
 location text NOT NULL,
 pop_ids integer[] NOT NULL,
 status text NOT NULL DEFAULT 'prepared',
 progress_done integer NOT NULL DEFAULT 0,
 progress_total integer NOT NULL DEFAULT 0,
 estimated_cost numeric(14,4),
 actual_cost numeric(14,4),
 error text,
 results jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status IN ('prepared','pending','running','completed','failed','cancelled')),
 CHECK(cardinality(host_uuids)>0)
);
CREATE INDEX dpi_check_jobs_recent_idx ON dpi_check_jobs(created_at DESC);
CREATE TABLE node_ip_pool (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
 ip inet NOT NULL,
 is_active boolean NOT NULL DEFAULT false,
 tcp_reachable boolean,
 last_checked_at timestamptz,
 last_error text,
 rotation_minutes integer CHECK(rotation_minutes BETWEEN 5 AND 525600),
 rotated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(node_uuid,ip)
);
CREATE UNIQUE INDEX node_ip_pool_one_active ON node_ip_pool(node_uuid) WHERE is_active;
CREATE TABLE node_automation_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
 name text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 drop_percent integer NOT NULL DEFAULT 50 CHECK(drop_percent BETWEEN 1 AND 100),
 min_online integer NOT NULL DEFAULT 5 CHECK(min_online>=0),
 duration_minutes integer NOT NULL DEFAULT 5 CHECK(duration_minutes BETWEEN 1 AND 1440),
 cooldown_minutes integer NOT NULL DEFAULT 60 CHECK(cooldown_minutes BETWEEN 1 AND 10080),
 actions jsonb NOT NULL DEFAULT '[]',
 pending_since timestamptz,
 last_run_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX node_automation_rules_enabled_idx ON node_automation_rules(node_uuid) WHERE enabled;
CREATE TABLE node_automation_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rule_id uuid NOT NULL REFERENCES node_automation_rules(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL DEFAULT 'running',
 details jsonb NOT NULL DEFAULT '[]'
);
