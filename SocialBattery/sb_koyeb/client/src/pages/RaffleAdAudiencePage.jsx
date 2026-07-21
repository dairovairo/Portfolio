import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { RAFFLE_AD_PRICING, computeRaffleAdPriceCents, formatEurFromCents } from '../lib/adPricing';

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
// Slider: siempre 1.000–100.000 y siempre operativo. Si la audiencia (con o
// sin filtro) queda por debajo del número contratado, el sistema entregará
// como mucho ese número de banners y no se cobrará por el resto — no se
// bloquea la contratación (ver info tras el slider).
//
// CHARGE_MIN es el mínimo de banners realmente ENSEÑADOS por debajo del
// cual no se cobra nada (ver mensaje bajo el slider) — es un umbral de
// facturación independiente de VIEWS_MIN (mínimo contratable en el
// slider), no tiene por qué coincidir con él.
const VIEWS_MIN = 1000;
const VIEWS_MAX = 100000;
const VIEWS_STEP = 500;
const CHARGE_MIN = 500;

const LIGHT_META = {
  emoji: '🎫',
  label: 'Sorteo Light',
  // Precio dinámico — se calcula abajo con computeRaffleAdPriceCents en
  // función de las visualizaciones contratadas. Ya no hay tarifa
  // estática aquí (antes: '20 €' fijo, que era el precio del mínimo
  // contratable y engañaba al escalar el slider). Ver lib/adPricing.js.
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

  // Fase 112 — la misma página cubre creación (state.draft, viene del
  // modal de crear sorteo) y renovación (state.renewRaffle, viene del
  // dashboard o de la tarjeta del sorteo). En renovación el sorteo ya
  // existe: solo se retocan aforo y filtro de intereses, y al confirmar
  // se llama a POST /raffles/:raffleId/renew-promotion en vez de crearlo.
  // El resto del formulario (título, tier, fecha) no se puede cambiar
  // por aquí — para eso habría que crear otro sorteo. Volt no llega
  // nunca a esta página en renovación (no tiene publicidad de pago).
  const draft = location.state?.draft || null;
  const renewRaffle = location.state?.renewRaffle || null;
  const isRenew = !!renewRaffle;
  const communityName = location.state?.communityName || 'tu comunidad';

  const [loadingTotal, setLoadingTotal] = useState(true);
  const [total, setTotal] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [filterInterested, setFilterInterested] = useState(false);
  const [loadingInterested, setLoadingInterested] = useState(false);
  const [interested, setInterested] = useState(null);
  const [categoriesDefined, setCategoriesDefined] = useState(null);

  const [bannerViews, setBannerViews] = useState(
    isRenew && renewRaffle?.banner_views_contracted
      ? Math.min(Math.max(Number(renewRaffle.banner_views_contracted), VIEWS_MIN), VIEWS_MAX)
      : VIEWS_MIN
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Prerrellenar el toggle de intereses con el estado del ciclo actual —
  // así renovar "tal cual" no cambia nada por accidente.
  useEffect(() => {
    if (isRenew && renewRaffle?.banner_interested_only) setFilterInterested(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRenew]);

  // Sin borrador (creación) ni renewRaffle (renovación): recarga directa
  // o navegación manual — volvemos al menú de la comunidad.
  useEffect(() => {
    if (!draft && !renewRaffle) navigate(`/community/${communityId}`, { replace: true });
  }, [draft, renewRaffle, communityId, navigate]);

  // Categorías propias del sorteo — en creación vienen del borrador del
  // modal, en renovación vienen de la fila del sorteo ya creado. Si las
  // hay, se mandan al backend en las llamadas de audiencia para que el
  // filtro de "solo interesados" se calcule contra las categorías del
  // sorteo (fase 116), no contra las de la comunidad. Si el sorteo no
  // tiene categorías propias, el backend usa las de la comunidad como
  // fallback (mismo esquema que ya usan los eventos con sus propias
  // categorías).
  const raffleCategories = useMemo(() => {
    const src = isRenew ? renewRaffle?.categories : draft?.categories;
    return Array.isArray(src) ? src.filter(Boolean) : [];
  }, [isRenew, renewRaffle, draft]);

  const categoriesQuery = raffleCategories.length
    ? `categories=${encodeURIComponent(JSON.stringify(raffleCategories))}`
    : '';

  const loadTotal = useCallback(async () => {
    setLoadingTotal(true);
    setLoadError('');
    try {
      // El total notificable no depende de categorías, pero se manda igual
      // el parámetro por consistencia con la llamada de "interesados" — el
      // backend lo ignora salvo con ?filter=interested.
      const url = categoriesQuery
        ? `/community/communities/${communityId}/raffle-audience?${categoriesQuery}`
        : `/community/communities/${communityId}/raffle-audience`;
      const data = await api.get(url);
      setTotal(data?.total ?? 0);
    } catch (e) {
      setLoadError(e.message || 'No se pudo calcular la audiencia');
    } finally {
      setLoadingTotal(false);
    }
  }, [communityId, categoriesQuery]);

  useEffect(() => {
    if (draft || isRenew) loadTotal();
  }, [draft, isRenew, loadTotal]);

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

  // Con el filtro de intereses activado, si el pool resultante no llega al
  // mínimo contratable (VIEWS_MIN) bloqueamos la contratación y ocultamos
  // el slider — no tiene sentido dejar elegir un número por debajo del
  // mínimo. SIN filtro, en cambio, dejamos crear el sorteo igualmente
  // aunque el total de usuarios de la app todavía no llegue a VIEWS_MIN
  // (fase de crecimiento con pocos usuarios): el slider sigue apareciendo
  // y no se bloquea, para no frenar la adopción temprana de la app.
  const blockedByFilterShortfall = filterInterested && audienceReady && audienceCap < VIEWS_MIN;

  // ── Precio dinámico ────────────────────────────────────────────────────
  // `maxPriceCents`: importe si TODAS las visualizaciones contratadas se
  //   entregan (techo). Se muestra siempre.
  // `estPriceCents`: importe realista teniendo en cuenta que solo se
  //   cobran los banners realmente ENSEÑADOS — si la audiencia efectiva
  //   (con o sin filtro) es menor que lo contratado, esto es lo que se
  //   facturaría en la práctica. Solo se enseña cuando aporta info
  //   distinta (contractedExceedsAudience), para no ensuciar la UI.
  const maxPriceCents = computeRaffleAdPriceCents('light', bannerViews);
  const effectiveUnits = audienceReady && audienceCap != null
    ? Math.min(bannerViews, audienceCap)
    : bannerViews;
  const estPriceCents = computeRaffleAdPriceCents('light', effectiveUnits);

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
      const url = categoriesQuery
        ? `/community/communities/${communityId}/raffle-audience?filter=interested&${categoriesQuery}`
        : `/community/communities/${communityId}/raffle-audience?filter=interested`;
      const data = await api.get(url);
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
    if (!audienceReady || blockedByFilterShortfall) return;
    setCreating(true);
    setCreateError('');
    try {
      if (isRenew) {
        // Renovación: solo aforo y filtro de intereses. El tier y la fecha
        // del sorteo se mantienen. El servidor borra los targets del ciclo
        // anterior, resetea promo_ended_at y reasigna un ciclo nuevo con los
        // parámetros que llegan aquí (ver renew-promotion en community.js).
        await api.post(`/community/raffles/${renewRaffle.id}/renew-promotion`, {
          banner_views_contracted: bannerViews,
          banner_interested_only: filterInterested,
        });
        showToast('¡Publicidad renovada! 🔄', 'success');
        navigate(`/community/${communityId}`, { replace: true });
        return;
      }
      if (!draft) return;
      const formData = new FormData();
      formData.append('title', draft.title);
      if (draft.description?.trim()) formData.append('description', draft.description.trim());
      formData.append('ends_at', draft.ends_at);
      formData.append('tier', draft.tier || 'light');
      if (draft.categories?.length) formData.append('categories', JSON.stringify(draft.categories));
      formData.append('banner_views_contracted', bannerViews);
      formData.append('banner_interested_only', filterInterested ? 'true' : 'false');
      if (draft.image_file) formData.append('image', draft.image_file);
      await api.postForm(`/community/communities/${communityId}/raffles`, formData);
      showToast('¡Sorteo creado! 🎁', 'success');
      navigate(`/community/${communityId}`, { replace: true });
    } catch (e) {
      setCreateError(e.message || (isRenew ? 'Error al renovar la publicidad' : 'Error al crear el sorteo'));
    } finally {
      setCreating(false);
    }
  }

  const audienceLabel = useMemo(() => {
    if (filterInterested) return 'usuarios interesados';
    return 'usuarios notificables';
  }, [filterInterested]);

  if (!draft && !isRenew) return null;

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
        {isRenew && (
          <div className="bg-surface-card border border-amber-500/30 rounded-2xl p-5 space-y-2">
            <p className="text-sm font-display font-bold text-surface-text">🔄 Renovando publicidad</p>
            <p className="text-[12px] text-surface-muted leading-relaxed">
              Estás renovando la publicidad de <span className="text-surface-text">{renewRaffle.title}</span>. Al confirmar, se cierra el ciclo actual: los banners pendientes se borran y se reasignan a otros usuarios con los nuevos parámetros. El sorteo en sí (fecha, tier, participantes) se mantiene.
            </p>
          </div>
        )}

        {/* Resumen del sorteo en creación */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-1">
          <h2 className="font-display font-bold text-surface-text text-sm truncate">
            {isRenew ? renewRaffle.title : (draft?.title || 'Nuevo sorteo')}
          </h2>
          <p className="text-xs font-mono text-surface-muted truncate">
            👥 {communityName}
          </p>
        </div>

        {/* Detalles del plan Light. La píldora superior derecha enseña
            la tarifa POR UNIDAD (céntimos/visualización); el importe
            total contratado (dinámico según el slider) va abajo, junto
            al slider de visualizaciones. */}
        <div className={`bg-surface-card border rounded-2xl p-5 space-y-3 transition-colors ${LIGHT_META.ring}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base font-display font-bold text-surface-text">
              <span className="text-xl">{LIGHT_META.emoji}</span>
              {LIGHT_META.label}
            </span>
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${LIGHT_META.pill}`}>
              {formatEurFromCents(RAFFLE_AD_PRICING.light.unitPriceCents)} / {RAFFLE_AD_PRICING.light.unitLabel}
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
                  Ni el sorteo ni la comunidad tienen categorías de intereses definidas. Añade categorías al sorteo o edita el perfil de la comunidad para poder filtrar por interesados.
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
            solo se entregarán los banners que quepan (ver assignRaffleBannerTargets).
            Excepción: con el filtro de intereses activo y por debajo del
            mínimo contratable, ocultamos el slider y bloqueamos la
            creación (ver blockedByFilterShortfall). */}
        {blockedByFilterShortfall ? (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-1">
            <p className="text-sm text-surface-muted leading-relaxed">
              Con el filtro de intereses activo solo hay {Number(audienceCap).toLocaleString('es-ES')} usuarios interesados, por debajo del mínimo contratable ({VIEWS_MIN.toLocaleString('es-ES')}).
            </p>
            <p className="text-xs text-surface-muted">Desactiva el filtro para poder contratar publicidad.</p>
          </div>
        ) : (
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

          {/* Desglose de precio dinámico. Sustituye a la píldora estática
              '20 €' que había antes en el detalle del plan. Se
              recalcula en directo con el slider; si la audiencia
              efectiva queda por debajo, mostramos el importe estimado
              real (solo se cobra lo entregado). */}
          <div className="border-t border-surface-border/60 pt-2 mt-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-surface-muted">💶 Importe contratado</span>
              <span className={`text-sm font-display font-bold ${LIGHT_META.audienceText}`}>
                {formatEurFromCents(maxPriceCents)}
              </span>
            </div>
            {contractedExceedsAudience && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-surface-muted">Estimado a facturar</span>
                <span className="text-xs font-mono font-semibold text-surface-text">
                  {formatEurFromCents(estPriceCents)}
                </span>
              </div>
            )}
            <p className="text-[10px] font-mono text-surface-muted leading-relaxed">
              {formatEurFromCents(RAFFLE_AD_PRICING.light.unitPriceCents)} por visualización entregada.
            </p>
          </div>

          <p className="text-[10px] font-mono text-surface-muted">
            ℹ️ Si no se alcanzan {CHARGE_MIN} banners enseñados no se cobrará nada.
          </p>
        </div>
        )}

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
          disabled={creating || !audienceReady || blockedByFilterShortfall}
          className={`w-full py-3.5 rounded-xl font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98] ${LIGHT_META.button}`}
        >
          {creating
            ? (isRenew ? 'Renovando...' : 'Creando...')
            : (isRenew ? '🔄 Renovar publicidad' : '🎁 Crear sorteo Light')}
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
