-- Remove the Guest prefix from existing guest profile names.
-- Keep the entered name when available; use the profile email prefix only
-- when the old value was just Guest or Guest (...).

update public.profiles p
set
  full_name = coalesce(
    nullif(
      regexp_replace(
        regexp_replace(trim(p.full_name), '^guest[[:space:]]*', '', 1, 0, 'i'),
        '^[()]|[()]$', '', 'g'
      ),
      ''
    ),
    case
      when lower(coalesce(p.email, '')) <> '' then split_part(lower(p.email), '@', 1)
      when lower(coalesce(u.email, '')) !~ '^guest_[0-9]+_' then split_part(lower(u.email), '@', 1)
      else null
    end,
    'User'
  ),
  preferred_name = coalesce(
    nullif(
      regexp_replace(
        regexp_replace(trim(p.preferred_name), '^guest[[:space:]]*', '', 1, 0, 'i'),
        '^[()]|[()]$', '', 'g'
      ),
      ''
    ),
    case
      when lower(coalesce(p.email, '')) <> '' then split_part(lower(p.email), '@', 1)
      when lower(coalesce(u.email, '')) !~ '^guest_[0-9]+_' then split_part(lower(u.email), '@', 1)
      else null
    end,
    'User'
  )
from auth.users u
where p.id = u.id
  and (
    trim(p.full_name) ~* '^guest([[:space:]]|$)'
    or trim(p.preferred_name) ~* '^guest([[:space:]]|$)'
  );
