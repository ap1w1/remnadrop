ALTER TABLE user_node_quota_groups ADD COLUMN period_days integer;
ALTER TABLE user_node_quota_groups ADD COLUMN reset_at timestamptz;

-- Keep existing single-node limits and their usage/reset dates when upgrading.
DO $$
DECLARE
    item record;
    created_group uuid;
BEGIN
    FOR item IN
        SELECT q.user_uuid, q.node_uuid, q.limit_bytes, q.used_bytes,
               q.threshold_percent, q.threshold_sent, q.period_days, q.reset_at,
               n.name AS node_name
        FROM user_node_quotas q
        JOIN nodes n ON n.uuid = q.node_uuid
        WHERE q.group_uuid IS NULL AND q.limit_bytes IS NOT NULL
    LOOP
        INSERT INTO user_node_quota_groups
            (user_uuid, name, limit_bytes, used_bytes, blocked, threshold_percent,
             threshold_sent, period_days, reset_at)
        VALUES
            (item.user_uuid, left(item.node_name, 32) || ' · ' || item.node_uuid::text,
             item.limit_bytes, item.used_bytes, item.used_bytes >= item.limit_bytes,
             item.threshold_percent, item.threshold_sent, item.period_days, item.reset_at)
        RETURNING id INTO created_group;

        UPDATE user_node_quotas
        SET group_uuid = created_group, limit_bytes = NULL, period_days = NULL,
            reset_at = NULL, threshold_sent = false,
            blocked = item.used_bytes >= item.limit_bytes, updated_at = now()
        WHERE user_uuid = item.user_uuid AND node_uuid = item.node_uuid;
    END LOOP;
END $$;

UPDATE user_node_quotas
SET blocked = false, updated_at = now()
WHERE group_uuid IS NULL AND limit_bytes IS NULL AND blocked;
