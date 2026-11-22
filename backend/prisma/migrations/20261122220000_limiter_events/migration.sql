-- Keep existing events and enrich all future alerts with the complete engine evidence.
ALTER TABLE limiter_events ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE limiter_events ADD COLUMN user_id bigint;
ALTER TABLE limiter_events ADD COLUMN unique_ip_count integer;
ALTER TABLE limiter_events ADD COLUMN connection_count integer;
ALTER TABLE limiter_events ADD COLUMN violations_24h integer;
ALTER TABLE limiter_events ADD COLUMN occurred_at timestamptz;
CREATE INDEX limiter_events_user_recent_idx ON limiter_events(user_uuid, created_at DESC);
CREATE INDEX limiter_events_type_recent_idx ON limiter_events(event_type, created_at DESC);

CREATE TABLE limiter_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid uuid REFERENCES users(uuid) ON DELETE SET NULL,
  user_id bigint NOT NULL,
  username text NOT NULL,
  action text NOT NULL,
  minutes integer,
  source text NOT NULL,
  success boolean NOT NULL,
  message text,
  request_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX limiter_actions_user_recent_idx ON limiter_actions(user_uuid,created_at DESC);
