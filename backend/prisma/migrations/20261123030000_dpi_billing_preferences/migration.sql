-- Record DPI Checker spending in Infrastructure Billing only when explicitly enabled.
-- The receipt table deduplicates each upstream-paid job even across scheduler restarts.
CREATE TABLE dpi_checker_billing_settings (
    id smallint PRIMARY KEY CHECK (id=1),
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dpi_checker_billing_settings(id,enabled) VALUES (1,false);

CREATE TABLE dpi_checker_billing_receipts (
    job_id uuid PRIMARY KEY,
    record_uuid uuid NOT NULL UNIQUE,
    amount_usd double precision NOT NULL CHECK(amount_usd>0 AND amount_usd<10000000),
    created_at timestamptz NOT NULL DEFAULT now()
);
