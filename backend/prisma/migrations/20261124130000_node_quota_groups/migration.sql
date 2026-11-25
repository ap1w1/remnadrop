CREATE TABLE user_node_quota_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uuid uuid NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    name varchar(80) NOT NULL,
    limit_bytes bigint NOT NULL CHECK (limit_bytes >= 0),
    used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    blocked boolean NOT NULL DEFAULT false,
    threshold_percent integer NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 99),
    threshold_sent boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_uuid, name)
);
ALTER TABLE user_node_quotas ADD COLUMN group_uuid uuid REFERENCES user_node_quota_groups(id) ON DELETE SET NULL;
CREATE INDEX user_node_quotas_group_uuid_idx ON user_node_quotas(group_uuid);
ALTER TABLE node_quota_events ADD COLUMN group_uuid uuid;
ALTER TABLE node_quota_events ADD COLUMN group_name text;
ALTER TABLE node_quota_events ADD COLUMN node_uuids uuid[] NOT NULL DEFAULT '{}';
