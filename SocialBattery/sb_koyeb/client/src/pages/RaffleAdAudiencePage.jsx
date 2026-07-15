import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

// ── Configuración de publicidad de un sorteo Light ──────────────────────────
// Pantalla a la que se llega al pulsar "Configurar publicidad" en el modal
// de creación de sorteo con el tier Light seleccionado (ver CreateRaffleModal
// en CommunityDetailPage.jsx). El sorteo TODAVÍA no se ha creado en este
// punto — los datos rellenados en el modal viajan aquí como "draft" a través
// del state de navegación. Aquí se muestra el tamaño de la audiencia
// notificable (mismo pool que assignRaffleBannerTargets usa para el tier
// Light: todos los usuarios de la app salvo el creador) y, opcionalmente,
// cuántos de esos usuarios encajan por intereses con las categorías de la
// comunidad. El sorteo se crea de verdad al confirmar aquí abajo.
export default function RaffleAdAudiencePage() {
  const { communityId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const draft = location.state?.draft || null;
  const communityName = location.state?.communityName || 'tu comunidad';

  const [loadingTotal, setLoadingTotal] = useState(true);
  const [total, setTotal] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [showInterested, setShowInterested] = useState(false);
  const [loadingInterested, setLoadingInterested] = useState(false);
  const [interested, setInterested] = useState(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Sin borrador (p. ej. si se ha recargado la página directamente aquí) no
  // hay nada que configurar: de vuelta a la comunidad.
  useEffect(() => {
    if (!draft) navigate(`/community/${communityId}`, { replace: true });
  }, [draft, communityId, navigate]);

  const loadTotal = useCallback(async () => {
    setLoadingTotal(true);
    setLoadError('');
    try {
      const data = await api.get(`/community/communities/${communityId}/raffle-audience`);
      setTotal(data?.total ?? 0);
    } catch (e) {
      setLoadError(e.message || 'No se pudo calcular la audiencia');
    } finally {
      setLoadingTotal(false);
    }
  }, [communityId]);

  useEffect(() => {
    if (draft) loadTotal();
  }, [draft, loadTotal]);

  async function handleFilterInterested() {
    setShowInterested(true);
    if (interested != null) return; // ya calculado, no repetir la llamada
    setLoadingInterested(true);
    try {
      const data = await api.get(`/community/communities/${communityId}/raffle-audience?filter=interested`);
      setInterested(data?.interested ?? 0);
    } catch (e) {
      showToast(e.message || 'No se pudo filtrar por interesados', 'error');
      setShowInterested(false);
    } finally {
      setLoadingInterested(false);
    }
  }

  async function handleCreate() {
    if (!draft) return;
    setCreating(true);
    setCreateError('');
    try {
      const formData = new FormData();
      formData.append('title', draft.title);
      if (draft.description?.trim()) formData.append('description', draft.description.trim());
      formData.append('ends_at', draft.ends_at);
      formData.append('tier', draft.tier || 'light');
      if (draft.banner_views_contracted != null) formData.append('banner_views_contracted', draft.banner_views_contracted);
      if (draft.image_file) formData.append('image', draft.image_file);
      await api.postForm(`/community/communities/${communityId}/raffles`, formData);
      showToast('¡Sorteo creado! 🎁', 'success');
      navigate(`/community/${communityId}`, { replace: true });
    } catch (e) {
      setCreateError(e.message || 'Error al crear el sorteo');
    } finally {
      setCreating(false);
    }
  }

  if (!draft) return null;

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-surface-border text-surface-muted hover:text-surface-text hover:border-accent-primary/40 transition-all flex-shrink-0"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-base truncate">🎫 Configurar publicidad</h1>
            <p className="text-xs font-mono text-surface-muted truncate">{communityName}</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-32 pt-4 space-y-4">
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-1">
          <h2 className="font-display font-bold text-surface-text text-sm">{draft.title}</h2>
          <p className="text-xs font-mono text-surface-muted">Sorteo Light · {communityName}</p>
        </div>

        {/* Audiencia total notificable */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-2">
          <p className="text-xs font-mono text-surface-muted uppercase tracking-wide">Usuarios notificables</p>
          {loadingTotal ? (
            <div className="h-10 flex items-center justify-center">
              <span className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : loadError ? (
            <div className="space-y-2">
              <p className="text-xs text-red-400">{loadError}</p>
              <button
                type="button"
                onClick={loadTotal}
                className="text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <p className="font-display font-bold text-4xl text-amber-300">
              {Number(total).toLocaleString('es-ES')}
            </p>
          )}
          <p className="text-[11px] text-surface-muted leading-relaxed">
            Es el número total de usuarios de la app a los que puede llegar el banner de este sorteo Light.
          </p>
        </div>

        {/* Filtro de interesados */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-display font-bold text-surface-text">🎯 Interesados</p>
              <p className="text-[11px] text-surface-muted mt-0.5">
                De esos usuarios notificables, cuántos tienen intereses afines a esta comunidad.
              </p>
            </div>
          </div>

          {!showInterested ? (
            <button
              type="button"
              onClick={handleFilterInterested}
              disabled={loadingTotal || !!loadError}
              className="w-full py-3 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-300 font-display font-semibold text-sm hover:bg-amber-400/15 transition-all disabled:opacity-50"
            >
              Filtrar interesados
            </button>
          ) : (
            <div className="text-center py-2">
              {loadingInterested ? (
                <span className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <>
                  <p className="font-display font-bold text-3xl text-amber-300">
                    {Number(interested).toLocaleString('es-ES')}
                  </p>
                  <p className="text-[11px] text-surface-muted mt-1">
                    interesados de {Number(total).toLocaleString('es-ES')} notificables
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {createError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{createError}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={creating || loadingTotal || !!loadError}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
        >
          {creating ? 'Creando...' : '🎁 Crear sorteo'}
        </button>
      </main>
    </div>
  );
}
