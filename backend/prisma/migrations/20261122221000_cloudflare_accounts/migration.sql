-- Preserve the existing connection while adding isolated Cloudflare token accounts.
CREATE TABLE cf_dns_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  credential_source text NOT NULL DEFAULT 'stored' CHECK (credential_source IN ('stored', 'environment')),
  iv bytea,
  tag bytea,
  ciphertext bytea,
  zone_count integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((credential_source = 'stored' AND iv IS NOT NULL AND tag IS NOT NULL AND ciphertext IS NOT NULL)
      OR (credential_source = 'environment' AND iv IS NULL AND tag IS NULL AND ciphertext IS NULL))
);

-- Keep the encryption format/key derivation; ciphertext never becomes plaintext.
INSERT INTO cf_dns_accounts(id, name, iv, tag, ciphertext, updated_at)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'Основной аккаунт', iv, tag, ciphertext, updated_at
FROM cf_dns_credentials WHERE id = 1;

INSERT INTO cf_dns_accounts(id, name, credential_source)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'Основной аккаунт', 'environment'
WHERE EXISTS (SELECT 1 FROM cf_dns_zone_bindings)
   OR EXISTS (SELECT 1 FROM cf_dns_record_host_links)
   OR EXISTS (SELECT 1 FROM cf_dns_events)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE cf_dns_zone_bindings
  ADD COLUMN account_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  DROP CONSTRAINT cf_dns_zone_bindings_pkey,
  ADD PRIMARY KEY (account_id, domain),
  ADD CONSTRAINT cf_dns_zone_bindings_account_fk FOREIGN KEY (account_id) REFERENCES cf_dns_accounts(id) ON DELETE CASCADE;
CREATE INDEX cf_dns_zone_bindings_account_zone_idx ON cf_dns_zone_bindings(account_id, zone_id);

ALTER TABLE cf_dns_record_host_links
  ADD COLUMN account_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  DROP CONSTRAINT cf_dns_record_host_links_pkey,
  ADD PRIMARY KEY (account_id, zone_id, record_id, host_uuid),
  ADD CONSTRAINT cf_dns_record_host_links_account_fk FOREIGN KEY (account_id) REFERENCES cf_dns_accounts(id) ON DELETE CASCADE;

ALTER TABLE cf_dns_events
  ADD COLUMN account_id uuid REFERENCES cf_dns_accounts(id) ON DELETE SET NULL,
  ADD COLUMN account_name text;
UPDATE cf_dns_events SET account_id = '00000000-0000-4000-8000-000000000001', account_name = 'Основной аккаунт';
CREATE INDEX cf_dns_events_account_recent_idx ON cf_dns_events(account_id, created_at DESC);

-- Keep the legacy table for schema compatibility, with one active credential store.
DELETE FROM cf_dns_credentials;
