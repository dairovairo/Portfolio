-- ============================================================
-- SocialBattery — Phase 70: Origen de notificaciones promo + banner Ultra
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora event_promo_notifications solo registraba los envíos del
-- reparto gradual (server/jobs/eventPromoPacing.js), NO los avisos
-- inmediatos que se mandan a los miembros de la comunidad al publicar un
-- evento premium/ultra (server/routes/community.js). Esto impedía:
--
--   a) Saber "¿a qué evento ultra fue notificado hoy este usuario?" para
--      el banner del menú principal (los miembros de comunidad nunca
--      quedaban registrados, solo el público general del reparto).
--   b) Aplicar correctamente el tope de "1 notificación promocional al
--      día salvo comunidad propia": al no registrar los avisos de
--      comunidad, no había forma de distinguirlos de los del reparto
--      general a la hora de calcular el tope diario.
--
-- Esta fase añade una columna `source` para distinguir ambos canales:
--   · 'community' → aviso inmediato a miembros de la comunidad del evento
--                    (premium/ultra). SIEMPRE se envía, no cuenta para el
--                    tope diario de 1/evento y no lo bloquea.
--   · 'pacing'     → envío del reparto gradual al público general/no
--                    perteneciente a la comunidad del evento. Sujeto al
--                    tope de 1 notificación de este tipo por usuario/día
--                    (contando todos los eventos).

ALTER TABLE public.event_promo_notifications
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pacing'
    CHECK (source IN ('community', 'pacing'));

COMMENT ON COLUMN public.event_promo_notifications.source IS
  'Canal del aviso: community (miembro de la comunidad del evento, inmediato, sin tope) o pacing (reparto gradual al público general, tope 1/usuario/día).';

-- Índice para la consulta del banner ("eventos ultra por los que se avisó
-- hoy a este usuario") y para el cálculo del tope diario filtrado por canal.
CREATE INDEX IF NOT EXISTS idx_event_promo_notifications_user_source_day
  ON public.event_promo_notifications (user_id, source, sent_at);
