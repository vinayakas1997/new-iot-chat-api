-- Re-seed for the test-postgres compose service: fresh demo rows relative
-- to now(). Safe to re-run any time data goes stale — pure INSERTs, no
-- DDL, no deletes. Run with:
--   docker exec -i app-test-postgres-1 psql -U plant -d plant < reseed.sql
-- or from host:
--   psql -h localhost -U plant -d plant -f reseed.sql   (password: plant)
INSERT INTO readings_temp (ts, temp_c) VALUES
  (now() - interval '110 minutes', 71.2),
  (now() - interval '95 minutes', 71.8),
  (now() - interval '80 minutes', 72.4),
  (now() - interval '65 minutes', 72.0),
  (now() - interval '50 minutes', 71.6),
  (now() - interval '35 minutes', 72.7),
  (now() - interval '20 minutes', 73.1),
  (now() - interval '5 minutes', 72.3);
INSERT INTO prod_count (ts, pcs) VALUES
  (now() - interval '110 minutes', 118),
  (now() - interval '80 minutes', 124),
  (now() - interval '50 minutes', 131),
  (now() - interval '20 minutes', 127);
INSERT INTO downtime_events (ts, reason, minutes) VALUES
  (now() - interval '45 minutes', 'changeover', 8);
