-- ============================================================
-- SocialBattery — Phase 102: Visualizaciones contratadas (Sorteo Light)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Los sorteos Light incluyen "Apariciones de banner esporádico al número
-- de usuarios contratado" (ver RAFFLE_TIER_OPTIONS en
-- CommunityDetailPage.jsx / RAFFLE_TIERS en community.js), pero hasta
-- ahora ese número no se podía elegir — se guarda aquí, igual que
-- notification_count en community_events (fase 25/69) para las
-- promociones Premium/Ultra de eventos: un rango de 500 a 50.000
-- visualizaciones de banner, contratable solo para el tier 'light'.

ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS banner_views_contracted INTEGER
    CHECK (banner_views_contracted IS NULL OR banner_views_contracted BETWEEN 500 AND 50000);

NOTIFY pgrst, 'reload schema';
