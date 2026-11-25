-- A durable, shared inbox. Read positions and delivery preferences belong to each admin.
CREATE TABLE panel_events (
  id bigserial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','error','success')),
  title text NOT NULL,
  message text NOT NULL,
  node_uuid uuid,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX panel_events_type_id_idx ON panel_events(type,id DESC);
CREATE TABLE panel_event_preferences (
  admin_uuid uuid PRIMARY KEY REFERENCES admin(uuid) ON DELETE CASCADE,
  browser_enabled boolean NOT NULL DEFAULT false,
  event_types text[] NOT NULL DEFAULT ARRAY['node.offline','node.online','automation.triggered','automation.failed','billing.reminder','ssl.expiring','ssl.expired','metric.cpu','metric.memory','metric.online_drop','metric.traffic_drop']
);
-- Explicit receipts also handle transactions that commit out of sequence-ID order.
CREATE TABLE panel_event_reads (
  admin_uuid uuid NOT NULL REFERENCES admin(uuid) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES panel_events(id) ON DELETE CASCADE,
  PRIMARY KEY(admin_uuid,event_id)
);
CREATE TABLE panel_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_uuid uuid NOT NULL REFERENCES admin(uuid) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE panel_push_deliveries (
  event_id bigint NOT NULL REFERENCES panel_events(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES panel_push_subscriptions(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  PRIMARY KEY(event_id,subscription_id)
);
CREATE INDEX panel_push_pending_idx ON panel_push_deliveries(next_attempt_at) WHERE delivered_at IS NULL;
CREATE FUNCTION panel_enqueue_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO panel_push_deliveries(event_id,subscription_id)
    SELECT NEW.id,s.id FROM panel_push_subscriptions s
    JOIN panel_event_preferences p ON p.admin_uuid=s.admin_uuid
    WHERE NEW.type=ANY(p.event_types);
  RETURN NEW;
END $$;
CREATE TRIGGER panel_event_push AFTER INSERT ON panel_events FOR EACH ROW EXECUTE FUNCTION panel_enqueue_push();

CREATE TABLE ssl_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL,
  expires_on date NOT NULL,
  reminder_days integer[] NOT NULL DEFAULT ARRAY[3,2,1],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ssl_certificate_nodes (
  certificate_id uuid NOT NULL REFERENCES ssl_certificates(id) ON DELETE CASCADE,
  node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
  PRIMARY KEY(certificate_id,node_uuid)
);
CREATE TABLE panel_webhook_deliveries (
  event_id bigint NOT NULL REFERENCES panel_events(id) ON DELETE CASCADE,
  destination text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  PRIMARY KEY(event_id,destination)
);
CREATE INDEX panel_webhook_pending_idx ON panel_webhook_deliveries(next_attempt_at) WHERE delivered_at IS NULL;

-- Capture source transitions in the same transaction, including worker/scheduler processes.
CREATE FUNCTION panel_node_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_connected IS DISTINCT FROM OLD.is_connected AND NOT NEW.is_disabled THEN
    INSERT INTO panel_events(source_key,type,severity,title,message,node_uuid)
      VALUES('node:'||gen_random_uuid(), CASE WHEN NEW.is_connected THEN 'node.online' ELSE 'node.offline' END,
        CASE WHEN NEW.is_connected THEN 'success' ELSE 'error' END,
        CASE WHEN NEW.is_connected THEN 'Связь с нодой восстановлена' ELSE 'Нода недоступна' END,
        NEW.name,NEW.uuid);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER panel_node_transition AFTER UPDATE OF is_connected ON nodes FOR EACH ROW EXECUTE FUNCTION panel_node_event();

CREATE FUNCTION panel_metric_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE node_name text; metric_name text;
BEGIN
  SELECT name INTO node_name FROM nodes WHERE uuid=NEW.node_uuid;
  metric_name := CASE NEW.metric WHEN 'cpu' THEN 'ЦП' WHEN 'memory' THEN 'ОЗУ'
    WHEN 'online_drop' THEN 'Падение онлайна' WHEN 'traffic_drop' THEN 'Падение трафика' ELSE NEW.metric END;
  INSERT INTO panel_events(source_key,type,severity,title,message,node_uuid,data)
    VALUES('metric:'||NEW.id,'metric.'||NEW.metric,CASE WHEN NEW.active THEN 'warning' ELSE 'success' END,
      metric_name||CASE WHEN NEW.active THEN ': превышен порог' ELSE ': восстановление' END,
      coalesce(node_name,'Удалённая нода')||' · '||round(NEW.value::numeric,1)||'% / '||NEW.threshold||'%',
      NEW.node_uuid,jsonb_build_object('active',NEW.active,'value',NEW.value,'threshold',NEW.threshold));
  RETURN NEW;
END $$;
CREATE TRIGGER panel_metric_transition AFTER INSERT ON node_metric_alert_events FOR EACH ROW EXECUTE FUNCTION panel_metric_event();

CREATE FUNCTION panel_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO panel_events(source_key,type,severity,title,message,node_uuid,data)
      VALUES('automation:'||NEW.id||':started','automation.triggered','info','Запущена автоматизация',
        coalesce(NEW.rule_name,'Автоматизация'),NEW.node_uuid,jsonb_build_object('executionId',NEW.id,'source',NEW.source));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('failed','partial_failure') THEN
    INSERT INTO panel_events(source_key,type,severity,title,message,node_uuid,data)
      VALUES('automation:'||NEW.id||':failed','automation.failed','error','Ошибка автоматизации',
        coalesce(NEW.rule_name,'Автоматизация'),NEW.node_uuid,jsonb_build_object('executionId',NEW.id,'status',NEW.status))
      ON CONFLICT(source_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER panel_automation_transition AFTER INSERT OR UPDATE OF status ON node_automation_executions
  FOR EACH ROW EXECUTE FUNCTION panel_automation_event();
