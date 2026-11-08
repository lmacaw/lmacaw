CREATE TABLE login_attempts (
  client_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL
);
