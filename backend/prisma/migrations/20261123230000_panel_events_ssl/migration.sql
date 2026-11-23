-- Event history is independent of Telegram, webhooks and a user's browser permissions.
-- Node identifiers/names are snapshots: deleting a node must not erase its history.
CREATE TABLE panel_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    type text NOT NULL CHECK (type IN (
        'node.connection_lost','node.connection_restored','automation.triggered','automation.failed',
        'billing.payment_due','ssl.expiring','ssl.expired','node.cpu_high','node.cpu_recovered',
        'node.memory_high','node.memory_recovered','node.online_drop','node.online_recovered',
        'node.traffic_drop','node.traffic_recovered'
    )),
    severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
    title text NOT NULL,
    message text NOT NULL,
    node_uuid uuid,
    node_name text,
    source_key text NOT NULL UNIQUE,
    data jsonb NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX panel_events_type_sequence_idx ON panel_events(type,sequence DESC);
CREATE INDEX panel_events_severity_sequence_idx ON panel_events(severity,sequence DESC);
CREATE INDEX panel_events_node_sequence_idx ON panel_events(node_uuid,sequence DESC);

CREATE TABLE panel_event_read_state (
    admin_uuid uuid PRIMARY KEY REFERENCES admin(uuid) ON DELETE CASCADE,
    last_seen_sequence bigint NOT NULL DEFAULT 0 CHECK (last_seen_sequence>=0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Receipts make read status exact even when an earlier insert commits after a read.
CREATE TABLE panel_event_reads (
    admin_uuid uuid NOT NULL REFERENCES admin(uuid) ON DELETE CASCADE,
    event_id uuid NOT NULL REFERENCES panel_events(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(admin_uuid,event_id)
);
CREATE INDEX panel_event_reads_event_idx ON panel_event_reads(event_id);

CREATE TABLE panel_notification_preferences (
    admin_uuid uuid PRIMARY KEY REFERENCES admin(uuid) ON DELETE CASCADE,
    browser_enabled boolean NOT NULL DEFAULT false,
    push_enabled boolean NOT NULL DEFAULT false,
    push_enabled_at timestamptz,
    event_types text[] NOT NULL DEFAULT ARRAY[
        'node.connection_lost','node.connection_restored','automation.triggered','automation.failed',
        'billing.payment_due','ssl.expiring','ssl.expired','node.cpu_high','node.cpu_recovered',
        'node.memory_high','node.memory_recovered','node.online_drop','node.online_recovered',
        'node.traffic_drop','node.traffic_recovered'
    ]::text[],
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ssl_certificates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL,
    domains text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL,
    reminder_days integer[] NOT NULL DEFAULT ARRAY[3,2,1],
    enabled boolean NOT NULL DEFAULT true,
    expiry_revision integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES admin(uuid) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expiry_revision>0),
    CHECK (cardinality(reminder_days)<=20 AND 0<ALL(reminder_days) AND 365>=ALL(reminder_days))
);
CREATE INDEX ssl_certificates_expiry_idx ON ssl_certificates(expires_at) WHERE enabled;
CREATE TABLE ssl_certificate_nodes (
    certificate_id uuid NOT NULL REFERENCES ssl_certificates(id) ON DELETE CASCADE,
    node_uuid uuid NOT NULL REFERENCES nodes(uuid) ON DELETE CASCADE,
    PRIMARY KEY(certificate_id,node_uuid)
);
CREATE INDEX ssl_certificate_nodes_node_idx ON ssl_certificate_nodes(node_uuid);

-- An outbox persists the handoff to the existing signed Remnawave webhook queue.
CREATE TABLE panel_event_webhooks (
    event_id uuid PRIMARY KEY REFERENCES panel_events(id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    lease_token uuid,
    enqueued_at timestamptz
);
CREATE INDEX panel_event_webhooks_pending_idx ON panel_event_webhooks(next_attempt_at) WHERE enqueued_at IS NULL;

CREATE FUNCTION panel_append_event(
    p_type text, p_severity text, p_title text, p_message text,
    p_node_uuid uuid, p_node_name text, p_source_key text, p_data jsonb,
    p_occurred_at timestamptz
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE event_id uuid;
BEGIN
    -- Shared locks permit concurrent writers. Feed reads take the exclusive lock
    -- before opening their committed snapshot; this closes sequence allocation gaps.
    PERFORM pg_advisory_xact_lock_shared(681754210::bigint);
    INSERT INTO panel_events(type,severity,title,message,node_uuid,node_name,source_key,data,occurred_at)
    VALUES(p_type,p_severity,p_title,p_message,p_node_uuid,p_node_name,p_source_key,p_data,p_occurred_at)
    ON CONFLICT(source_key) DO NOTHING RETURNING id INTO event_id;
    RETURN event_id;
END;
$$;

CREATE FUNCTION panel_node_connection_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE restored boolean;
BEGIN
    -- Administrative disabling is intentional, and must not be reported as an outage.
    IF OLD.is_connected IS NOT DISTINCT FROM NEW.is_connected OR NEW.is_disabled THEN RETURN NEW; END IF;
    restored := NEW.is_connected;
    PERFORM panel_append_event(
        CASE WHEN restored THEN 'node.connection_restored' ELSE 'node.connection_lost' END,
        CASE WHEN restored THEN 'info' ELSE 'critical' END,
        CASE WHEN restored THEN 'Нода восстановлена' ELSE 'Нода недоступна' END,
        format('Нода «%s»: %s.', NEW.name, CASE WHEN restored THEN 'соединение восстановлено' ELSE 'соединение потеряно' END),
        NEW.uuid, NEW.name, 'node-connection:'||gen_random_uuid()::text,
        jsonb_build_object('nodeUuid',NEW.uuid,'connected',restored), clock_timestamp()
    );
    RETURN NEW;
END;
$$;
CREATE TRIGGER panel_node_connection AFTER UPDATE OF is_connected ON nodes
    FOR EACH ROW EXECUTE FUNCTION panel_node_connection_event();

CREATE FUNCTION panel_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE node_name text; rule_name text;
BEGIN
    SELECT name INTO node_name FROM nodes WHERE uuid=NEW.node_uuid;
    rule_name := coalesce(NEW.rule_name,'Удалённое правило');
    IF TG_OP='INSERT' THEN
        PERFORM panel_append_event('automation.triggered','info','Автоматизация запущена',
            format('Правило «%s» запущено %s.',rule_name,CASE WHEN NEW.source='manual' THEN 'вручную' ELSE 'по условию' END),
            NEW.node_uuid,node_name,'automation:'||NEW.id::text||':triggered',
            jsonb_build_object('executionId',NEW.id,'ruleId',NEW.rule_id,'ruleName',rule_name,'source',NEW.source),NEW.started_at);
    ELSIF NEW.status IN ('failed','partial_failure') AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM panel_append_event('automation.failed',CASE WHEN NEW.status='failed' THEN 'critical' ELSE 'warning' END,
            'Ошибка автоматизации',format('Правило «%s»: %s.',rule_name,CASE WHEN NEW.status='failed' THEN 'выполнение завершилось ошибкой' ELSE 'часть действий не выполнена' END),
            NEW.node_uuid,node_name,'automation:'||NEW.id::text||':'||NEW.status,
            jsonb_build_object('executionId',NEW.id,'ruleId',NEW.rule_id,'ruleName',rule_name,'status',NEW.status),coalesce(NEW.finished_at,clock_timestamp()));
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER panel_automation_execution AFTER INSERT OR UPDATE OF status ON node_automation_executions
    FOR EACH ROW EXECUTE FUNCTION panel_automation_event();

CREATE FUNCTION panel_metric_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE node_name text; metric_name text; event_type text;
BEGIN
    SELECT name INTO node_name FROM nodes WHERE uuid=NEW.node_uuid;
    CASE NEW.metric
        WHEN 'cpu' THEN metric_name:='ЦП'; event_type:=CASE WHEN NEW.active THEN 'node.cpu_high' ELSE 'node.cpu_recovered' END;
        WHEN 'memory' THEN metric_name:='ОЗУ'; event_type:=CASE WHEN NEW.active THEN 'node.memory_high' ELSE 'node.memory_recovered' END;
        WHEN 'online_drop' THEN metric_name:='Падение онлайна'; event_type:=CASE WHEN NEW.active THEN 'node.online_drop' ELSE 'node.online_recovered' END;
        WHEN 'traffic_drop' THEN metric_name:='Падение трафика'; event_type:=CASE WHEN NEW.active THEN 'node.traffic_drop' ELSE 'node.traffic_recovered' END;
        ELSE RETURN NEW;
    END CASE;
    PERFORM panel_append_event(event_type,CASE WHEN NEW.active THEN 'warning' ELSE 'info' END,
        CASE WHEN NEW.active THEN metric_name||': превышен порог' ELSE metric_name||': показатель восстановлен' END,
        format('Нода «%s»: %s — %s%%, порог %s%%.',coalesce(node_name,NEW.node_uuid::text),metric_name,round(NEW.value::numeric,1),round(NEW.threshold::numeric,1)),
        NEW.node_uuid,node_name,'metric:'||NEW.id::text,
        jsonb_build_object('metric',NEW.metric,'active',NEW.active,'value',NEW.value,'threshold',NEW.threshold),NEW.created_at);
    RETURN NEW;
END;
$$;
CREATE TRIGGER panel_metric_alert AFTER INSERT ON node_metric_alert_events
    FOR EACH ROW EXECUTE FUNCTION panel_metric_event();
