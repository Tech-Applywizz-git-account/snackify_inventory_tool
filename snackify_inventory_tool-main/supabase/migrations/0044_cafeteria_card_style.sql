-- Card look-and-feel chosen by the employee (color + name on card).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cafeteria_card_color text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cafeteria_card_display_name text;
