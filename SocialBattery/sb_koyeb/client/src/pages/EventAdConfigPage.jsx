import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import AudienceCircleMap from '../components/AudienceCircleMap';
import { EVENT_AD_PRICING, computeEventAdPriceCents, formatEurFromCents } from '../lib/adPricing';

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
// El slider (500–50.000) es el mismo para Premium y Ultra y siempre
// operativo — lo que cambia entre planes es la insignia, el precio y las
// prestaciones (Ultra añade apariciones en el banner del menú principal).
// Si la audiencia (con o sin filtro de intereses) queda por debajo de lo
// contratado, se avisa con un banner ámbar bajo el slider; el pacing solo
// enviará las notificaciones que quepan y no se cobrará por el resto
// (ver eventPromoPacing.js). El resto del formulario del evento (título,
// categorías, fecha, ubicación...) NO se puede editar aquí — si el
// usuario quiere retocarlo, pulsa Atrás y vuelve al modal.
const NOTIF_MIN = 500;
const NOTIF_MAX = 50000;
const NOTIF_STEP = 500;

const PLAN_META = {
  premium: {
    emoji: '⚡',
    label: 'Premium',
    // Precio dinámico — se calcula abajo con computeEventAdPriceCents en
    // función de las notificaciones contratadas. Ya no hay tarifa
    // estática aquí (antes: '10 €' fijo, que era el precio del mínimo
    // contratable y engañaba al escalar el slider). Ver lib/adPricing.js.
    accent: 'purple',
    ring: 'border-purple-400 bg-purple-500/10',
    pill: 'text-purple-300 bg-purple-500/10 border border-purple-500/20',
    check: 'text-purple-300',
    slider: 'accent-purple-400',
    button: 'bg-purple-500 hover:bg-purple-400 text-white',
    includes: [
      'Aparición en lista de eventos',
      'Notificaciones a miembros de la comunidad',
      'Notificaciones a número de usuarios contratado',
      'Insignia premium',
    ],
  },
  ultra: {
    emoji: '🚀',
    label: 'Ultra',
    // Precio dinámico — ver comentario en `premium` arriba.
    accent: 'blue',
    ring: 'border-accent-primary bg-accent-primary/10',
    pill: 'text-accent-glow bg-accent-primary/10 border border-accent-primary/20',
    check: 'text-accent-glow',
    slider: 'accent-accent-primary',
    button: 'bg-accent-primary hover:bg-accent-primary/80 text-white',
    includes: [
      'Aparición en lista de eventos',
      'Notificaciones a miembros de la comunidad',
      'Notificaciones a número de usuarios contratado',
      'Apariciones en banner menú principal a número de usuarios contratado',
      'Insignia ultra',
    ],
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
  const initialPlan = isRenew
    ? (renewEvent.promotion_plan === 'ultra' ? 'ultra' : 'premium')
    : (draft?.promotion_plan === 'ultra' ? 'ultra' : 'premium');
  const [plan, setPlan] = useState(initialPlan);
  const initialCount = isRenew
    ? Number(renewEvent.notification_count) || NOTIF_MIN
    : Number(draft?.notification_count) || NOTIF_MIN;
  const [notificationCount, setNotificationCount] = useState(
    Math.min(Math.max(initialCount, NOTIF_MIN), NOTIF_MAX)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    if (isRenew) {
      // Renovación: la audiencia del evento ya está fijada. Simulamos
      // "carga terminada" para que el gate audienceReady deje pasar al
      // botón de renovar sin bloquear.
      setLoadingTotal(false);
      setTotal(null);
      return;
    }
    setLoadingTotal(true);
    setLoadError('');
    try {
      const query = `?community_id=${encodeURIComponent(draft.communityId)}`;
      const data = await api.get(`/community/events/promotion-audience${query}`);
      setTotal(data?.total ?? 0);
    } catch (e) {
      setLoadError(e.message || 'No se pudo calcular la audiencia');
    } finally {
      setLoadingTotal(false);
    }
  }, [draft, isRenew]);

  useEffect(() => {
    if (isRenew || draft?.communityId) loadTotal();
  }, [draft, isRenew, loadTotal]);

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
        showToast(e.message || 'No se pudo calcular audiencia por ubicación', 'error');
      } finally {
        setLoadingNearby(false);
      }
    }, 300);
    return () => { if (nearbyDebounceRef.current) clearTimeout(nearbyDebounceRef.current); };
  }, [filterLocation, radiusKm, filterInterested, canFilterLocation, draft, draftCategories, showToast]);

  // Audiencia efectiva teniendo en cuenta filtros activos. Si están los
  // dos (intereses + ubicación), gana la intersección. Si solo uno, ese.
  // Si ninguno, el total notificable. En renovación la audiencia no se
  // recalcula (el evento ya existe con la suya fijada), así que se
  // "corta" antes: audienceReady=true incondicional para no bloquear el
  // botón, y blockedByFilterShortfall=false por el mismo motivo.
  const audienceCap = isRenew
    ? null
    : filterLocation && filterInterested
      ? (categoriesDefined === false ? 0 : interestedNearby)
      : filterLocation
        ? nearby
        : filterInterested
          ? (categoriesDefined === false ? 0 : interested)
          : total;
  const audienceReady = isRenew || (audienceCap != null && !loadingInterested && !loadingNearby);
  const contractedExceedsAudience = !isRenew && audienceReady && notificationCount > audienceCap;

  // Con cualquier filtro DURO activo (intereses o ubicación), si el pool
  // resultante no llega al mínimo contratable (NOTIF_MIN) bloqueamos la
  // publicación y ocultamos el slider. SIN filtros duros, dejamos publicar
  // aunque el pool no llegue (fase de crecimiento con pocos usuarios). En
  // renovación no hay filtros a cambiar aquí, así que esto no aplica.
  const blockedByFilterShortfall = !isRenew && (filterInterested || filterLocation) && audienceReady && audienceCap < NOTIF_MIN;

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
      showToast(e.message || 'No se pudo filtrar por intereses', 'error');
      setFilterInterested(false);
    } finally {
      setLoadingInterested(false);
    }
  }

  const meta = PLAN_META[plan] || PLAN_META.premium;

  // ── Precio dinámico ────────────────────────────────────────────────────
  // `maxPriceCents`: el techo si TODAS las notificaciones contratadas se
  //   entregan. Es lo que se enseña en grande — el "importe contratado".
  // `estPriceCents`: el importe realista teniendo en cuenta el techo de
  //   audiencia (min(contratado, audiencia efectiva) — se cobra por lo
  //   entregado, no por lo contratado). Solo se calcula en creación y
  //   cuando la audiencia excede lo contratado, para no confundir.
  const maxPriceCents = computeEventAdPriceCents(plan, notificationCount);
  const effectiveUnits = !isRenew && audienceReady && audienceCap != null
    ? Math.min(notificationCount, audienceCap)
    : notificationCount;
  const estPriceCents = computeEventAdPriceCents(plan, effectiveUnits);

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
    ? `Renovar publicidad de ${renewEvent.title}`
    : (draft?.communityName ? `Evento en ${draft.communityName}` : 'Nuevo evento');

  async function handlePublish() {
    if (!audienceReady || blockedByFilterShortfall) return;
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
          notification_count: notificationCount,
        });
        showToast('¡Publicidad renovada! 🔄', 'success');
      } else {
        if (!draft) return;
        const formData = buildEventFormData(draft, plan, notificationCount, {
          interestedOnly: filterInterested,
          locationFilter: filterLocation && canFilterLocation
            ? { centerLat: draft.lat, centerLng: draft.lng, radiusKm }
            : null,
        });
        await api.postForm('/community/events', formData);
        showToast('¡Evento creado! 🌐', 'success');
      }
      navigate(backTarget, { replace: true });
    } catch (e) {
      setError(e.message || (isRenew ? 'Error al renovar la publicidad' : 'Error al crear el evento'));
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
            <h1 className="font-display font-bold text-surface-text text-base truncate">🌐 Configurar publicidad</h1>
            <p className="text-xs font-mono text-surface-muted truncate">{headerSubtitle}</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-32 pt-4 space-y-4">
        {/* Resumen del evento en creación */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-1">
          <h2 className="font-display font-bold text-surface-text text-sm truncate">
            {draft.title || 'Nuevo evento'}
          </h2>
          {/* Desde fase 108 todo evento pertenece a una comunidad y el
              useEffect de más arriba hace kick-out si el draft llegara sin
              communityId, así que aquí siempre hay communityName. */}
          <p className="text-xs font-mono text-surface-muted truncate">
            👥 {draft.communityName}
          </p>
        </div>

        {/* ── Selector Premium / Ultra ──────────────────────────────────
            Arriba del todo, un segmented control con las dos opciones,
            preseleccionada la que se escogió en el modal. Al alternar,
            debajo se actualizan el precio, las prestaciones y el color
            del slider/botón acorde al plan. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-2">
          <div
            role="tablist"
            aria-label="Plan de publicidad"
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
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detalles del plan seleccionado. La píldora superior derecha
            enseña la tarifa POR UNIDAD (céntimos/notificación); el
            importe total contratado (dinámico según el slider) va en el
            bloque de notificaciones, junto al slider, para que se vea
            actualizarse en directo al arrastrar. */}
        <div className={`bg-surface-card border rounded-2xl p-5 space-y-3 transition-colors ${meta.ring}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base font-display font-bold text-surface-text">
              <span className="text-xl">{meta.emoji}</span>
              {meta.label} Promotion
            </span>
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>
              {formatEurFromCents(EVENT_AD_PRICING[plan].unitPriceCents)} / {EVENT_AD_PRICING[plan].unitLabel}
            </span>
          </div>
          <ul className="space-y-1.5 text-[12px] font-mono text-surface-muted leading-relaxed">
            {meta.includes.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`${meta.check} flex-shrink-0`}>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {isRenew ? (
          <div className="bg-surface-card border border-accent-primary/30 rounded-2xl p-5 space-y-2">
            <p className="text-sm font-display font-bold text-surface-text">🔄 Renovando publicidad</p>
            <p className="text-[12px] text-surface-muted leading-relaxed">
              Estás renovando la publicidad de <span className="text-surface-text">{renewEvent.title}</span>. Solo se pueden cambiar el plan y la cuota — la audiencia y los filtros del evento se mantienen. Al confirmar, se cierra el ciclo actual y arranca uno nuevo: el contador de envíos vuelve a cero y se re-notifica a los miembros de la comunidad.
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
          <p className="text-xs font-mono text-surface-muted uppercase tracking-wide">Usuarios notificables</p>
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
                Reintentar
              </button>
            </div>
          ) : (
            <p className={`font-display font-bold text-4xl ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
              {Number(total).toLocaleString('es-ES')}
            </p>
          )}
          <p className="text-[11px] text-surface-muted leading-relaxed">
            Usuarios de la app a los que puede llegar la notificación de este evento.
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
              <p className="text-sm font-display font-bold text-surface-text">🎯 Filtrar por intereses</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                Contrata solo entre los notificables cuyos intereses coincidan con alguna categoría del evento.
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
                  No definiste ninguna categoría en el evento, vuelve al paso anterior para añadir alguna y así poder filtrar por intereses.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
                >
                  Volver al formulario
                </button>
              </div>
            ) : (
              <div className="text-center py-1 border-t border-surface-border/60 pt-3">
                <p className={`font-display font-bold text-2xl ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
                  {Number(interested).toLocaleString('es-ES')}
                </p>
                <p className="text-[11px] text-surface-muted mt-1">
                  interesados de {Number(total).toLocaleString('es-ES')} notificables
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
              <p className="text-sm font-display font-bold text-surface-text">📍 Filtrar por ubicación</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                {canFilterLocation
                  ? 'Contrata solo entre los notificables que viven cerca del evento.'
                  : 'El evento no tiene ubicación asignada, vuelve al paso anterior para ponerla.'}
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
                  aria-label="Radio en kilómetros"
                />
                <span className="text-xs font-mono text-surface-muted w-16 text-right">
                  {radiusKm} km
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
                      ).toLocaleString('es-ES')}
                    </p>
                    <p className="text-[11px] text-surface-muted mt-1">
                      {filterInterested && interestedNearby != null
                        ? `interesados cerca (radio ${radiusKm} km, cruce ambos filtros)`
                        : `notificables en un radio de ${radiusKm} km`}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        </>
        )}

        {/* Notificaciones a contratar — siempre operativo 500–50.000.
            Si la audiencia efectiva (con o sin filtro de intereses) queda
            por debajo de lo contratado, se avisa con banner ámbar; solo
            se enviarán las notificaciones que quepan y no se cobrará por
            el resto (ver eventPromoPacing.js). Excepción: con el filtro
            de intereses activo y por debajo del mínimo contratable,
            ocultamos el slider y bloqueamos la publicación (ver
            blockedByFilterShortfall). */}
        {blockedByFilterShortfall ? (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-1">
            <p className="text-sm text-surface-muted leading-relaxed">
              Con el filtro de intereses activo solo hay {Number(audienceCap).toLocaleString('es-ES')} usuarios interesados, por debajo del mínimo contratable ({NOTIF_MIN.toLocaleString('es-ES')}).
            </p>
            <p className="text-xs text-surface-muted">Desactiva el filtro para poder contratar publicidad.</p>
          </div>
        ) : (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-mono text-surface-muted">
              📨 Notificaciones a contratar (on-demand)
            </label>
            <span className="text-xs font-mono font-semibold text-surface-text">
              {Number(notificationCount).toLocaleString('es-ES')}
            </span>
          </div>

          <input
            type="range"
            min={NOTIF_MIN}
            max={NOTIF_MAX}
            step={NOTIF_STEP}
            value={notificationCount}
            onChange={e => setNotificationCount(Number(e.target.value))}
            className={`w-full ${meta.slider} cursor-pointer`}
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-surface-muted">
            <span>Mín. {NOTIF_MIN.toLocaleString('es-ES')}</span>
            <span>Máx. {NOTIF_MAX.toLocaleString('es-ES')}</span>
          </div>

          {contractedExceedsAudience && (
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 leading-relaxed">
              ⚠️ Solo hay {Number(audienceCap).toLocaleString('es-ES')} usuarios {
                filterInterested && filterLocation ? 'interesados cerca'
                : filterInterested ? 'interesados'
                : filterLocation ? 'cerca'
                : 'notificables'
              }: se enviarán como mucho {Number(audienceCap).toLocaleString('es-ES')} notificaciones, y no se cobrará por el resto.
            </p>
          )}

          {/* Desglose de precio dinámico. Sustituye a la píldora estática
              '10 €'/'20 €' que había antes en el detalle del plan. El
              importe máximo se recalcula en directo al mover el slider;
              si la audiencia efectiva queda por debajo, mostramos
              también el importe estimado real (solo se cobra lo
              entregado). En renovación no hay techo de audiencia que
              recalcular aquí, así que sale solo el máximo. */}
          <div className="border-t border-surface-border/60 pt-2 mt-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-surface-muted">💶 Importe contratado</span>
              <span className={`text-sm font-display font-bold ${plan === 'ultra' ? 'text-accent-glow' : 'text-purple-300'}`}>
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
              {formatEurFromCents(EVENT_AD_PRICING[plan].unitPriceCents)} por notificación entregada.
            </p>
          </div>

          <p className="text-[10px] font-mono text-surface-muted">
            ℹ️ Si no se alcanzan 200 notificaciones enviadas, no se cobrará nada.
          </p>
        </div>
        )}

        {/* Notas informativas — mismas que estaban antes en el modal */}
        <div className="space-y-2">
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            💳 Se aplicará una retención al comenzar la promoción; el pago se efectuará al finalizar la promoción, al renovarla o en su defecto, al empezar el evento, en base a las notificaciones enviadas hasta ese momento.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            📶 Las notificaciones se enviarán conforme los usuarios estén disponibles para notificar.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            🎯 Todas las promociones se realizan en base a algoritmos de cercanía e intereses.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            🔁 Se notificará como máximo una vez a cada usuario dentro de una misma promoción; para repetir notificaciones a usuarios se deberá crear otra promoción.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            📍 Todas las notificaciones se reparten mediante algoritmos basados en intereses y ubicación.
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
            {error}
          </p>
        )}

        <button
          onClick={handlePublish}
          disabled={saving || !audienceReady || blockedByFilterShortfall}
          className={`w-full py-3.5 rounded-xl font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98] ${meta.button}`}
        >
          {saving ? (isRenew ? 'Renovando...' : 'Publicando...') : (isRenew ? `🔄 Renovar como ${meta.label}` : `🌐 Publicar evento ${meta.label}`)}
        </button>
      </main>
    </div>
  );
}
