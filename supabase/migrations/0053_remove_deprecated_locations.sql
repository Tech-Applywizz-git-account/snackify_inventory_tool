-- Remove deprecated delivery locations from existing user preferences.
UPDATE public.employee_cafeteria_preferences
SET preferred_location = NULL
WHERE preferred_location IN ('Ask Every Time', 'Conference Room', 'Conference Hall');
