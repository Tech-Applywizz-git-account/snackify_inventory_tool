-- Applywizz Digital Cafeteria Card (12-digit PAN assigned by admin).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cafeteria_card_number text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS cafeteria_card_number_12digits;

ALTER TABLE public.profiles
  ADD CONSTRAINT cafeteria_card_number_12digits
  CHECK (
    cafeteria_card_number IS NULL
    OR cafeteria_card_number ~ '^[0-9]{12}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_cafeteria_card_number_uidx
  ON public.profiles (cafeteria_card_number)
  WHERE cafeteria_card_number IS NOT NULL;
