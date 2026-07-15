import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

// ── Configuración de publicidad de un sorteo Light ──────────────────────────
// Pantalla a la que se llega al pulsar "Configurar publicidad" en el modal
// de creación de sorteo con el tier Light seleccionado (ver CreateRaffleModal
// en CommunityDetailPage.jsx). El sorteo TODAVÍA no se ha creado en este
// punto — los datos rellenados en el modal viajan aquí como "draft" a través
// del state de navegación. Aquí se muestran las prestaciones del sorteo
// Light, el tamaño de la audiencia notificable, se puede filtrar por
// interesados, y se elige cuántas visualizaciones de banner contratar. El
// sorteo se crea de verdad al confirmar aquí abajo.
//
// La audiencia (tanto el total notificable como los interesados) NUNCA
// incluye a los miembros de la propia comunidad que organiza el sorteo — el
// Light es publicidad de pago pensada para llegar a gente NUEVA, no a quien
// ya está dentro (ver getRaffleLightAudienceIds en el servidor). El total y
// el filtro que se ven aquí son exactamente el pool del que luego se
// sortean los targets reales del banner.
//
// Slider: siempre 500–50.000 y siempre operativo. Si la audiencia (con o
// sin filtro) queda por debajo del número contratado, el sistema entregará
// como mucho ese número de banners y no se cobrará por el resto — no se
// bloquea la contratación (ver info tras el slider).
const VIEWS_MIN = 500;
const VIEWS_MAX = 50000;
const VIEWS_STEP = 500;

