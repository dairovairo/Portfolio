-- ============================================================
-- SocialBattery — Phase 61: Insignia "Tapado" (red de seguridad)
-- Run this in Supabase SQL Editor
-- ============================================================
-- A diferencia del resto de insignias de circulo/grupo, "Tapado" no es
-- exclusiva: la reciben automaticamente todos los miembros que no hayan
-- ganado ninguna otra insignia dentro del grupo. Se calcula y persiste
-- igual que las demas (ver server/lib/circleBadges.js), solo que puede
-- tener varios titulares a la vez.

INSERT INTO public.badges (id, name, emoji, description, category) VALUES
  ('tapado', 'Tapado', '🫥', 'Sin insignia... el mas normal de tus colegas.', 'circle')
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  emoji       = EXCLUDED.emoji,
  description = EXCLUDED.description,
  category    = EXCLUDED.category;
