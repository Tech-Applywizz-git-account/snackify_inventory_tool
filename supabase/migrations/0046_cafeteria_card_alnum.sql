-- Admin-assigned cafeteria codes may include letters and any length (1–24).
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS cafeteria_card_number_12digits;

ALTER TABLE public.profiles
  ADD CONSTRAINT cafeteria_card_number_alnum
    CHECK (
      cafeteria_card_number IS NULL
      OR cafeteria_card_number ~ '^[A-Za-z0-9]{1,24}$'
    );
