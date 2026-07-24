const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// ── Sistema de denuncias ─────────────────────────────────────────────────────
// Ver supabase_schema_phase129_user_reports.sql para el esquema y el
// razonamiento del diseño. Aquí sólo hay lógica de negocio:
//   - validar tipos y razones (evitar denuncias "silenciosas" mal
//     formadas que llenen la tabla de basura)
//   - resolver el reported_user_id automáticamente para target_type
//     concretos donde el servidor puede saber quién es el autor (mensaje
//     1:1, mensaje de grupo, publicación de hilo de comunidad, etc.)
//   - devolver 429 si el usuario está creando denuncias en ráfaga.
// El listado y detalle solo devuelven las denuncias del propio usuario;
// la revisión la hace el equipo en Supabase directamente por ahora.

const VALID_TARGET_TYPES = new Set([
  'user', 'message', 'group_message', 'pool_message', 'community_message',
  'community_post', 'event', 'pool', 'community', 'other',
]);

const VALID_REASONS = new Set([
  'spam', 'hate', 'harassment', 'sexual', 'minor', 'dangerous',
  'impersonation', 'other',
]);

// Anti-abuso simple: máximo N denuncias por usuario en Xh. Aparte del
// rate limit global del servidor, esto protege específicamente la mesa de
// moderación de spam de denuncias.
const REPORT_WINDOW_MS = 60 * 60 * 1000; // 1h
const REPORT_MAX_PER_WINDOW = 10;

// Resuelve el autor real del contenido denunciado, si el tipo lo permite.
// Devuelve null si no aplica o no se puede saber (el registro sigue
// siendo válido, solo pierde el join con reported_user_id).
async function resolveReportedUserId(targetType, targetId) {
  try {
    if (targetType === 'user') {
      return targetId;
    }
    if (targetType === 'message') {
      const { data } = await supabase
        .from('messages').select('sender_id').eq('id', targetId).maybeSingle();
      return data?.sender_id || null;
    }
    if (targetType === 'group_message') {
      const { data } = await supabase
        .from('group_messages').select('sender_id').eq('id', targetId).maybeSingle();
      return data?.sender_id || null;
    }
    if (targetType === 'pool_message') {
      const { data } = await supabase
        .from('pool_messages').select('sender_id').eq('id', targetId).maybeSingle();
      return data?.sender_id || null;
    }
    if (targetType === 'community_message') {
      const { data } = await supabase
        .from('community_messages').select('sender_id').eq('id', targetId).maybeSingle();
      return data?.sender_id || null;
    }
    if (targetType === 'community_post') {
      const { data } = await supabase
        .from('community_posts').select('author_id').eq('id', targetId).maybeSingle();
      return data?.author_id || null;
    }
    if (targetType === 'event') {
      const { data } = await supabase
        .from('events').select('organizer_id').eq('id', targetId).maybeSingle();
      return data?.organizer_id || null;
    }
    if (targetType === 'pool') {
      const { data } = await supabase
        .from('hangout_pools').select('creator_id').eq('id', targetId).maybeSingle();
      return data?.creator_id || null;
    }
    if (targetType === 'community') {
      const { data } = await supabase
        .from('communities').select('owner_id').eq('id', targetId).maybeSingle();
      return data?.owner_id || null;
    }
  } catch (_e) {
    // Fallo al resolver → dejamos reported_user_id en null. La denuncia
    // sigue siendo válida y revisable.
  }
  return null;
}

// ── POST /api/reports — crear denuncia ───────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { target_type, target_id, reason, details } = req.body || {};

  if (!VALID_TARGET_TYPES.has(target_type)) {
    return res.status(400).json({ error: 'Tipo de contenido no válido' });
  }
  if (typeof target_id !== 'string' || target_id.length < 8) {
    return res.status(400).json({ error: 'ID del contenido no válido' });
  }
  if (!VALID_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Motivo no válido' });
  }
  // No denunciarte a ti mismo (uso obvio: bug o abuso).
  if (target_type === 'user' && target_id === userId) {
    return res.status(400).json({ error: 'No puedes denunciarte a ti mismo' });
  }
  const cleanDetails = typeof details === 'string' ? details.trim().slice(0, 1000) : null;

  try {
    // Anti-abuso: cuenta denuncias del usuario en la última hora.
    const sinceIso = new Date(Date.now() - REPORT_WINDOW_MS).toISOString();
    const { count: recentCount } = await supabase
      .from('user_reports')
      .select('id', { count: 'exact', head: true })
      .eq('reporter_id', userId)
      .gte('created_at', sinceIso);

    if ((recentCount ?? 0) >= REPORT_MAX_PER_WINDOW) {
      return res.status(429).json({
        error: 'Has enviado demasiadas denuncias en poco tiempo. Prueba de nuevo más tarde.',
      });
    }

    const reportedUserId = await resolveReportedUserId(target_type, target_id);
    // No permitir autodenuncia camuflada (denunciar un mensaje propio).
    if (reportedUserId && reportedUserId === userId) {
      return res.status(400).json({ error: 'No puedes denunciar tu propio contenido' });
    }

    // Upsert por si hay una denuncia pendiente previa sobre el mismo
    // target: en ese caso, actualiza los `details` y el reason (permite
    // corregir/aportar contexto sin duplicar filas).
    const { data, error } = await supabase
      .from('user_reports')
      .upsert({
        reporter_id: userId,
        target_type,
        target_id,
        reported_user_id: reportedUserId,
        reason,
        details: cleanDetails,
        status: 'pending',
      }, {
        onConflict: 'reporter_id,target_type,target_id',
      })
      .select('id, target_type, target_id, reason, status, created_at')
      .single();
    if (error) throw error;

    res.status(201).json({ report: data });
  } catch (err) {
    console.error('[reports] POST / error:', err);
    res.status(500).json({ error: 'No se pudo crear la denuncia' });
  }
});

// ── GET /api/reports/mine — mis denuncias enviadas ───────────────────────────
// Útil para poder mostrar al usuario el estado de sus denuncias en el
// panel de "Privacidad y seguridad" y para transparencia (Play Store
// premia mucho que sea navegable).
router.get('/mine', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { data, error } = await supabase
      .from('user_reports')
      .select('id, target_type, target_id, reason, status, created_at, reviewed_at')
      .eq('reporter_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ reports: data || [] });
  } catch (err) {
    console.error('[reports] GET /mine error:', err);
    res.status(500).json({ error: 'No se pudieron cargar tus denuncias' });
  }
});

module.exports = router;
