-- Phase 72: fix push_subscriptions so a browser/device endpoint can only
-- belong to ONE user at a time.
--
-- Bug: push_subscriptions had UNIQUE(user_id, endpoint), and
-- POST /api/users/push-subscribe upserted with onConflict: 'user_id,endpoint'.
-- A push subscription "endpoint" identifies a specific browser install on a
-- specific device, NOT a user. If a second account ever logged in and
-- re-subscribed on the same browser (same endpoint), the composite unique
-- constraint did NOT match on user_id, so instead of taking over the
-- endpoint, a SECOND row was inserted: (old_user, endpoint) kept alongside
-- (new_user, endpoint). From then on, both users' push notifications
-- (including per-participant "empieza en 10 minutos" pool/event reminders)
-- were delivered to that same device, regardless of who was actually
-- registered/attending — the device just showed whatever arrived for
-- either account.
--
-- Fix: make endpoint unique on its own, so subscribing again with the same
-- endpoint always reassigns it to the current user instead of duplicating it.

-- 1) Dedupe existing rows: for endpoints owned by more than one user, keep
--    only the most recently created row (most likely the current owner).
DELETE FROM public.push_subscriptions ps
WHERE ps.id NOT IN (
  SELECT DISTINCT ON (endpoint) id
  FROM public.push_subscriptions
  ORDER BY endpoint, created_at DESC
);

-- 2) Drop the old composite uniqueness and add per-endpoint uniqueness.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
