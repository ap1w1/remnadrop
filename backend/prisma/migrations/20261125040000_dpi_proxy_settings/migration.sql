CREATE TABLE dpi_checker_proxy_settings (
  id integer PRIMARY KEY CHECK (id=1),
  iv bytea NOT NULL,
  tag bytea NOT NULL,
  ciphertext bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
