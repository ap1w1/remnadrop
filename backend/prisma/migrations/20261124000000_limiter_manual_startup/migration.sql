-- Recover installations left disabled after the panel lost PostgreSQL.
-- Only manual mode is started; existing automatic blocking remains opt-in.
UPDATE limiter_settings
SET config = jsonb_set(config, '{enabled}', 'true'::jsonb, true),
    updated_at = now()
WHERE COALESCE(config->>'mode', 'manual') = 'manual'
  AND (
    NOT (config ? 'enabled')
    OR (
      config->>'enabled' = 'false'
      AND last_error ILIKE '%database server%'
    )
  );
