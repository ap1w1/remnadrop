DROP TRIGGER IF EXISTS guard_quota_topology ON internal_squad_members;
DROP TRIGGER IF EXISTS guard_quota_topology ON internal_squad_inbounds;
DROP TRIGGER IF EXISTS guard_quota_topology ON config_profile_inbounds_to_nodes;
DROP FUNCTION IF EXISTS guard_quota_topology();
DROP TRIGGER IF EXISTS guard_quota_squad_membership ON internal_squad_members;
DROP FUNCTION IF EXISTS guard_quota_squad_membership();
CREATE TABLE user_node_quotas (
 user_uuid uuid NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
 node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
 limit_bytes bigint CHECK(limit_bytes>=0), used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 blocked boolean NOT NULL DEFAULT false, period_days integer CHECK(period_days BETWEEN 1 AND 366),
 reset_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 threshold_percent integer NOT NULL DEFAULT 80 CHECK(threshold_percent BETWEEN 1 AND 99), threshold_sent boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_uuid,node_uuid)
);
CREATE INDEX user_node_quotas_reset_idx ON user_node_quotas(reset_at) WHERE reset_at IS NOT NULL;
ALTER TABLE user_squad_quotas ADD COLUMN migrated_to_node_uuid uuid;
WITH mapping AS (
 SELECT q.user_uuid,q.squad_uuid,array_agg(DISTINCT n.node_uuid) AS nodes
 FROM user_squad_quotas q JOIN internal_squad_inbounds i ON i.internal_squad_uuid=q.squad_uuid
 JOIN config_profile_inbounds_to_nodes n ON n.config_profile_inbound_uuid=i.inbound_uuid GROUP BY q.user_uuid,q.squad_uuid
), candidates AS (
 SELECT m.*,(SELECT count(*) FROM mapping other WHERE other.user_uuid=m.user_uuid AND m.nodes[1]=ANY(other.nodes)) AS owners FROM mapping m WHERE cardinality(nodes)=1
)
UPDATE user_squad_quotas q SET migrated_to_node_uuid=c.nodes[1] FROM candidates c WHERE c.owners=1 AND q.user_uuid=c.user_uuid AND q.squad_uuid=c.squad_uuid;
INSERT INTO user_node_quotas SELECT user_uuid,migrated_to_node_uuid,limit_bytes,used_bytes,blocked,period_days,reset_at,updated_at,threshold_percent,threshold_sent FROM user_squad_quotas WHERE migrated_to_node_uuid IS NOT NULL;
INSERT INTO internal_squad_members(user_id,internal_squad_uuid)
SELECT u.t_id,q.squad_uuid FROM user_squad_quotas q JOIN users u ON u.uuid=q.user_uuid WHERE q.blocked ON CONFLICT DO NOTHING;
INSERT INTO quota_sync(user_uuid) SELECT DISTINCT user_uuid FROM user_squad_quotas ON CONFLICT(user_uuid) DO UPDATE SET revision=quota_sync.revision+1,updated_at=now();
CREATE TABLE node_quota_events (LIKE quota_events INCLUDING ALL);
ALTER TABLE node_quota_events RENAME COLUMN squad_uuid TO node_uuid;
