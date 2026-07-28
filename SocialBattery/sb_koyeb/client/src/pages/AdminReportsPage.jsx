import { useState, useEffect, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';

// Panel mínimo de revisión de denuncias. Acceso solo para profile.is_admin
// (ver phase 131 — flag en users, marcado a mano en Supabase). No es un
// sistema de roles completo ni tiene ruta en el menú de navegación a
// propósito: se llega tecleando /admin/reports directamente.

export default function AdminReportsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t, lang } = useTranslation();
  const [status, setStatus] = useState('pending');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  // Tablas de traducción se rehacen al cambiar idioma.
  const TARGET_LABELS = useMemo(() => ({
    user: t('adminReports.targetUser'),
    message: t('adminReports.targetMessage'),
    group_message: t('adminReports.targetGroupMessage'),
    pool_message: t('adminReports.targetPoolMessage'),
    community_message: t('adminReports.targetCommunityMessage'),
    community_post: t('adminReports.targetCommunityPost'),
    event: t('adminReports.targetEvent'),
    pool: t('adminReports.targetPool'),
    community: t('adminReports.targetCommunity'),
    other: t('adminReports.targetOther'),
  }), [t]);

  const REASON_LABELS = useMemo(() => ({
    spam: t('adminReports.reasonSpam'),
    harassment: t('adminReports.reasonHarassment'),
    hate: t('adminReports.reasonHate'),
    sexual: t('adminReports.reasonSexual'),
    minor: t('adminReports.reasonMinor'),
    dangerous: t('adminReports.reasonDangerous'),
    impersonation: t('adminReports.reasonImpersonation'),
    other: t('adminReports.reasonOther'),
  }), [t]);

  const STATUS_TABS = useMemo(() => ([
    { id: 'pending',   label: t('adminReports.tabPending') },
    { id: 'actioned',  label: t('adminReports.tabActioned') },
    { id: 'reviewed',  label: t('adminReports.tabReviewed') },
    { id: 'dismissed', label: t('adminReports.tabDismissed') },
  ]), [t]);

  const load = useCallback(async (s) => {
    setLoading(true);
    try {
      const { reports: data } = await api.get(`/admin/reports?status=${s}`);
      setReports(data || []);
    } catch (err) {
      showToast(err?.message || t('adminReports.loadError'));
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    if (profile?.is_admin) load(status);
  }, [status, profile?.is_admin, load]);

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
      showToast(t('adminReports.updatedToast'));
    } catch (err) {
      showToast(err?.message || t('adminReports.updateError'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleBlockReported(reportId) {
    setBusyId(reportId);
    try {
      await api.post(`/admin/reports/${reportId}/block-reported`);
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      showToast(t('adminReports.blockedToast'));
    } catch (err) {
      showToast(err?.message || t('adminReports.blockError'));
    } finally {
      setBusyId(null);
    }
  }

  const localeTag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';

  return (
    <div className="min-h-screen bg-surface-bg text-surface-text pb-24">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="font-display text-2xl font-bold mb-1">{t('adminReports.title')}</h1>
        <p className="text-sm text-surface-muted mb-5">{t('adminReports.subtitle')}</p>

        <div className="flex gap-1.5 mb-5 overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatus(tab.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-display font-semibold whitespace-nowrap transition-colors ${
                status === tab.id
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-card text-surface-muted border border-surface-border hover:text-surface-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-surface-muted">{t('adminReports.loading')}</p>}
        {!loading && reports.length === 0 && (
          <p className="text-sm text-surface-muted">{t('adminReports.empty')}</p>
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
                    {new Date(r.created_at).toLocaleString(localeTag, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>

                <p className="text-sm text-surface-text mb-1">
                  <strong>{TARGET_LABELS[r.target_type] || r.target_type}</strong>
                  {r.reported?.username && <> · {t('adminReports.reportedSuffix')} <strong>@{r.reported.username}</strong></>}
                </p>
                <p className="text-xs text-surface-muted mb-2">
                  {t('adminReports.reportedByPrefix')} {r.reporter?.username ? `@${r.reporter.username}` : t('adminReports.deletedUser')}
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
                      placeholder={t('adminReports.notePlaceholder')}
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
                          {t('adminReports.blockAndAct')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDecide(r.id, 'actioned')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/30
                          text-xs font-display font-semibold hover:bg-orange-500/25 transition-colors disabled:opacity-50"
                      >
                        {t('adminReports.markActioned')}
                      </button>
                      <button
                        onClick={() => handleDecide(r.id, 'reviewed')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-surface-bg text-surface-text border border-surface-border
                          text-xs font-display font-semibold hover:bg-surface-border/40 transition-colors disabled:opacity-50"
                      >
                        {t('adminReports.markReviewed')}
                      </button>
                      <button
                        onClick={() => handleDecide(r.id, 'dismissed')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-surface-bg text-surface-muted border border-surface-border
                          text-xs font-display font-semibold hover:bg-surface-border/40 transition-colors disabled:opacity-50"
                      >
                        {t('adminReports.dismiss')}
                      </button>
                    </div>
                  </>
                )}

                {status !== 'pending' && r.reviewer_note && (
                  <p className="text-xs text-surface-muted italic">{t('adminReports.reviewerNoteLabel')} {r.reviewer_note}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
