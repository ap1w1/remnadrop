-- Keep existing online-drop rules intact while adding domain-only workflows.
ALTER TABLE node_automation_rules
  ALTER COLUMN node_uuid DROP NOT NULL,
  ADD COLUMN trigger_type text NOT NULL DEFAULT 'online_drop',
  ADD COLUMN interval_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN failure_policy text NOT NULL DEFAULT 'continue',
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN active_execution_id uuid,
  ADD COLUMN execution_lease_until timestamptz;

ALTER TABLE node_automation_rules
  ADD CONSTRAINT node_automation_trigger_type_check
    CHECK (trigger_type IN ('online_drop', 'node_offline', 'interval', 'manual')),
  ADD CONSTRAINT node_automation_interval_check
    CHECK (interval_minutes BETWEEN 5 AND 525600),
  ADD CONSTRAINT node_automation_failure_policy_check
    CHECK (failure_policy IN ('stop', 'continue')),
  ADD CONSTRAINT node_automation_trigger_node_check
    CHECK (trigger_type NOT IN ('online_drop', 'node_offline') OR node_uuid IS NOT NULL);

ALTER TABLE node_automation_executions
  ADD COLUMN source text NOT NULL DEFAULT 'automatic',
  ADD COLUMN rule_name text,
  ADD COLUMN node_uuid uuid,
  ADD COLUMN trigger_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN rule_snapshot jsonb NOT NULL DEFAULT '{}';

UPDATE node_automation_executions e
SET rule_name=r.name, node_uuid=r.node_uuid,
    rule_snapshot=jsonb_build_object('name',r.name,'nodeUuid',r.node_uuid,'actions',r.actions)
FROM node_automation_rules r WHERE r.id=e.rule_id;

-- Audit history remains available when an administrator deletes a rule.
ALTER TABLE node_automation_executions
  DROP CONSTRAINT node_automation_executions_rule_id_fkey,
  ALTER COLUMN rule_id DROP NOT NULL;
ALTER TABLE node_automation_executions
  ADD CONSTRAINT node_automation_executions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES node_automation_rules(id) ON DELETE SET NULL,
  ADD CONSTRAINT node_automation_execution_source_check
    CHECK (source IN ('automatic','manual'));

CREATE INDEX node_automation_executions_recent_idx
  ON node_automation_executions(started_at DESC, id DESC);
CREATE INDEX node_automation_executions_rule_recent_idx
  ON node_automation_executions(rule_id, started_at DESC, id DESC);
