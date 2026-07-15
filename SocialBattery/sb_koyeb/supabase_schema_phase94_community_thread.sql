-- ============================================================
-- SocialBattery — Phase 94: Hilo de comunidad (fotos, vídeos, mensajes + comentarios)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Solo el CREADOR de la comunidad puede publicar en el hilo (foto, vídeo o
-- texto). Cualquier miembro de la comunidad puede comentar en cada
-- publicación. Mismo criterio de "solo creador" que ya usan los sorteos
-- (community_raffles).

CREATE TABLE IF NOT EXISTS public.community_posts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  creator_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL CHECK (type IN ('photo', 'video', 'text')),
  content      TEXT        CHECK (content IS NULL OR char_length(content) <= 2000),
  media_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Debe tener texto o archivo adjunto (o ambos), nunca ninguno.
  CHECK (content IS NOT NULL OR media_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_community_posts_community
  ON public.community_posts(community_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_post_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_post_comments_post
  ON public.community_post_comments(post_id, created_at ASC);

-- ── RLS ────────────────────────────────────────────────────────
-- El backend usa el cliente de servicio (bypassa RLS) para todo el CRUD,
-- igual que el resto de endpoints de comunidad. Estas políticas de lectura
-- son solo una capa extra de defensa por si algún día se leen estas tablas
-- con el cliente del propio usuario.
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community members can read posts" ON public.community_posts;
CREATE POLICY "community members can read posts" ON public.community_posts
  FOR SELECT USING (
    community_id IN (SELECT community_id FROM public.community_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "community members can read post comments" ON public.community_post_comments;
CREATE POLICY "community members can read post comments" ON public.community_post_comments
  FOR SELECT USING (
    post_id IN (
      SELECT id FROM public.community_posts WHERE community_id IN (
        SELECT community_id FROM public.community_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── Storage ──────────────────────────────────────────────────────
-- Las fotos y vídeos del hilo se guardan en el bucket "chat-images" (ya
-- usado por el chat de comunidad y las actualizaciones de eventos), bajo
-- la ruta community-posts/{communityId}/... — no se necesita crear un
-- bucket nuevo. Asegúrate de que el bucket "chat-images" existe, es
-- público (o sirve URLs firmadas) y admite vídeo (mp4, mov, webm) además
-- de imágenes.

NOTIFY pgrst, 'reload schema';
