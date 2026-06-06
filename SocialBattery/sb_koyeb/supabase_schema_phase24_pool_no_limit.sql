-- Phase 24: allow NULL max_people on hangout_pools (= sin límite de participantes)
-- Previously the column was NOT NULL DEFAULT 4; now NULL means "unlimited".

-- 1. Drop the old NOT NULL + check constraint
ALTER TABLE public.hangout_pools
  ALTER COLUMN max_people DROP NOT NULL,
  ALTER COLUMN max_people DROP DEFAULT;

-- 2. Replace the check constraint to allow NULL
ALTER TABLE public.hangout_pools
  DROP CONSTRAINT IF EXISTS hangout_pools_max_people_check;

ALTER TABLE public.hangout_pools
  ADD CONSTRAINT hangout_pools_max_people_check
  CHECK (max_people IS NULL OR (max_people >= 2 AND max_people <= 50));

-- 3. Existing pools that have max_people = 4 (old default) keep their value.
--    Only new pools created without a limit will get NULL.
