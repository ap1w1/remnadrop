ALTER TABLE node_automation_rules DROP CONSTRAINT node_automation_trigger_type_check;
ALTER TABLE node_automation_rules ADD CONSTRAINT node_automation_trigger_type_check
  CHECK (trigger_type IN ('online_drop','online_value','node_offline','node_recovered','interval','manual'));
ALTER TABLE node_automation_rules DROP CONSTRAINT node_automation_trigger_node_check;
ALTER TABLE node_automation_rules ADD CONSTRAINT node_automation_trigger_node_check
  CHECK (trigger_type NOT IN ('online_drop','online_value','node_offline','node_recovered') OR node_uuid IS NOT NULL);
