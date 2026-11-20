CREATE FUNCTION guard_quota_topology() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(714920260001::bigint);
 IF EXISTS (
  SELECT 1 FROM user_squad_quotas q
  JOIN users u ON u.uuid=q.user_uuid
  JOIN internal_squad_members own_member ON own_member.user_id=u.t_id AND own_member.internal_squad_uuid=q.squad_uuid
  JOIN internal_squad_inbounds own ON own.internal_squad_uuid=q.squad_uuid
  JOIN config_profile_inbounds_to_nodes a ON a.config_profile_inbound_uuid=own.inbound_uuid
  JOIN config_profile_inbounds_to_nodes b ON b.node_uuid=a.node_uuid
  JOIN internal_squad_inbounds other ON other.inbound_uuid=b.config_profile_inbound_uuid
  JOIN internal_squad_members other_member ON other_member.user_id=u.t_id AND other_member.internal_squad_uuid=other.internal_squad_uuid
  WHERE q.limit_bytes IS NOT NULL AND other.internal_squad_uuid<>q.squad_uuid
 ) THEN
  RAISE EXCEPTION 'AMBIGUOUS_NODE_SQUAD_USAGE: limited squads must not share a node with another squad of the same user' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER guard_quota_topology AFTER INSERT OR UPDATE ON internal_squad_members FOR EACH STATEMENT EXECUTE FUNCTION guard_quota_topology();
CREATE TRIGGER guard_quota_topology AFTER INSERT OR UPDATE ON internal_squad_inbounds FOR EACH STATEMENT EXECUTE FUNCTION guard_quota_topology();
CREATE TRIGGER guard_quota_topology AFTER INSERT OR UPDATE ON config_profile_inbounds_to_nodes FOR EACH STATEMENT EXECUTE FUNCTION guard_quota_topology();
