ALTER TABLE node_quota_global_settings ADD COLUMN threshold_percents integer[] NOT NULL DEFAULT ARRAY[80];
UPDATE node_quota_global_settings SET threshold_percents=ARRAY[threshold_percent];

ALTER TABLE user_node_quota_preferences ADD COLUMN threshold_percents integer[] NOT NULL DEFAULT ARRAY[80];
UPDATE user_node_quota_preferences SET threshold_percents=ARRAY[threshold_percent];

ALTER TABLE user_node_quotas ADD COLUMN sent_threshold_percents integer[] NOT NULL DEFAULT '{}';
UPDATE user_node_quotas SET sent_threshold_percents=ARRAY[threshold_percent] WHERE threshold_sent;

ALTER TABLE user_node_quota_groups ADD COLUMN sent_threshold_percents integer[] NOT NULL DEFAULT '{}';
UPDATE user_node_quota_groups SET sent_threshold_percents=ARRAY[threshold_percent] WHERE threshold_sent;

ALTER TABLE node_quota_events ADD COLUMN threshold_percent integer;

CREATE OR REPLACE FUNCTION apply_node_quota_global_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_node_quota_preferences(user_uuid,period_days,reset_at,threshold_percent,threshold_percents)
    SELECT NEW.uuid,s.period_days,
      CASE WHEN s.period_days IS NULL THEN NULL ELSE now()+s.period_days*interval '1 day' END,
      s.threshold_percent,s.threshold_percents
    FROM node_quota_global_settings s WHERE s.id=1;
  RETURN NEW;
END $$;
