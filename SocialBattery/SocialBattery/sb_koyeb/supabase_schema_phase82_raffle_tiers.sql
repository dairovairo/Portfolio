-- ============================================================
-- SocialBattery — Phase 82: Tipos de sorteo (Light / Volt / Comunity)
-- Run this in Supabase SQL Editor
-- ============================================================
-- NOTA: la clave 'comunity' de este archivo tenía un typo. Está
-- corregida a 'community' en supabase_schema_phase87_rename_community_tier.sql,
-- que también migra los datos ya guardados. Este archivo se deja tal
-- cual como registro histórico de lo que se ejecutó originalmente.
-- Al crear un sorteo, el creador de la comunidad elige uno de 3 tipos,
-- cada uno con su propia regla de participación y "precio" informativo
-- (todavía no hay cobro real conectado, igual que en la fase 81 de
-- colaboraciones — ver nota más abajo).
--
--   · light    → participan todos los miembros de la comunidad (salvo
--                admins). Precio: 20 €.
--   · volt     → participan solo los miembros con suscripción Volt de
--                la app. Incluye publicidad en el menú principal.
--                Precio: gratis.
--   · comunity → participan solo los miembros que han colaborado con
--                la comunidad (ver community_collaborations, fase 81).
--                Incluye notificaciones a toda la comunidad. Precio: 5 €.

ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'light'
    CHECK (tier IN ('light', 'volt', 'comunity'));

-- Suscripción Volt del usuario a nivel de app. NOTA: todavía no existe
-- una pasarela de cobro para esta suscripción; este flag es el punto
-- de enganche para cuando se integre el cobro real. De momento se
-- puede activar manualmente (p.ej. desde Supabase) para pruebas.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_volt_subscriber BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
