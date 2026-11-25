-- Upstream Limiter 5.1.0 settings and webhook audit; engine starts only when opt-in enabled.
CREATE TABLE limiter_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scan_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO limiter_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

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
  webhook_sha256 text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX limiter_events_recent_idx ON limiter_events (created_at DESC);

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

CREATE TABLE cf_dns_webhook_receipts (
  event_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Explicit host-record bindings cover hosts configured with raw IP addresses.
CREATE TABLE cf_dns_record_host_links (
  zone_id text NOT NULL CHECK(zone_id ~ '^[0-9a-f]{32}$'),
  record_id text NOT NULL CHECK(record_id ~ '^[0-9a-f]{32}$'),
  host_uuid uuid NOT NULL REFERENCES hosts(uuid) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(zone_id,record_id,host_uuid)
);
CREATE INDEX cf_dns_record_host_links_host_idx ON cf_dns_record_host_links(host_uuid);

-- Optional secret configuration managed from Limiter tab.
CREATE TABLE limiter_credentials (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
 iv bytea NOT NULL,
 tag bytea NOT NULL,
 ciphertext bytea NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
