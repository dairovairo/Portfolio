import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import AudienceCircleMap from '../components/AudienceCircleMap';
import { EVENT_AD_PRICING, FREE_UNITS, MIN_UNITS, UNITS_STEP, computeEventAdPriceCents, formatEurFromCents } from '../lib/adPricing';
import { useTranslation } from '../i18n';
import WalletInline from '../components/WalletInline';
import { FreePromoNote } from '../components/FreePromo';
import { PAYMENTS_ENABLED } from '../lib/features';

// ── Configuración de publicidad de un evento Premium / Ultra ──────────────────
// Pantalla a la que se llega al pulsar "Configurar publicidad" en el modal
// de creación de evento (tanto en CommunityPage.jsx — evento suelto — como
// en CommunityDetailPage.jsx — evento de una comunidad) cuando el plan
// seleccionado es 'premium' o 'ultra'. El evento TODAVÍA no se ha creado
// en este punto — los datos rellenados en el modal viajan aquí como
// "draft" a través del state de navegación. Aquí se puede alternar entre
// Premium/Ultra con la tira superior (preseleccionado el que se escogió
// en el modal), y se elige cuántas notificaciones contratar. El evento
// se crea de verdad al confirmar aquí abajo, con la misma llamada que
// harían las páginas de origen (`POST /community/events`), incluyendo
// `community_id` si el draft venía de una comunidad concreta.
//
// El slider es el mismo para Premium y Ultra y llega como mucho a la audiencia
// que existe. Se paga por lo entregado y las primeras unidades de la campaña
// son gratis (lib/adPricing.js). El resto del formulario del evento (título,
// categorías, fecha...) no se edita aquí: para eso está Atrás.
const NOTIF_MAX = 50000;
const DEFAULT_COUNT = 500;

const PLAN_META = {
  premium: {
    emoji: '⚡',
    labelKey: 'planPremium',
    fullKey: 'planPremiumFull',
    accent: 'purple',
    ring: 'border-purple-400 bg-purple-500/10',
    pill: 'text-purple-300 bg-purple-500/10 border border-purple-500/20',
    check: 'text-purple-300',
    slider: 'accent-purple-400',
    button: 'bg-purple-500 hover:bg-purple-400 text-white',
    includeKeys: ['premiumInc1', 'premiumInc2', 'premiumInc3', 'premiumInc4'],
  },
  ultra: {
    emoji: '🚀',
    labelKey: 'planUltra',
    fullKey: 'planUltraFull',
    accent: 'blue',
    ring: 'border-accent-primary bg-accent-primary/10',
    pill: 'text-accent-glow bg-accent-primary/10 border border-accent-primary/20',
    check: 'text-accent-glow',
    slider: 'accent-accent-primary',
    button: 'bg-accent-primary hover:bg-accent-primary/80 text-white',
    includeKeys: ['premiumInc1', 'premiumInc2', 'premiumInc3', 'ultraInc4', 'ultraInc5'],
  },
};

function buildEventFormData(draft, plan, notificationCount, options = {}) {
  const {
    interestedOnly = false,
    locationFilter = null, // { centerLat, centerLng, radiusKm } | null
  } = options;

  const formData = new FormData();
  // Copiamos todo el draft salvo los metadatos internos y la portada, que
  // van aparte. `custom_category` ya está resuelta dentro de `categories`.
  const skip = new Set([
    'cover_file',
    'custom_category',
    'communityId',
    'communityName',
    'origin',
    'promotion_plan',
    'notification_count',
  ]);
  Object.entries(draft).forEach(([key, value]) => {
    if (skip.has(key)) return;
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) formData.append(key, JSON.stringify(value));
      return;
    }
    formData.append(key, String(value));
  });

  formData.append('promotion_plan', plan);
  formData.append('notification_count', String(notificationCount));

  // Fase 108: community_id es obligatorio, todo evento pertenece a una
  // comunidad. Se valida además en el propio POST /events (server), y la
  // guarda en useEffect de más abajo hace kick-out si el draft llegara sin él.
  formData.append('community_id', draft.communityId);

  // Fase 105: filtro duro de intereses (opcional, solo Premium/Ultra).
  if (interestedOnly) formData.append('audience_interested_only', 'true');

  // Fase 110: filtro duro por ubicación (opcional, solo Premium/Ultra).
  // El servidor exige los tres campos o ninguno.
  if (locationFilter) {
    formData.append('audience_center_lat', String(locationFilter.centerLat));
    formData.append('audience_center_lng', String(locationFilter.centerLng));
    formData.append('audience_radius_km',  String(locationFilter.radiusKm));
  }

  if (draft.cover_file) formData.append('cover', draft.cover_file);

  return formData;
}

