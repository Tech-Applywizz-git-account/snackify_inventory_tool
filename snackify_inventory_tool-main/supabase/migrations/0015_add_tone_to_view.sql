-- =====================================================================
-- Migration 0015: Add notification_tone to v_request_queue view
-- =====================================================================

-- Drop the existing view first to avoid column mismatch errors
DROP VIEW IF EXISTS public.v_request_queue CASCADE;

-- Recreate v_request_queue view joining employee_cafeteria_preferences
CREATE VIEW public.v_request_queue AS
SELECT
  r.id, r.raw_text, r.category, r.parsed_item,
  r.parsed_employee_name, r.parsed_location, r.instruction,
  r.status, r.live_status, r.submitted_by, r.assigned_to,
  r.fulfilled_by, r.created_at, r.updated_at, r.fulfilled_at,
  r.notes, r.priority, r.rating, r.feedback, r.rating_status,
  r.accepted_at, r.started_at, r.on_the_way_at, r.cancelled_at,
  p.full_name AS submitter_name,
  COALESCE(pref.notification_tone, 'Friendly') AS notification_tone
FROM requests r
LEFT JOIN profiles p ON p.id = r.submitted_by
LEFT JOIN employee_cafeteria_preferences pref ON pref.user_id = r.submitted_by;
