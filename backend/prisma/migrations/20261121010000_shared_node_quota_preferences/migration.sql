-- Shared reset schedule and warning threshold for ALL node quotas of one subscription.
-- Opt-in: existing user_node_quotas remain valid and continue on their legacy schedules
-- until an administrator explicitly saves a shared policy.
CREATE TABLE user_node_quota_preferences (
    user_uuid UUID PRIMARY KEY REFERENCES users(uuid) ON DELETE CASCADE,
    period_days INTEGER CHECK (period_days BETWEEN 1 AND 366),
    reset_at TIMESTAMPTZ,
    threshold_percent INTEGER NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 99),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT quota_preferences_reset_consistency CHECK (
        (period_days IS NULL AND reset_at IS NULL)
        OR (period_days IS NOT NULL AND reset_at IS NOT NULL)
    )
);
CREATE INDEX user_node_quota_preferences_reset_idx
    ON user_node_quota_preferences (reset_at) WHERE reset_at IS NOT NULL;
