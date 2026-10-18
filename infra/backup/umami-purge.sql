-- Audience data older than 25 months (Franck, 2026-10-19; CNIL guidance for
-- audience measurement). Umami deletes nothing by itself, and its tables have
-- no cascading deletes: children first, then the sessions left without any
-- event. One transaction: a failed run leaves nothing half-deleted.
BEGIN;
DELETE FROM event_data WHERE created_at < now() - interval '25 months';
DELETE FROM revenue WHERE created_at < now() - interval '25 months';
DELETE FROM website_event WHERE created_at < now() - interval '25 months';
DELETE FROM session_data WHERE created_at < now() - interval '25 months';
DELETE FROM session s
WHERE s.created_at < now() - interval '25 months'
  AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id)
  AND NOT EXISTS (SELECT 1 FROM session_data d WHERE d.session_id = s.session_id)
  AND NOT EXISTS (SELECT 1 FROM revenue r WHERE r.session_id = s.session_id);
COMMIT;
