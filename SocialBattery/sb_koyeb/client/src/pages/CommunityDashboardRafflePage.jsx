import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { RaffleCard, ConfirmEndModal } from './CommunityDashboardPage';
import TimeseriesChart from '../components/TimeseriesChart';
import { useTranslation } from '../i18n';

// ── Subpágina del dashboard: detalle de UN sorteo ─────────────────────────
// Fase 124 — hermana simétrica de CommunityDashboardEventPage. El
// listado del dashboard enseña panelitos compactos (RaffleCardCompact);
// tapear uno trae aquí, donde se renderiza el <RaffleCard> gigante con
// todo: progreso enseñados/contratados, CTR del banner volador, desglose
// interesados/no interesados, participantes elegibles, aviso de
// publicidad finalizada, y los botones de renovar/finalizar
// promoción.
//
// Estrategia de carga idéntica a la subpágina de eventos: GET al
// dashboard entero y filtro por raffleId aquí. Los motivos y trade-offs
// están anotados en CommunityDashboardEventPage.jsx — no los repito.

export default function CommunityDashboardRafflePage() {
  const { communityId, raffleId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ending, setEnding] = useState(null); // { kind, row } | null
  const [endingBusy, setEndingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/community/communities/${communityId}/dashboard`);
      setData(res);
    } catch (e) {
      setError(e.message || t('dashboardDetail.failedRaffle'));
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  const raffle = useMemo(() => {
    if (!data?.raffles) return null;
    return data.raffles.find(r => r.id === raffleId) || null;
  }, [data, raffleId]);

  // Duplicado mínimo del handler que vivía en CommunityDashboardPage.
  // Prellenaba el formulario de RaffleAdAudiencePage con los valores
  // del ciclo actual, para arrancar en modo renovación.
  //
  // Community (fase 132) es un caso aparte: su audiencia siempre es
  // "todos los miembros", no hay nada que configurar — se renueva directo
  // contra el endpoint sin pasar por la pantalla de configuración. Ver el
  // comentario gemelo en CommunityDetailPage.jsx (handleRenewRafflePromo).
  const handleRenewRaffle = useCallback(async (r) => {
    if (r.tier === 'community') {
      try {
        await api.post(`/community/raffles/${r.id}/renew-promotion`, {});
        showToast('Publicidad renovada — se ha vuelto a avisar a la comunidad', 'success');
        await load();
      } catch (e) {
        showToast(e.message || t('dashboardDetail.renewError'), 'error');
      }
      return;
    }
    navigate(`/community/${communityId}/raffle-publicidad`, {
      state: {
        renewRaffle: {
          id: r.id,
          title: r.title,
          tier: r.tier,
          categories: r.categories,
          banner_views_contracted: r.contracted,
          banner_interested_only: r.banner_interested_only,
        },
        communityName: data?.community?.name || '',
      },
    });
  }, [navigate, communityId, data, showToast, load]);

  const askEnd = useCallback((kind, row) => {
    setEnding({ kind, row });
  }, []);

  const confirmEnd = useCallback(async () => {
    if (!ending) return;
    const path = `/community/raffles/${ending.row.id}/end-promotion`;
    setEndingBusy(true);
    try {
      await api.post(path, {});
      showToast(t('dashboardDetail.endedToast'), 'success');
      setEnding(null);
      await load();
    } catch (e) {
      showToast(e.message || t('dashboardDetail.endError'), 'error');
    } finally {
      setEndingBusy(false);
    }
  }, [ending, load, showToast]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <p className="text-surface-muted font-mono text-sm">{t('dashboardDetail.loadingRaffle')}</p>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="font-display font-bold text-surface-text">{t('dashboardDetail.failedRaffle')}</p>
          <p className="text-sm text-surface-muted leading-relaxed">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={load} className="px-4 py-2 rounded-xl border border-surface-border text-surface-text text-xs font-display font-semibold">
              {t('dashboardDetail.retry')}
            </button>
            <button
              onClick={() => navigate(`/community/${communityId}/dashboard`)}
              className="px-4 py-2 rounded-xl bg-accent-primary text-white text-xs font-display font-semibold"
            >
              {t('dashboardDetail.back')}
            </button>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  if (!raffle) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="font-display font-bold text-surface-text">{t('dashboardDetail.gonRaffle')}</p>
          <p className="text-sm text-surface-muted leading-relaxed">
            {t('dashboardDetail.goneHint')}
          </p>
          <button
            onClick={() => navigate(`/community/${communityId}/dashboard`)}
            className="px-4 py-2 rounded-xl bg-accent-primary text-white text-xs font-display font-semibold"
          >
            {t('dashboardDetail.backToDashboard')}
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(`/community/${communityId}/dashboard`)}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center flex-shrink-0"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-base truncate">{t('dashboardDetail.detailRaffle')}</h1>
            <p className="text-[10px] font-mono text-surface-muted truncate">{data.community.name}</p>
          </div>
          <button
            onClick={load}
            title={t('dashboardDetail.refresh')}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-muted flex items-center justify-center flex-shrink-0 hover:text-accent-glow hover:border-accent-primary/40 transition-colors"
          >
            ↻
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4 space-y-4">
        <RaffleCard
          raffle={raffle}
          freeThreshold={data.summary.free_threshold}
          onOpen={id => navigate(`/community/${communityId}#raffle-${id}`)}
          onRenew={handleRenewRaffle}
          onEnd={row => askEnd('raffle', row)}
        />
        {/* Fase 126 — gráfico temporal de todas las métricas del sorteo:
            targets asignados, banners mostrados y clicks al banner. */}
        <TimeseriesChart
          communityId={communityId}
          entityType="raffle"
          entityId={raffle.id}
          entity={raffle}
        />
      </main>

      <ConfirmEndModal
        open={!!ending}
        kind={ending?.kind}
        title={ending?.row?.title || ''}
        busy={endingBusy}
        onCancel={() => !endingBusy && setEnding(null)}
        onConfirm={confirmEnd}
      />

      <BottomNav />
    </div>
  );
}
