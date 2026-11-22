-- Opt-in limiter settings and audit trail; never auto-disable until configured.
CREATE TABLE limiter_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scan_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO limiter_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE limiter_user_counters (
  user_uuid uuid PRIMARY KEY REFERENCES users(uuid) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  last_action_at timestamptz
);
CREATE TABLE limiter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid uuid REFERENCES users(uuid) ON DELETE SET NULL,
  username text NOT NULL,
  event_type text NOT NULL,
  mode text NOT NULL,
  device_limit integer NOT NULL,
  observed_count integer NOT NULL,
  ips jsonb NOT NULL DEFAULT '[]'::jsonb,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX limiter_events_recent_idx ON limiter_events (created_at DESC);
CREATE TABLE limiter_restores (
  user_uuid uuid PRIMARY KEY REFERENCES users(uuid) ON DELETE CASCADE,
  restore_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cloudflare credentials are AES-256-GCM encrypted with a stable server-side secret.
CREATE TABLE cf_dns_credentials (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
  iv bytea NOT NULL,
  tag bytea NOT NULL,
  ciphertext bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cf_dns_zone_bindings (
  domain text PRIMARY KEY,
  zone_id text NOT NULL CHECK (zone_id ~ '^[a-f0-9]{32}$'),
  auto_sync boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cf_dns_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id text NOT NULL,
  record_id text,
  record_name text NOT NULL,
  node_uuid uuid REFERENCES nodes(uuid) ON DELETE SET NULL,
  old_ip inet,
  new_ip inet,
  source text NOT NULL,
  status text NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cf_dns_events_recent_idx ON cf_dns_events (created_at DESC);
