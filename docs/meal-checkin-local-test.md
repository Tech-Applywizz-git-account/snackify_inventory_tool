# Meal QR Check-In: Local Test Setup

The check-in feature lives in `backend/src/features/mealCheckin/` and `frontend/src/features/mealCheckin/`. Existing booking and token charging behavior is unchanged. The scanner page is available to leadership, office boy, and admin roles.

## Setup

1. Apply `supabase/migrations/0054_meal_checkins.sql` to the Supabase project. The backend reads and writes successful check-ins in `public.meal_checkins`; the table has a unique constraint on `meal_booking_id` to prevent repeat servings.
2. Keep the existing backend Supabase URL and service-role key configuration. For deployments, set `MEAL_CHECKIN_QR_SECRET` to a dedicated random secret of at least 32 characters. If omitted, QR signatures use the configured service-role key.
3. Optionally set `MEAL_CHECKIN_SERVICE_CLOSE_IST` to set the day-shift report cutoff in `HH:mm` format. It defaults to `14:00` India time. Night-shift reports close at `00:00` IST immediately after the selected service date.
4. Start the backend and frontend with the project's normal development commands.

## Test the Workflow

1. Sign in as an employee and book an eligible meal. After completing the booking, **My Meal Box** opens for the booked date and displays the meal QR and manual check-in code. Opening **My Meal Box** without a date also finds the next upcoming eligible booked meal if there is no booking for the current default date.
2. Sign in as `leadership`, then open **Vendor Meal Check-in** in the portal navigation or go to `/vendor/meal-check-in`.
3. Scan the employee QR or paste its manual code. A valid scan displays the employee and meal, records the serving, and updates the counts.
4. Scan the same QR again. The page should report **Already served** and leave the totals unchanged.
5. Check the vendor dashboard's daily serving total. It is calculated from that date's rows in `public.meal_checkins`, including the count by meal choice and the latest serving time.
6. Unchecked bookings remain **Not yet served** until the configured service cutoff; after the cutoff they appear as **No-show**.

The QR scan token is generated for the booked meal when the QR is requested. The printed cabin token number remains assigned by the existing scheduled print workflow and may show as pending until then. Camera scanning requires browser camera permission and a secure context. `http://localhost` is treated as secure by modern browsers. Manual token entry remains available if camera access is denied.