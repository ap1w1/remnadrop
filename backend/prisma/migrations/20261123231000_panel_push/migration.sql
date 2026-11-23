-- Web Push credentials are encrypted with the stable application secret. The
-- delivery ledger allows multiple schedulers to retry without duplicating jobs.
CREATE TABLE panel_push_vapid (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    subject TEXT NOT NULL,
    iv BYTEA NOT NULL,
    tag BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE panel_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_uuid UUID NOT NULL REFERENCES admin(uuid) ON DELETE CASCADE,
    endpoint_hash TEXT NOT NULL UNIQUE,
    iv BYTEA NOT NULL,
    tag BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_success_at TIMESTAMPTZ
);
CREATE INDEX panel_push_subscriptions_admin_idx ON panel_push_subscriptions(admin_uuid);

CREATE TABLE panel_push_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES panel_events(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES panel_push_subscriptions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    UNIQUE(event_id,subscription_id)
);
CREATE INDEX panel_push_deliveries_pending_idx ON panel_push_deliveries(next_attempt_at)
    WHERE status IN ('pending','sending');
