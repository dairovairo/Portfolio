-- ============================================================
-- SocialBattery — Phase 129: Sistema de denuncias (user_reports)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Tabla única para todas las denuncias de la app. Permite reportar:
--   - un usuario (perfil, comportamiento general)
--   - un mensaje (1:1, grupo, quedada, comunidad)
--   - una publicación en el hilo de comunidad
--   - un evento o una quedada (pool)
--   - un comentario o cualquier otro contenido con id
--
-- Diseño:
--   · target_type identifica qué tipo de entidad se denuncia.
--   · target_id es el UUID de esa entidad (no hay FK porque los tipos son
--     heterogéneos y no queremos que borrar el contenido borre la
--     denuncia — al contrario, si el usuario ya se autolimpia estamos
--     mejor).
--   · reported_user_id es opcional y sirve para agrupar denuncias por
--     usuario denunciado (patrones de abuso). El backend lo rellena a
--     partir de target_id cuando puede (p.ej. sender_id del mensaje).
--   · reason es un enum limitado (spam, hate, harassment, sexual, minor,
--     dangerous, other) para poder priorizar en la revisión.
--   · details es texto libre opcional (contexto adicional que aporte el
--     denunciante).
--   · status permite triaje básico manual (pending → reviewed → dismissed
--     / actioned). Sin panel de admin todavía; se revisará en Supabase
--     directamente hasta que exista uno.
--   · Un usuario solo puede tener una denuncia pendiente sobre el mismo
--     target — evita spam de denuncias. Si quiere aportar más info,
--     puede actualizar la suya (UPDATE por RLS abajo).
--
-- El servidor NUNCA expone el reporter_id al usuario denunciado: el
-- listado y detalle solo lo ves tú (el propio denunciante) o el equipo
-- de moderación via service key.

CREATE TABLE IF NOT EXISTS public.user_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type       TEXT NOT NULL CHECK (target_type IN (
                        'user', 'message', 'group_message', 'pool_message',
                        'community_message', 'community_post', 'event',
                        'pool', 'community', 'other'
                     )),
  target_id         UUID NOT NULL,
  reported_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL CHECK (reason IN (
                        'spam', 'hate', 'harassment', 'sexual', 'minor',
                        'dangerous', 'impersonation', 'other'
                     )),
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'reviewed', 'actioned', 'dismissed'
                     )),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewer_note     TEXT,
  -- Una denuncia pendiente por (reporter, target). Cuando se revisa
  -- (status != pending) queda cerrada y el mismo usuario puede volver a
  -- reportar el mismo target si vuelve a haber problema. Por eso la
  -- constraint es parcial en status='pending'.
  CONSTRAINT user_reports_unique_open UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_status_created
  ON public.user_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported_user
  ON public.user_reports(reported_user_id) WHERE reported_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_reports_target
  ON public.user_reports(target_type, target_id);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- SELECT: solo tus propias denuncias. La revisión la hace el backend con
-- la service key (bypasea RLS).
DROP POLICY IF EXISTS "Users read own reports" ON public.user_reports;
CREATE POLICY "Users read own reports" ON public.user_reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- INSERT: creas tus propias denuncias (con status pending, en el estado
-- actual lo garantiza el DEFAULT + el hecho de que el servidor es quien
-- crea la fila con la service key — pero mantenemos la política estricta
-- por defensa en profundidad).
DROP POLICY IF EXISTS "Users create own reports" ON public.user_reports;
CREATE POLICY "Users create own reports" ON public.user_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id AND status = 'pending');

-- UPDATE: puedes editar los `details` de tu denuncia mientras siga
-- pendiente (por si te olvidaste de aportar contexto). Nada más.
DROP POLICY IF EXISTS "Users update own pending reports" ON public.user_reports;
CREATE POLICY "Users update own pending reports" ON public.user_reports FOR UPDATE
  USING (auth.uid() = reporter_id AND status = 'pending')
  WITH CHECK (auth.uid() = reporter_id AND status = 'pending');

-- No hay policy de DELETE: una denuncia enviada no la puedes retirar sin
-- pasar por el equipo de moderación. Evita a usuarios que envían y
-- borran para tantear reacciones. Si algún día hace falta, se añade.
