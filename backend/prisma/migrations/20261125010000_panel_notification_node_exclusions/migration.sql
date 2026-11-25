ALTER TABLE panel_event_preferences
  ADD COLUMN excluded_node_uuids uuid[] NOT NULL DEFAULT '{}';
