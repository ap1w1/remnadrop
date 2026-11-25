DROP TRIGGER IF EXISTS panel_event_push ON panel_events;
DROP FUNCTION IF EXISTS panel_enqueue_push();
DROP TABLE IF EXISTS panel_push_deliveries;
DROP TABLE IF EXISTS panel_push_subscriptions;
ALTER TABLE panel_event_preferences ALTER COLUMN event_types SET DEFAULT ARRAY['node.offline','node.online','automation.triggered','automation.failed','billing.reminder','auth.login','ssl.expiring','ssl.expired','metric.cpu','metric.memory','metric.online_drop','metric.traffic_drop'];
UPDATE panel_event_preferences SET event_types=array_append(event_types,'auth.login') WHERE NOT 'auth.login'=ANY(event_types) AND cardinality(event_types)=11;
UPDATE infra_providers SET favicon_link='https://dpichecker.st/public/web/img/favicon.ico' WHERE name='DPI//CHECKER';
CREATE TABLE node_quota_global_settings (
  id integer PRIMARY KEY CHECK (id=1),
  period_days integer CHECK (period_days BETWEEN 1 AND 366),
  threshold_percent integer NOT NULL CHECK (threshold_percent BETWEEN 1 AND 99),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION apply_node_quota_global_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_node_quota_preferences(user_uuid,period_days,reset_at,threshold_percent)
    SELECT NEW.uuid,s.period_days,CASE WHEN s.period_days IS NULL THEN NULL ELSE now()+s.period_days*interval '1 day' END,s.threshold_percent
    FROM node_quota_global_settings s WHERE s.id=1;
  RETURN NEW;
END $$;
CREATE TRIGGER user_node_quota_global_defaults AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION apply_node_quota_global_settings();
