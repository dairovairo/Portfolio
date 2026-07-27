const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Todas las rutas de este archivo requieren estar logueado Y tener
// is_admin=true en la fila de users (ver phase 131). Panel mínimo para un
// solo revisor — no hay asignación de denuncias entre varios admins ni
// historial de auditoría más allá de reviewer_note.
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/reports — listado con filtro por estado ──────────────────
router.get('/reports', async (req, res) => {
  const status = ['pending', 'reviewed', 'actioned', 'dismissed'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  try {
    const { data, error } = await supabase
      .from('user_reports')
      .select(`
        id, target_type, target_id, reason, details, status, created_at, reviewed_at, reviewer_note,
        reporter:users!user_reports_reporter_id_fkey(id, username, avatar_url),
        reported:users!user_reports_reported_user_id_fkey(id, username, avatar_url)
      `)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ reports: data || [] });
  } catch (err) {
    console.error('[admin] GET /reports error:', err);
    res.status(500).json({ error: 'Error al cargar denuncias' });
  }
});

// ── PATCH /api/admin/reports/:id — triaje (cambiar estado + nota) ───────────
router.patch('/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { status, reviewer_note } = req.body || {};
  if (!['reviewed', 'actioned', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  try {
    const { data, error } = await supabase
      .from('user_reports')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewer_note: typeof reviewer_note === 'string' ? reviewer_note.slice(0, 500) : null,
      })
      .eq('id', id)
      .select('id, status')
      .single();
    if (error) throw error;
    res.json({ report: data });
  } catch (err) {
    console.error('[admin] PATCH /reports/:id error:', err);
    res.status(500).json({ error: 'Error al actualizar la denuncia' });
  }
});

// ── POST /api/admin/reports/:id/block-reported — acción rápida ──────────────
// Bloquea (a nivel de plataforma: bloqueo tuyo hacia ese usuario, más
// efectivo aún sería suspender la cuenta, pero no hay ese concepto
// todavía) al usuario denunciado y marca la denuncia como 'actioned'.
// Atajo para el caso más común de "esto es grave, actúa ya".
router.post('/reports/:id/block-reported', async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;
  try {
    const { data: report, error: fetchErr } = await supabase
      .from('user_reports')
      .select('id, reported_user_id, status')
      .eq('id', id)
      .single();
    if (fetchErr || !report) return res.status(404).json({ error: 'Denuncia no encontrada' });
    if (!report.reported_user_id) {
      return res.status(400).json({ error: 'Esta denuncia no tiene un usuario asociado que bloquear' });
    }

    const { error: blockErr } = await supabase
      .from('blocked_users')
      .upsert({ blocker_id: adminId, blocked_id: report.reported_user_id }, { onConflict: 'blocker_id,blocked_id' });
    if (blockErr) throw blockErr;

    const { data: updated, error: updErr } = await supabase
      .from('user_reports')
      .update({ status: 'actioned', reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status')
      .single();
    if (updErr) throw updErr;

    res.json({ report: updated });
  } catch (err) {
    console.error('[admin] POST /reports/:id/block-reported error:', err);
    res.status(500).json({ error: 'Error al bloquear al usuario denunciado' });
  }
});

module.exports = router;
