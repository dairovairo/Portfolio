import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

const VIEWS_MIN = 500;
const VIEWS_MAX = 50000;

// ── Configuración de publicidad de un sorteo Light ──────────────────────────
// Pantalla a la que se llega al pulsar "Configurar publicidad" en el modal
// de creación de sorteo con el tier Light seleccionado (ver CreateRaffleModal
// en CommunityDetailPage.jsx). El sorteo TODAVÍA no se ha creado en este
// punto — los datos rellenados en el modal viajan aquí como "draft" a través
// del state de navegación. Aquí se muestra el tamaño de la audiencia
// notificable, se puede filtrar por interesados, y se elige cuántas
// visualizaciones de banner contratar (antes esto último se elegía en el
// propio modal; ahora vive aquí porque el rango contratable depende de la
// audiencia real que se calcula en esta pantalla). El sorteo se crea de
// verdad al confirmar aquí abajo.
//
// IMPORTANTE: la audiencia (tanto el total notificable como los
// interesados) NUNCA incluye a los miembros de la propia comunidad que
// organiza el sorteo — el Light es publicidad de pago pensada para llegar a
// gente NUEVA, no a quien ya está dentro (ver getRaffleLightAudienceIds en
// el servidor). El total y el filtro que se ven aquí son exactamente el
// pool del que luego se sortean los targets reales del banner.
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

  const [filterInterested, setFilterInterested] = useState(false);
  const [loadingInterested, setLoadingInterested] = useState(false);
  const [interested, setInterested] = useState(null);
  const [categoriesDefined, setCategoriesDefined] = useState(null);

  const [bannerViews, setBannerViews] = useState(VIEWS_MIN);

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

  // La audiencia realmente contratable ahora mismo: si el filtro de
  // interesados está activo (y hay categorías con las que cruzar), el
  // máximo pasa a ser el nº de interesados; si no, el total notificable.
  const audienceCap = filterInterested
    ? (categoriesDefined === false ? 0 : interested)
    : total;
  const effectiveMax = audienceCap != null ? Math.min(VIEWS_MAX, audienceCap) : null;
  const audienceReady = effectiveMax != null && !loadingInterested;
  const audienceTooSmall = audienceReady && effectiveMax < VIEWS_MIN;

  // Si cambia el máximo disponible (se activa/desactiva el filtro, o llega
  // el recuento) y la cantidad elegida se sale de rango, la reencajamos.
  useEffect(() => {
    if (effectiveMax == null) return;
    setBannerViews(v => {
      if (effectiveMax < VIEWS_MIN) return VIEWS_MIN;
      if (v > effectiveMax) return effectiveMax;
      if (v < VIEWS_MIN) return VIEWS_MIN;
      return v;
    });
  }, [effectiveMax]);

  async function handleToggleInterested() {
    const next = !filterInterested;
    if (!next) {
      setFilterInterested(false);
      return;
    }
    // Activando el filtro: si aún no tenemos el recuento de interesados,
    // lo pedimos ahora (una sola vez, se cachea en el estado).
    setFilterInterested(true);
    if (interested != null || categoriesDefined === false) return;
    setLoadingInterested(true);
    try {
      const data = await api.get(`/community/communities/${communityId}/raffle-audience?filter=interested`);
      setInterested(data?.interested ?? null);
      setCategoriesDefined(Boolean(data?.categories_defined));
    } catch (e) {
      showToast(e.message || 'No se pudo filtrar por interesados', 'error');
      setFilterInterested(false);
    } finally {
      setLoadingInterested(false);
    }
  }

  async function handleCreate() {
    if (!draft || audienceTooSmall) return;
    setCreating(true);
    setCreateError('');
    try {
      const formData = new FormData();
      formData.append('title', draft.title);
      if (draft.description?.trim()) formData.append('description', draft.description.trim());
      formData.append('ends_at', draft.ends_at);
      formData.append('tier', draft.tier || 'light');
      formData.append('banner_views_contracted', bannerViews);
      formData.append('banner_interested_only', filterInterested ? 'true' : 'false');
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
            Usuarios de la app fuera de {communityName} a los que puede llegar el banner de este sorteo Light.
          </p>
        </div>

        {/* Filtro de interesados */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-display font-bold text-surface-text">🎯 Filtrar interesados</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                Contrata solo entre los notificables con intereses afines a tu comunidad.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={filterInterested}
              onClick={handleToggleInterested}
              disabled={loadingTotal || !!loadError}
              className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors disabled:opacity-40 ${
                filterInterested ? 'bg-amber-400' : 'bg-surface-bg border border-surface-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-surface-card shadow transition-transform ${
                  filterInterested ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {filterInterested && (
            loadingInterested ? (
              <div className="text-center py-2">
                <span className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin inline-block" />
              </div>
            ) : categoriesDefined === false ? (
              <div className="text-center py-1 space-y-2 border-t border-surface-border/60 pt-3">
                <p className="text-xs text-surface-muted leading-relaxed">
                  No definiste ninguna categoría de intereses en tu comunidad, puedes editar el perfil de la comunidad aún.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/community/${communityId}`)}
                  className="text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
                >
                  Editar comunidad
                </button>
              </div>
            ) : (
              <div className="text-center py-1 border-t border-surface-border/60 pt-3">
                <p className="font-display font-bold text-2xl text-amber-300">
                  {Number(interested).toLocaleString('es-ES')}
                </p>
                <p className="text-[11px] text-surface-muted mt-1">
                  interesados de {Number(total).toLocaleString('es-ES')} notificables
                </p>
              </div>
            )
          )}
        </div>

        {/* Visualizaciones contratadas — antes vivía en el modal de creación,
            ahora aquí porque su rango depende de la audiencia real (todos
            los notificables, o solo los interesados si el filtro está
            activo) calculada arriba. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-mono text-surface-muted">
              👁️ Visualizaciones a contratar
            </label>
            <span className="text-xs font-mono font-semibold text-surface-text">
              {Number(bannerViews).toLocaleString('es-ES')}
            </span>
          </div>

          {!audienceReady ? (
            <div className="h-6 flex items-center">
              <span className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin inline-block" />
            </div>
          ) : audienceTooSmall ? (
            <p className="text-xs text-red-400 leading-relaxed">
              {filterInterested
                ? `Solo hay ${Number(effectiveMax).toLocaleString('es-ES')} usuarios interesados: no llega al mínimo de ${VIEWS_MIN} contratables. Prueba a quitar el filtro.`
                : `Solo hay ${Number(effectiveMax).toLocaleString('es-ES')} usuarios notificables: no llega al mínimo de ${VIEWS_MIN} contratables.`}
            </p>
          ) : (
            <>
              <input
                type="range"
                min={VIEWS_MIN}
                max={effectiveMax}
                step={1}
                value={bannerViews}
                onChange={e => setBannerViews(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] font-mono text-surface-muted">
                <span>Mín. {VIEWS_MIN.toLocaleString('es-ES')}</span>
                <span>Máx. {Number(effectiveMax).toLocaleString('es-ES')}</span>
              </div>
            </>
          )}
          <p className="text-[10px] font-mono text-surface-muted">
            ℹ️ Si no se alcanzan {VIEWS_MIN} banners enseñados no se cobrará nada.
          </p>
        </div>

        {createError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{createError}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={creating || !audienceReady || audienceTooSmall}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
        >
          {creating ? 'Creando...' : '🎁 Crear sorteo'}
        </button>
      </main>
    </div>
  );
}