export default function EventAdConfigPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t, lang } = useTranslation();
  const localeTag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';

  // Fase 112 — la misma página cubre dos flujos:
  //
  //   · CREACIÓN (state.draft): viene del modal de crear evento. El evento
  //     todavía no existe; al confirmar se llama a POST /community/events
  //     y el evento nace con los datos del formulario + los que se eligen
  //     aquí (plan, cuota, filtros).
  //
  //   · RENOVACIÓN (state.renewEvent): viene del dashboard de publicidad o
  //     del detalle del propio evento. El evento YA existe; aquí solo se
  //     retocan plan y cuota, y al confirmar se llama a POST
  //     /events/:id/renew-promotion. Ni el título ni la audiencia se pueden
  //     tocar en este flujo — para eso hay que crear otro evento.
  //
  // Se distinguen por qué objeto trae el state; los dos son excluyentes.
  const draft = location.state?.draft || null;
  const renewEvent = location.state?.renewEvent || null;
  const isRenew = !!renewEvent;

  // El plan inicial: en creación, lo que trae el draft del modal; en
  // renovación, el plan que YA tiene contratado el evento (así al usuario
  // le sale prerreadatado exactamente lo que iba a renovar).
  // Sin pagos solo hay una promoción: la completa (Ultra).
  const initialPlan = !PAYMENTS_ENABLED || (isRenew ? renewEvent : draft)?.promotion_plan === 'ultra'
    ? 'ultra' : 'premium';
  const [plan, setPlan] = useState(initialPlan);
  const initialCount = isRenew
    ? Number(renewEvent.notification_count) || DEFAULT_COUNT
    : Number(draft?.notification_count) || DEFAULT_COUNT;
  const [notificationCount, setNotificationCount] = useState(
    Math.min(Math.max(initialCount, MIN_UNITS), NOTIF_MAX)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [insufficientFunds, setInsufficientFunds] = useState(false);

  // ── Audiencia (usuarios notificables) ─────────────────────────────────
  // Mismo patrón que RaffleAdAudiencePage: al montar la pantalla se pide
  // el tamaño total del pool (POST /community/events/promotion-audience) y,
  // si el usuario activa el filtro de intereses, se hace una segunda
  // llamada que cruza users.interests con las categorías del evento (que
  // vienen ya resueltas en el draft — sin OTHER_CATEGORY, con la
  // custom_category ya sustituida).
  const [loadingTotal, setLoadingTotal] = useState(true);
  const [total, setTotal] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [freeUnits, setFreeUnits] = useState(FREE_UNITS);
  const [freePromo, setFreePromo] = useState(null); // cupo de promociones gratis

  const [filterInterested, setFilterInterested] = useState(false);
  const [loadingInterested, setLoadingInterested] = useState(false);
  const [interested, setInterested] = useState(null);
  const [categoriesDefined, setCategoriesDefined] = useState(null);

  // Fase 110: filtro por ubicación — círculo alrededor del punto del
  // evento (draft.lat/draft.lng). Se activa/desactiva con el toggle; el
  // radio (radiusKm) se ajusta con el slider y se debouncea a la hora de
  // recontar audiencia para no saturar el endpoint mientras se arrastra.
  //
  // `nearby` es el conteo sin cruzar con intereses; `interestedNearby` es
  // el cruce ambos-filtros — solo se calcula si además filterInterested
  // está activo. Igual que interested, si el evento no trae lat/lng
  // válidos (no debería pasar en el flujo normal pero por seguridad), el
  // filtro no se puede activar.
  const DEFAULT_RADIUS_KM = 25;
  const canFilterLocation = draft?.lat != null && draft?.lng != null;
  const [filterLocation, setFilterLocation] = useState(false);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [nearby, setNearby] = useState(null);
  const [interestedNearby, setInterestedNearby] = useState(null);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const nearbyDebounceRef = useRef(null);

  // Sin borrador (creación) ni renewEvent (renovación) no hay nada que
  // configurar y volvemos al menú de comunidad. Igual si el borrador de
  // creación llegó sin communityId — desde fase 108 los eventos deben
  // pertenecer a una comunidad, no debería ocurrir con el flujo normal
  // desde CommunityDetailPage, pero es guarda ante navegación
  // manual/estado corrupto. En renovación no se pide communityId porque
  // se navega al detalle del evento, no a la comunidad.
  useEffect(() => {
    if (isRenew) {
      if (!renewEvent?.id) navigate('/community', { replace: true });
      return;
    }
    if (draft?.communityId) return;
    navigate('/community', { replace: true });
  }, [draft, renewEvent, isRenew, navigate]);

  const draftCategories = useMemo(
    () => (isRenew ? [] : Array.isArray(draft?.categories) ? draft.categories.filter(Boolean) : []),
    [draft, isRenew]
  );
  const categoriesQueryParam = useMemo(
    () => (draftCategories.length ? encodeURIComponent(JSON.stringify(draftCategories)) : ''),
    [draftCategories]
  );

  const loadTotal = useCallback(async () => {
    setLoadingTotal(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ community_id: isRenew ? renewEvent.community_id : draft.communityId });
      if (isRenew) params.set('event_id', renewEvent.id);
      const data = await api.get(`/community/events/promotion-audience?${params}`);
      setTotal(data?.total ?? 0);
      setFreeUnits(data?.free_units ?? FREE_UNITS);
      setFreePromo(data?.free_promo ?? null);
    } catch (e) {
      setLoadError(e.message || t('adConfig.audienceCalcError'));
    } finally {
      setLoadingTotal(false);
    }
  }, [draft, renewEvent, isRenew, t]);

  useEffect(() => {
    if (renewEvent?.community_id || draft?.communityId) loadTotal();
  }, [draft, renewEvent, loadTotal]);

  // Fase 110: recontar `nearby` cada vez que cambian los inputs (radio,
  // toggle de ubicación, toggle de intereses) con 300 ms de debounce
  // para el arrastre del slider. Si el filtro está desactivado, dejamos
  // los conteos en null (nada que mostrar). Si además el filtro de
  // intereses está activo, la misma llamada devuelve
  // `interested_nearby` = intersección de ambos filtros.
  useEffect(() => {
    if (nearbyDebounceRef.current) clearTimeout(nearbyDebounceRef.current);
    if (!filterLocation || !canFilterLocation || !draft?.communityId) {
      setNearby(null);
      setInterestedNearby(null);
      return;
    }
    nearbyDebounceRef.current = setTimeout(async () => {
      setLoadingNearby(true);
      try {
        const params = new URLSearchParams({
          community_id: draft.communityId,
          center_lat: String(draft.lat),
          center_lng: String(draft.lng),
          radius_km: String(radiusKm),
        });
        if (filterInterested && draftCategories.length) {
          params.set('filter', 'interested');
          params.set('categories', JSON.stringify(draftCategories));
        }
        const data = await api.get(`/community/events/promotion-audience?${params.toString()}`);
        setNearby(data?.nearby ?? 0);
        setInterestedNearby(data?.interested_nearby ?? null);
      } catch (e) {
        showToast(e.message || t('adConfig.audienceLocError'), 'error');
      } finally {
        setLoadingNearby(false);
      }
    }, 300);
    return () => { if (nearbyDebounceRef.current) clearTimeout(nearbyDebounceRef.current); };
  }, [filterLocation, radiusKm, filterInterested, canFilterLocation, draft, draftCategories, showToast]);

  // Audiencia efectiva con los filtros activos. Al renovar se conservan los
  // del evento, que aquí no se conocen: se usa el total y el servidor recorta.
  const audienceCap = filterLocation && filterInterested
    ? (categoriesDefined === false ? 0 : interestedNearby)
    : filterLocation
      ? nearby
      : filterInterested
        ? (categoriesDefined === false ? 0 : interested)
        : total;
  const audienceReady = isRenew || (audienceCap != null && !loadingInterested && !loadingNearby);
  // No se puede contratar más de lo que existe (mínimo MIN_UNITS).
  const notifMax = freePromo?.max_units ?? NOTIF_MAX;
  const sliderMax = audienceCap == null
    ? notifMax
    : Math.min(notifMax, Math.max(MIN_UNITS, Math.ceil(audienceCap / UNITS_STEP) * UNITS_STEP));
  const units = Math.min(notificationCount, sliderMax);
  const contractedExceedsAudience = audienceReady && audienceCap != null && units > audienceCap;
  const nobodyMatches = !isRenew && (filterInterested || filterLocation) && audienceReady && audienceCap === 0;

  async function handleToggleInterested() {
    const next = !filterInterested;
    if (!next) {
      setFilterInterested(false);
      return;
    }
    setFilterInterested(true);
    if (interested != null || categoriesDefined === false) return;
    if (!draftCategories.length) {
      setCategoriesDefined(false);
      return;
    }
    setLoadingInterested(true);
    try {
      const communityParam = `&community_id=${encodeURIComponent(draft.communityId)}`;
      const data = await api.get(
        `/community/events/promotion-audience?filter=interested&categories=${categoriesQueryParam}${communityParam}`
      );
      setInterested(data?.interested ?? null);
      setCategoriesDefined(Boolean(data?.categories_defined));
    } catch (e) {
      showToast(e.message || t('adConfig.interestFilterError'), 'error');
      setFilterInterested(false);
    } finally {
      setLoadingInterested(false);
    }
  }

  const meta = PLAN_META[plan] || PLAN_META.premium;

  // Importe máximo (lo que se reserva) y, si hay menos audiencia que unidades,
  // lo que se cobraría como mucho de verdad.
  const maxPriceCents = computeEventAdPriceCents(plan, units, freeUnits);
  const estPriceCents = computeEventAdPriceCents(
    plan, audienceCap != null ? Math.min(units, audienceCap) : units, freeUnits);

  // En creación se vuelve al perfil de la comunidad; en renovación, al
  // detalle del propio evento (donde estaba el botón "Renovar publicidad"
  // que arrancó el flujo, ver EventDetailPage.jsx). Ese es también el
  // sitio donde el usuario ve el efecto del cambio nada más terminar.
  const backTarget = useMemo(
    () => (isRenew
      ? `/community/event/${renewEvent.id}`
      : `/community/${draft?.communityId ?? ''}`),
    [draft, isRenew, renewEvent]
  );

  const headerSubtitle = isRenew
    ? t('adConfig.renewSubtitle', { title: renewEvent.title })
    : (draft?.communityName ? t('adConfig.eventInSubtitle', { name: draft.communityName }) : t('adConfig.newEventSubtitle'));

  async function handlePublish() {
    if (!audienceReady || nobodyMatches) return;
    setSaving(true);
    setError('');
    try {
      if (isRenew) {
        // Renovación: el endpoint solo acepta plan y cuota (los filtros de
        // audiencia son atributos del evento y no se cambian por aquí). Al
        // completar, el ciclo actual queda cerrado y arranca uno nuevo:
        // notification_sent_count vuelve a 0 y se re-notifica a los
        // miembros de la comunidad.
        await api.post(`/community/events/${renewEvent.id}/renew-promotion`, {
          promotion_plan: plan,
          notification_count: units,
        });
        showToast(t('adConfig.adRenewedToast'), 'success');
      } else {
        if (!draft) return;
        const formData = buildEventFormData(draft, plan, units, {
          interestedOnly: filterInterested,
          locationFilter: filterLocation && canFilterLocation
            ? { centerLat: draft.lat, centerLng: draft.lng, radiusKm }
            : null,
        });
        await api.postForm('/community/events', formData);
        showToast(t('adConfig.eventCreatedToast'), 'success');
      }
      navigate(backTarget, { replace: true });
    } catch (e) {
      setInsufficientFunds(e?.code === 'INSUFFICIENT_FUNDS');
      setError(e.message || (isRenew ? t('adConfig.errRenew') : t('adConfig.errCreate')));
    } finally {
      setSaving(false);
    }
  }

  if (!isRenew && !draft?.communityId) return null;
  if (isRenew && !renewEvent?.id) return null;

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
            <h1 className="font-display font-bold text-surface-text text-base truncate">{t('adConfig.configTitle')}</h1>
            <p className="text-xs font-mono text-surface-muted truncate">{headerSubtitle}</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-32 pt-4 space-y-4">
        {/* Resumen del evento en creación */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-1">
          <h2 className="font-display font-bold text-surface-text text-sm truncate">
            {(isRenew ? renewEvent.title : draft.title) || t('adConfig.newEventTitle')}
          </h2>
          {!isRenew && (
            <p className="text-xs font-mono text-surface-muted truncate">
              👥 {draft.communityName}
            </p>
          )}
        </div>

        {/* ── Selector Premium / Ultra ──────────────────────────────────
            Arriba del todo, un segmented control con las dos opciones,
            preseleccionada la que se escogió en el modal. Al alternar,
            debajo se actualizan el precio, las prestaciones y el color
            del slider/botón acorde al plan. */}
        {PAYMENTS_ENABLED && (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-2">
          <div
            role="tablist"
            aria-label={t('adConfig.planTablabel')}
            className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-surface-bg border border-surface-border"
          >
            {['premium', 'ultra'].map(key => {
              const opt = PLAN_META[key];
              const selected = plan === key;
              const selectedBg = key === 'premium'
                ? 'bg-purple-500/20 border-purple-400/60 text-purple-100'
                : 'bg-accent-primary/20 border-accent-primary/60 text-accent-glow';
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setPlan(key)}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-sm font-display font-bold transition-all ${
                    selected
                      ? selectedBg
                      : 'border-transparent text-surface-muted hover:text-surface-text hover:bg-surface-card'
                  }`}
                >
                  <span className="text-base">{opt.emoji}</span>
                  <span>{t('adConfig.' + opt.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* Detalles del plan seleccionado. La píldora superior derecha
            enseña la tarifa POR UNIDAD (céntimos/notificación); el
            importe total contratado (dinámico según el slider) va en el
            bloque de notificaciones, junto al slider, para que se vea
            actualizarse en directo al arrastrar. */}
        <div className={`bg-surface-card border rounded-2xl p-5 space-y-3 transition-colors ${meta.ring}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base font-display font-bold text-surface-text">
              <span className="text-xl">{meta.emoji}</span>
              {t('adConfig.' + meta.fullKey)}
            </span>
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>
              {PAYMENTS_ENABLED
                ? t('adConfig.perUnit', { price: formatEurFromCents(EVENT_AD_PRICING[plan].unitPriceCents), unit: t('adConfig.unitNotification') })
                : t('free.tag')}
            </span>
          </div>
          <ul className="space-y-1.5 text-[12px] font-mono text-surface-muted leading-relaxed">
            {meta.includeKeys.map((key, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`${meta.check} flex-shrink-0`}>✓</span>
                <span>{t('adConfig.' + key)}</span>
              </li>
            ))}
          </ul>
        </div>

        {isRenew ? (
          <div className="bg-surface-card border border-accent-primary/30 rounded-2xl p-5 space-y-2">
            <p className="text-sm font-display font-bold text-surface-text">{t('adConfig.renewBlockTitle')}</p>
            <p className="text-[12px] text-surface-muted leading-relaxed">
              {t('adConfig.renewBlockExplain', { title: renewEvent.title })}
            </p>
          </div>
        ) : (
        <>
        {/* ── Audiencia total notificable ────────────────────────────────
            Usuarios de la app (fuera del propio creador) a los que puede
            llegar la notificación Premium/Ultra de este evento. Es el
            pool del que luego el pacing (server/jobs/eventPromoPacing.js)
            sortea a quién notificar cada tick. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-2">
          <p className="text-xs font-mono text-surface-muted uppercase tracking-wide">{t('adConfig.audienceHeader')}</p>
          {loadingTotal ? (
            <div className="h-10 flex items-center justify-center">
              <span className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : loadError ? (
            <div className="space-y-2">
              <p className="text-xs text-red-400">{loadError}</p>
              <button
                type="button"
                onClick={loadTotal}
                className="text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
              >
                {t('adConfig.retry')}
              </button>
            </div>
          ) : (
            <p className={`font-display font-bold text-4xl ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
              {Number(total).toLocaleString(localeTag)}
            </p>
          )}
          <p className="text-[11px] text-surface-muted leading-relaxed">
            {t('adConfig.audienceExplain')}
          </p>
        </div>

        {/* ── Filtro por intereses ───────────────────────────────────────
            Al activarse, se pide al servidor cuántos de los notificables
            tienen entre sus intereses alguna de las categorías del evento
            (users.interests ∩ event.categories, ver
            /events/promotion-audience?filter=interested). El slider se
            recalcula usando este número como techo. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-display font-bold text-surface-text">{t('adConfig.filterInterestTitle')}</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                {t('adConfig.filterInterestHint')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={filterInterested}
              onClick={handleToggleInterested}
              disabled={loadingTotal || !!loadError}
              className={`relative inline-flex h-7 w-12 items-center rounded-full flex-shrink-0 transition-colors disabled:opacity-40 focus:outline-none ${
                filterInterested
                  ? (plan === 'ultra' ? 'bg-accent-primary' : 'bg-purple-500')
                  : 'bg-surface-bg border border-surface-border'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                  filterInterested ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {filterInterested && (
            loadingInterested ? (
              <div className="text-center py-2">
                <span className={`w-5 h-5 border-2 border-t-transparent rounded-full animate-spin inline-block ${plan === 'ultra' ? 'border-accent-primary' : 'border-purple-400'}`} />
              </div>
            ) : categoriesDefined === false ? (
              <div className="text-center py-1 space-y-2 border-t border-surface-border/60 pt-3">
                <p className="text-xs text-surface-muted leading-relaxed">
                  {t('adConfig.noCategoriesNote')}
                </p>
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
                >
                  {t('adConfig.backToForm')}
                </button>
              </div>
            ) : (
              <div className="text-center py-1 border-t border-surface-border/60 pt-3">
                <p className={`font-display font-bold text-2xl ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
                  {Number(interested).toLocaleString(localeTag)}
                </p>
                <p className="text-[11px] text-surface-muted mt-1">
                  {t('adConfig.interestedOfTotal', { total: Number(total).toLocaleString(localeTag) })}
                </p>
              </div>
            )
          )}
        </div>

        {/* ── Filtro por ubicación (fase 110) ────────────────────────────
            Círculo alrededor del punto del evento (draft.lat/lng). El
            slider ajusta el radio de 1 a 500 km; el mapa se redibuja
            en directo. Al activarse (o al mover el slider), se pide al
            servidor cuántos usuarios notificables tienen home_lat/lng
            dentro del círculo (y, si además hay filtro de intereses,
            cuántos cumplen ambas cosas). El slider general se recalcula
            con este número como techo. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-display font-bold text-surface-text">{t('adConfig.filterLocationTitle')}</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                {canFilterLocation
                  ? t('adConfig.filterLocationHint')
                  : t('adConfig.noLocationHint')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={filterLocation}
              onClick={() => canFilterLocation && setFilterLocation(v => !v)}
              disabled={!canFilterLocation || loadingTotal || !!loadError}
              className={`relative inline-flex h-7 w-12 items-center rounded-full flex-shrink-0 transition-colors disabled:opacity-40 focus:outline-none ${
                filterLocation
                  ? (plan === 'ultra' ? 'bg-accent-primary' : 'bg-purple-500')
                  : 'bg-surface-bg border border-surface-border'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                  filterLocation ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {filterLocation && canFilterLocation && (
            <div className="space-y-3 border-t border-surface-border/60 pt-3">
              <AudienceCircleMap
                centerLat={draft.lat}
                centerLng={draft.lng}
                radiusKm={radiusKm}
              />
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={500}
                  step={1}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className={`flex-1 accent-green-500`}
                  aria-label={t('adConfig.radiusLabel')}
                />
                <span className="text-xs font-mono text-surface-muted w-16 text-right">
                  {t('adConfig.radiusKm', { n: radiusKm })}
                </span>
              </div>
              <div className="text-center py-1">
                {loadingNearby ? (
                  <span className={`w-5 h-5 border-2 border-t-transparent rounded-full animate-spin inline-block ${plan === 'ultra' ? 'border-accent-primary' : 'border-purple-400'}`} />
                ) : (
                  <>
                    <p className={`font-display font-bold text-2xl ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
                      {Number(
                        filterInterested && interestedNearby != null ? interestedNearby : (nearby ?? 0)
                      ).toLocaleString(localeTag)}
                    </p>
                    <p className="text-[11px] text-surface-muted mt-1">
                      {filterInterested && interestedNearby != null
                        ? t('adConfig.nearbyBothFilters', { n: radiusKm })
                        : t('adConfig.nearbyOnly', { n: radiusKm })}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        </>
        )}

        {nobodyMatches ? (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-1">
            <p className="text-sm text-surface-muted leading-relaxed">{t('adConfig.nobodyMatches')}</p>
            <p className="text-xs text-surface-muted">{t('adConfig.belowMinHint')}</p>
          </div>
        ) : (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-mono text-surface-muted">
              {t('adConfig.contractSlots')}
            </label>
            <span className="text-xs font-mono font-semibold text-surface-text">
              {units.toLocaleString(localeTag)}
            </span>
          </div>

          <input
            type="range"
            min={MIN_UNITS}
            max={sliderMax}
            step={UNITS_STEP}
            value={units}
            disabled={sliderMax === MIN_UNITS}
            onChange={e => setNotificationCount(Number(e.target.value))}
            className={`w-full ${meta.slider} cursor-pointer`}
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-surface-muted">
            <span>{t('adConfig.minLbl', { n: MIN_UNITS.toLocaleString(localeTag) })}</span>
            <span>{t('adConfig.maxLbl', { n: sliderMax.toLocaleString(localeTag) })}</span>
          </div>

          {contractedExceedsAudience && (
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 leading-relaxed">
              {(() => {
                const nStr = Number(audienceCap).toLocaleString(localeTag);
                const key = filterInterested && filterLocation ? 'audCapWarnBoth'
                  : filterInterested ? 'audCapWarnInt'
                  : filterLocation ? 'audCapWarnLoc'
                  : 'audCapWarnGeneric';
                return t('adConfig.' + key, { n: nStr, n2: nStr });
              })()}
            </p>
          )}

          {PAYMENTS_ENABLED && (
          <>
          <div className="border-t border-surface-border/60 pt-2 mt-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-surface-muted">{t('adConfig.priceContracted')}</span>
              <span className={`text-sm font-display font-bold ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
                {formatEurFromCents(maxPriceCents)}
              </span>
            </div>
            {contractedExceedsAudience && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-surface-muted">{t('adConfig.priceEstBilled')}</span>
                <span className="text-xs font-mono font-semibold text-surface-text">
                  {formatEurFromCents(estPriceCents)}
                </span>
              </div>
            )}
            <p className="text-[10px] font-mono text-surface-muted leading-relaxed">
              {t('adConfig.pricePerNotif', { price: formatEurFromCents(EVENT_AD_PRICING[plan].unitPriceCents) })}
              {EVENT_AD_PRICING[plan].bannerPriceCents > 0 && (
                <> {t('adConfig.pricePerBanner', { price: formatEurFromCents(EVENT_AD_PRICING[plan].bannerPriceCents) })}</>
              )}
            </p>
          </div>

          <p className="text-[10px] font-mono text-surface-muted">
            {freeUnits > 0 ? t('adConfig.freeUnitsNote', { n: freeUnits }) : t('adConfig.noFreeUnitsNote')}
          </p>
          </>
          )}
        </div>
        )}

        {/* Notas informativas — mismas que estaban antes en el modal */}
        <div className="space-y-2">
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.note1')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.note2')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.note3')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.note4')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.note5')}
          </p>
        </div>

        <WalletInline neededCents={estPriceCents} warn={!isRenew} forceInsufficient={insufficientFunds} />
        <FreePromoNote status={freePromo} />

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
            {error}
          </p>
        )}

        <button
          onClick={handlePublish}
          disabled={saving || !audienceReady || nobodyMatches}
          className={`w-full py-3.5 rounded-xl font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98] ${meta.button}`}
        >
          {saving ? (isRenew ? t('adConfig.renewing') : t('adConfig.publishing')) : (isRenew ? t('adConfig.renewBtn', { plan: t('adConfig.' + meta.labelKey) }) : t('adConfig.publishBtn', { plan: t('adConfig.' + meta.labelKey) }))}
        </button>
      </main>
    </div>
  );
}
