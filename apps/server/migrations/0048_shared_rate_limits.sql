-- Shared request counters for the optional database-backed rate limit (RATE_LIMIT_SHARED=true).
-- One row per scope, client address and minute. Rows older than an hour are removed by the
-- maintenance loop. No tenant column: the limit is about the client, not a workspace.
CREATE TABLE rate_limit_windows (
  scope text NOT NULL CHECK (scope IN ('global', 'auth')),
  client text NOT NULL CHECK (char_length(client) <= 64),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (scope, client, window_start)
);
