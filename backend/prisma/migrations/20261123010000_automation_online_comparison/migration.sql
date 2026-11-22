-- Count-based online comparisons use fresh node metrics and retain existing rules unchanged.
ALTER TABLE node_automation_rules
  ADD COLUMN online_operator text NOT NULL DEFAULT 'lt',
  ADD COLUMN online_value integer NOT NULL DEFAULT 10;

ALTER TABLE node_automation_rules
  ADD CONSTRAINT node_automation_online_operator_check CHECK (online_operator IN ('gt','lt','eq')),
  ADD CONSTRAINT node_automation_online_value_check CHECK (online_value BETWEEN 0 AND 1000000);

ALTER TABLE node_automation_rules DROP CONSTRAINT node_automation_trigger_type_check;
ALTER TABLE node_automation_rules ADD CONSTRAINT node_automation_trigger_type_check
  CHECK (trigger_type IN ('online_drop','online_value','node_offline','interval','manual'));

ALTER TABLE node_automation_rules DROP CONSTRAINT node_automation_trigger_node_check;
ALTER TABLE node_automation_rules ADD CONSTRAINT node_automation_trigger_node_check
  CHECK (trigger_type NOT IN ('online_drop','online_value','node_offline') OR node_uuid IS NOT NULL);
