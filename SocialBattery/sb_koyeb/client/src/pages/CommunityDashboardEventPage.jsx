import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { EventCard, ConfirmEndModal } from './CommunityDashboardPage';

// ── Subpágina del dashboard: detalle de UN evento ─────────────────────────
// Fase 124 — el listado del dashboard (CommunityDashboardPage) enseña
// panelitos compactos para no saturar la pantalla. Al tapear uno se
// llega aquí, que renderiza el <EventCard> gigante con TODO: envíos vs
// contratado, CTR de push, banner Ultra, desglose interesados/no
// interesados, píldoras, engagement orgánico, botones renovar/finalizar…
//
// Estrategia de carga: se pide GET /communities/:id/dashboard entero y
// se filtra por eventId aquí. Motivos:
//   · Un endpoint específico "detalle de un evento" duplicaría toda la
//     lógica de agregación que ya hay en la ruta general (RPC de
//     stats, join con community_event_attendees/likes, cálculo de
//     billable/can_end/can_renew...).
//   · La respuesta del dashboard entero pesa poco: es JSON crudo con
//     N eventos + M sorteos. Un fetch más al mes por parte del
//     creador de la comunidad no es problema, y hace la subpágina
//     resiliente a refrescos (F5 o link directo funciona sin state).
// Si el evento pedido no está en la respuesta, se enseña un mensaje
// claro y un botón para volver al listado — no un 404 opaco.

export default function CommunityDashboardEventPage() {
  const { communityId, eventId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

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
      setError(e.message || 'No se pudo cargar el evento');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  const event = useMemo(() => {
    if (!data?.events) return null;
    return data.events.find(e => e.id === eventId) || null;
  }, [data, eventId]);

  // Duplicado mínimo del handler que vivía en CommunityDashboardPage —
  // navega a la config de publicidad con el estado necesario para modo
  // renovación (misma forma exacta que el original). Se replica aquí en
  // vez de importar para que la subpágina sea autosuficiente y para no
  // arrastrar todo el estado del dashboard padre.
  const handleRenewEvent = useCallback((ev) => {
    navigate('/community/event-publicidad', {
      state: {
        renewEvent: {
          id: ev.id,
          title: ev.title,
          promotion_plan: ev.promotion_plan,
          notification_count: ev.contracted,
          communityId,
          communityName: data?.community?.name || '',
        },
      },
    });
  }, [navigate, communityId, data]);

  const askEnd = useCallback((kind, row) => {
    setEnding({ kind, row });
  }, []);

  const confirmEnd = useCallback(async () => {
    if (!ending) return;
    const path = `/community/events/${ending.row.id}/end-promotion`;
    setEndingBusy(true);
    try {
      await api.post(path, {});
      showToast('Publicidad finalizada', 'success');
      setEnding(null);
      await load();
    } catch (e) {
      showToast(e.message || 'No se pudo finalizar', 'error');
    } finally {
      setEndingBusy(false);
    }
  }, [ending, load, showToast]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <p className="text-surface-muted font-mono text-sm">Cargando evento...</p>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="font-display font-bold text-surface-text">No se pudo cargar el evento</p>
          <p className="text-sm text-surface-muted leading-relaxed">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={load} className="px-4 py-2 rounded-xl border border-surface-border text-surface-text text-xs font-display font-semibold">
              Reintentar
            </button>
            <button
              onClick={() => navigate(`/community/${communityId}/dashboard`)}
              className="px-4 py-2 rounded-xl bg-accent-primary text-white text-xs font-display font-semibold"
            >
              Volver
            </button>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  // Evento no encontrado: puede ocurrir si se borró desde otra pestaña,
  // o si se sigue un link viejo. Mensaje corto y salida al listado.
  if (!event) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="font-display font-bold text-surface-text">Este evento ya no está</p>
          <p className="text-sm text-surface-muted leading-relaxed">
            No aparece en el dashboard de esta comunidad. Puede que se haya borrado o que hayas seguido un enlace desactualizado.
          </p>
          <button
            onClick={() => navigate(`/community/${communityId}/dashboard`)}
            className="px-4 py-2 rounded-xl bg-accent-primary text-white text-xs font-display font-semibold"
          >
            Volver al dashboard
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
            <h1 className="font-display font-bold text-surface-text text-base truncate">📊 Detalle del evento</h1>
            <p className="text-[10px] font-mono text-surface-muted truncate">{data.community.name}</p>
          </div>
          <button
            onClick={load}
            title="Actualizar"
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-muted flex items-center justify-center flex-shrink-0 hover:text-accent-glow hover:border-accent-primary/40 transition-colors"
          >
            ↻
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4">
        <EventCard
          event={event}
          freeThreshold={data.summary.free_threshold}
          onOpen={id => navigate(`/community/event/${id}`)}
          onRenew={handleRenewEvent}
          onEnd={row => askEnd('event', row)}
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