const LIGHT_META = {
  emoji: '🎫',
  label: 'Sorteo Light',
  price: '20 €',
  ring: 'border-amber-400 bg-amber-500/10',
  pill: 'text-amber-300 bg-amber-500/10 border border-amber-500/20',
  check: 'text-amber-300',
  audienceText: 'text-amber-300',
  slider: 'accent-amber-400',
  toggleOn: 'bg-amber-400',
  spinnerBorder: 'border-amber-400',
  button: 'bg-amber-500 hover:bg-amber-400 text-surface-bg',
  includes: [
    'Notificaciones a toda la comunidad',
    'Apariciones de banner al número de usuarios contratado',
    'Publicidad fuera de la comunidad — llega a gente nueva',
  ],
};

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

  // Audiencia efectiva: si el filtro de intereses está activo (y hay
  // categorías con las que cruzar), pasa a ser el nº de interesados; si no,
  // el total notificable. Se usa SOLO para informar (banner amarillo /
  // rojo bajo el slider); NO se usa para topar el máximo del slider — la
  // empresa puede contratar hasta VIEWS_MAX aunque el pool sea menor
  // (solo se entregarán los banners que quepan y no se cobrará por el
  // resto, ver notas del slider).
  const audienceCap = filterInterested
    ? (categoriesDefined === false ? 0 : interested)
    : total;
  const audienceReady = audienceCap != null && !loadingInterested;
  const contractedExceedsAudience = audienceReady && bannerViews > audienceCap;

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
    if (!draft || !audienceReady) return;
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

  const audienceLabel = useMemo(() => {
    if (filterInterested) return 'usuarios interesados';
    return 'usuarios notificables';
  }, [filterInterested]);

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
        {/* Resumen del sorteo en creación */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-1">
          <h2 className="font-display font-bold text-surface-text text-sm truncate">
            {draft.title || 'Nuevo sorteo'}
          </h2>
          <p className="text-xs font-mono text-surface-muted truncate">
            👥 {communityName}
          </p>
        </div>

        {/* Detalles del plan Light */}
        <div className={`bg-surface-card border rounded-2xl p-5 space-y-3 transition-colors ${LIGHT_META.ring}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base font-display font-bold text-surface-text">
              <span className="text-xl">{LIGHT_META.emoji}</span>
              {LIGHT_META.label}
            </span>
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${LIGHT_META.pill}`}>
              {LIGHT_META.price}
            </span>
          </div>
          <ul className="space-y-1.5 text-[12px] font-mono text-surface-muted leading-relaxed">
            {LIGHT_META.includes.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`${LIGHT_META.check} flex-shrink-0`}>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Audiencia total notificable — usuarios fuera de la comunidad
            del sorteo (misma lógica que getRaffleLightAudienceIds). */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-2">
          <p className="text-xs font-mono text-surface-muted uppercase tracking-wide">Usuarios notificables</p>
          {loadingTotal ? (
            <div className="h-10 flex items-center justify-center">
              <span className={`w-5 h-5 border-2 ${LIGHT_META.spinnerBorder} border-t-transparent rounded-full animate-spin`} />
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
            <p className={`font-display font-bold text-4xl ${LIGHT_META.audienceText}`}>
              {Number(total).toLocaleString('es-ES')}
            </p>
          )}
          <p className="text-[11px] text-surface-muted leading-relaxed">
            Usuarios de la app fuera de {communityName} a los que puede llegar el banner de este sorteo Light.
          </p>
        </div>

        {/* ── Filtro por intereses ──────────────────────────────────────
            Al activarse, se cruza users.interests con las categorías de
            la comunidad; solo se sortean visualizaciones entre esos
            usuarios interesados. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-display font-bold text-surface-text">🎯 Filtrar por intereses</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                Contrata solo entre los notificables con intereses afines a tu comunidad.
              </p>
            </div>
            <InterestToggle
              checked={filterInterested}
              onChange={handleToggleInterested}
              disabled={loadingTotal || !!loadError}
              activeBg={LIGHT_META.toggleOn}
            />
          </div>

          {filterInterested && (
            loadingInterested ? (
              <div className="text-center py-2">
                <span className={`w-5 h-5 border-2 ${LIGHT_META.spinnerBorder} border-t-transparent rounded-full animate-spin inline-block`} />
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
                <p className={`font-display font-bold text-2xl ${LIGHT_META.audienceText}`}>
                  {Number(interested).toLocaleString('es-ES')}
                </p>
                <p className="text-[11px] text-surface-muted mt-1">
                  interesados de {Number(total).toLocaleString('es-ES')} notificables
                </p>
              </div>
            )
          )}
        </div>

        {/* Visualizaciones contratadas — siempre operativo 500–50.000.
            Si la audiencia efectiva queda por debajo, avisamos abajo;
            solo se entregarán los banners que quepan (ver assignRaffleBannerTargets). */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-mono text-surface-muted">
              👁️ Visualizaciones a contratar
            </label>
            <span className="text-xs font-mono font-semibold text-surface-text">
              {Number(bannerViews).toLocaleString('es-ES')}
            </span>
          </div>

          <input
            type="range"
            min={VIEWS_MIN}
            max={VIEWS_MAX}
            step={VIEWS_STEP}
            value={bannerViews}
            onChange={e => setBannerViews(Number(e.target.value))}
            className={`w-full ${LIGHT_META.slider} cursor-pointer`}
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-surface-muted">
            <span>Mín. {VIEWS_MIN.toLocaleString('es-ES')}</span>
            <span>Máx. {VIEWS_MAX.toLocaleString('es-ES')}</span>
          </div>

          {contractedExceedsAudience && (
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 leading-relaxed">
              ⚠️ Solo hay {Number(audienceCap).toLocaleString('es-ES')} {audienceLabel}: se mostrarán como mucho {Number(audienceCap).toLocaleString('es-ES')} banners, y no se cobrará por el resto.
            </p>
          )}

          <p className="text-[10px] font-mono text-surface-muted">
            ℹ️ Si no se alcanzan {VIEWS_MIN} banners enseñados no se cobrará nada.
          </p>
        </div>

        {/* Notas informativas */}
        <div className="space-y-2">
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            💳 Se aplicará una retención al comenzar el sorteo; el pago se efectuará al renovar o finalizar el contrato publicitario, o en su defecto al finalizar el sorteo.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            📶 Los banners publicitarios tienen preferencia en sorteos Light frente a sorteos Volt.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            🔁 Se mostrará como máximo un banner a cada usuario dentro de un mismo sorteo.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            📡 Los banners se enviarán conforme los usuarios estén disponibles.
          </p>
        </div>

        {createError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{createError}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={creating || !audienceReady}
          className={`w-full py-3.5 rounded-xl font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98] ${LIGHT_META.button}`}
        >
          {creating ? 'Creando...' : '🎁 Crear sorteo Light'}
        </button>
      </main>
    </div>
  );
}

// Toggle de intereses — mismo aspecto/comportamiento que en
// EventAdConfigPage. Extraído en local para no duplicar clases; si un
// futuro lo necesita una tercera pantalla, moverlo a components/.
function InterestToggle({ checked, onChange, disabled, activeBg }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-7 w-12 items-center rounded-full flex-shrink-0 transition-colors disabled:opacity-40 focus:outline-none ${
        checked ? activeBg : 'bg-surface-bg border border-surface-border'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
