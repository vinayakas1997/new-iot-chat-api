-- Seed for the test-postgres compose service: a miniature plant DB the
-- setter can connect to from F1 (host: localhost:5432, db: plant).
CREATE TABLE IF NOT EXISTS readings_temp (
  ts TIMESTAMPTZ NOT NULL,
  temp_c DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS prod_count (
  ts TIMESTAMPTZ NOT NULL,
  pcs INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS downtime_events (
  ts TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  minutes INTEGER NOT NULL
);

INSERT INTO readings_temp (ts, temp_c) VALUES
  (now() - interval '2 hours', 71.5),
  (now() - interval '1 hour', 72.1),
  (now(), 70.8);
INSERT INTO prod_count (ts, pcs) VALUES
  (now() - interval '2 hours', 118),
  (now() - interval '1 hour', 124),
  (now(), 121);
INSERT INTO downtime_events (ts, reason, minutes) VALUES
  (now() - interval '3 hours', 'changeover', 12);
