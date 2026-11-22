-- Durable outbound signed events for external Limiter webhook consumers.
CREATE TABLE limiter_outbound_webhook_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  event_type text NOT NULL,
  destination_hash text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX limiter_outbound_pending_idx ON limiter_outbound_webhook_queue
  (next_attempt_at,created_at) WHERE delivered_at IS NULL;
