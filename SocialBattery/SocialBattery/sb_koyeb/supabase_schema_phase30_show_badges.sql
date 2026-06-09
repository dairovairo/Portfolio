-- Phase 30: Privacy toggle — show_badges
-- show_badges: when false, the badges section is hidden from other users' profile views

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS show_badges boolean NOT NULL DEFAULT true;
