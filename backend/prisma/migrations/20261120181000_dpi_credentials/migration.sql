-- Encrypted credentials only; never persist raw API tokens.
CREATE TABLE dpi_checker_credentials (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
    iv bytea NOT NULL,
    tag bytea NOT NULL,
    ciphertext bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
