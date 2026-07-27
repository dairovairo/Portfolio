import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

// Panel mínimo de revisión de denuncias. Acceso solo para profile.is_admin
// (ver phase 131 — flag en users, marcado a mano en Supabase). No es un
// sistema de roles completo ni tiene ruta en el menú de navegación a
// propósito: se llega tecleando /admin/reports directamente. Si el
// equipo crece más allá de un revisor, esto necesitará más estructura
// (asignación entre admins, historial, etc.) — de momento cubre lo
// esencial: ver, decidir, y si es grave, bloquear con un clic.

const TARGET_LABELS = {
  user: 'Usuario', message: 'Mensaje', group_message: 'Mensaje de grupo',
  pool_message: 'Mensaje de quedada', community_message: 'Mensaje de comunidad',
  community_post: 'Publicación', event: 'Evento', pool: 'Quedada',
  community: 'Comunidad', other: 'Otro',
};

const REASON_LABELS = {
  spam: 'Spam', harassment: 'Acoso', hate: 'Discurso de odio',
  sexual: 'Contenido sexual', minor: 'Implica a menores', dangerous: 'Peligroso',
  impersonation: 'Suplantación', other: 'Otro',
};

const STATUS_TABS = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'actioned', label: 'Con acción' },
  { id: 'reviewed', label: 'Revisadas' },
  { id: 'dismissed', label: 'Descartadas' },
];

export default function AdminReportsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [status, setStatus] = useState('pending');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({}); // { [reportId]: text }

  const load = useCallback(async (s) => {
    setLoading(true);
    try {
      const { reports: data } = await api.get(`/admin/reports?status=${s}`);
      setReports(data || []);
    } catch (err) {
      showToast(err?.message || 'No se pudieron cargar las denuncias');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (profile?.is_admin) load(status);
  }, [status, profile?.is_admin, load]);

  // Guard: fuera de aquí si no eres admin. Va después de los hooks (reglas
  // de React) pero antes de cualquier otro render.
  if (profile && !profile.is_admin) {
    return <Navigate to="/" replace />;
  }

  async function handleDecide(reportId, newStatus) {
    setBusyId(reportId);
    try {
      await api.patch(`/admin/reports/${reportId}`, {
        status: newStatus,
        reviewer_note: notes[reportId] || undefined,
      });
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      showToast('Denuncia actualizada');
    } catch (err) {
      showToast(err?.message || 'No se pudo actualizar');
    } finally {
      setBusyId(null);
    }
  }

  async function handleBlockReported(reportId) {
    setBusyId(reportId);
    try {
      await api.post(`/admin/reports/${reportId}/block-reported`);
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      showToast('Usuario bloqueado y denuncia marcada como actuada');
    } catch (err) {
      showToast(err?.message || 'No se pudo bloquear');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-surface-bg text-surface-text pb-24">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="font-display text-2xl font-bold mb-1">Denuncias</h1>
        <p className="text-sm text-surface-muted mb-5">Panel interno de moderación.</p>

        <div className="flex gap-1.5 mb-5 overflow-x-auto">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setStatus(t.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-display font-semibold whitespace-nowrap transition-colors ${
                status === t.id
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-card text-surface-muted border border-surface-border hover:text-surface-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-surface-muted">Cargando...</p>}
        {!loading && reports.length === 0 && (
          <p className="text-sm text-surface-muted">No hay denuncias en este estado.</p>
        )}

        <div className="space-y-3">
          {reports.map((r) => {
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="bg-surface-card border border-surface-border rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className={`text-xs font-display font-bold px-2 py-0.5 rounded-full ${
                    r.reason === 'minor' ? 'bg-red-500/20 text-red-400' : 'bg-surface-bg text-surface-muted'
                  }`}>
                    {REASON_LABELS[r.reason] || r.reason}
                  </span>
                  <span className="text-xs text-surface-muted">
                    {new Date(r.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>

                <p className="text-sm text-surface-text mb-1">
                  <strong>{TARGET_LABELS[r.target_type] || r.target_type}</strong>
                  {r.reported?.username && <> · denunciado: <strong>@{r.reported.username}</strong></>}
                </p>
                <p className="text-xs text-surface-muted mb-2">
                  Denunciado por {r.reporter?.username ? `@${r.reporter.username}` : 'usuario eliminado'}
                  {' · '}target_id: <span className="font-mono">{r.target_id}</span>
                </p>

                {r.details && (
                  <p className="text-sm text-surface-text bg-surface-bg rounded-xl p-2.5 mb-3 whitespace-pre-wrap">
                    {r.details}
                  </p>
                )}

                {status === 'pending' && (
                  <>
                    <input
                      type="text"
                      placeholder="Nota interna (opcional)"
                      value={notes[r.id] || ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      disabled={busy}
                      className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2 text-sm mb-2.5
                        text-surface-text focus:outline-none focus:border-accent-primary/50 disabled:opacity-50"
                    />
                    <div className="flex flex-wrap gap-2">
                      {r.reported_user_id && (
                        <button
                          onClick={() => handleBlockReported(r.id)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40
                            text-xs font-display font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-50"
                        >
                          🚫 Bloquear y actuar
                        </button>
                      )}
                      <button
                        onClick={() => handleDecide(r.id, 'actioned')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/30
                          text-xs font-display font-semibold hover:bg-orange-500/25 transition-colors disabled:opacity-50"
                      >
                        Marcar actuada
                      </button>
                      <button
                        onClick={() => handleDecide(r.id, 'reviewed')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-surface-bg text-surface-text border border-surface-border
                          text-xs font-display font-semibold hover:bg-surface-border/40 transition-colors disabled:opacity-50"
                      >
                        Marcar revisada
                      </button>
                      <button
                        onClick={() => handleDecide(r.id, 'dismissed')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-surface-bg text-surface-muted border border-surface-border
                          text-xs font-display font-semibold hover:bg-surface-border/40 transition-colors disabled:opacity-50"
                      >
                        Descartar
                      </button>
                    </div>
                  </>
                )}

                {status !== 'pending' && r.reviewer_note && (
                  <p className="text-xs text-surface-muted italic">Nota: {r.reviewer_note}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
