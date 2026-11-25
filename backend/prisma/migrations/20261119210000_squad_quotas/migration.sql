CREATE TABLE user_squad_quotas (
 user_uuid uuid NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
 squad_uuid uuid NOT NULL REFERENCES internal_squads(uuid) ON DELETE CASCADE,
 limit_bytes bigint CHECK (limit_bytes >= 0),
 used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
 blocked boolean NOT NULL DEFAULT false,
 period_days integer CHECK (period_days BETWEEN 1 AND 366),
 reset_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_uuid, squad_uuid)
);
CREATE TABLE quota_usage_receipts (
 event_id text PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quota_sync (
 user_uuid uuid PRIMARY KEY REFERENCES users(uuid) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quota_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_uuid uuid NOT NULL,
 squad_uuid uuid NOT NULL,
 event text NOT NULL,
 used_bytes bigint NOT NULL,
 limit_bytes bigint,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX squad_quotas_reset_idx ON user_squad_quotas(reset_at) WHERE reset_at IS NOT NULL;

CREATE FUNCTION guard_quota_squad_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM user_squad_quotas q JOIN users u ON u.uuid=q.user_uuid
            WHERE u.t_id=NEW.user_id AND q.squad_uuid=NEW.internal_squad_uuid AND q.blocked) THEN
   RAISE EXCEPTION 'SQUAD_QUOTA_EXHAUSTED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_quota_squad_membership BEFORE INSERT OR UPDATE ON internal_squad_members
FOR EACH ROW EXECUTE FUNCTION guard_quota_squad_membership();
