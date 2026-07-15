import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

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
    price: '10 €',
    accent: 'purple',
    ring: 'border-purple-400 bg-purple-500/10',
    pill: 'text-purple-300 bg-purple-500/10 border border-purple-500/20',
    check: 'text-purple-300',
    slider: 'accent-purple-400',
    button: 'bg-purple-500 hover:bg-purple-400 text-white',
    includes: [
      'Aparición en lista de eventos',
      'Notificaciones a usuarios de la comunidad (si existe)',
      'Notificaciones a número de usuarios contratado',
      'Insignia premium',
    ],
  },
  ultra: {
    emoji: '🚀',
    label: 'Ultra',
    price: '20 €',
    accent: 'yellow',
    ring: 'border-yellow-400 bg-yellow-500/10',
    pill: 'text-yellow-300 bg-yellow-500/10 border border-yellow-500/20',
    check: 'text-yellow-300',
    slider: 'accent-yellow-400',
    button: 'bg-yellow-500 hover:bg-yellow-400 text-surface-bg',
    includes: [
      'Aparición en lista de eventos',
      'Notificaciones a usuarios de la comunidad (si existe)',
      'Notificaciones a número de usuarios contratado',
      'Apariciones en banner menú principal a número de usuarios contratado',
      'Insignia ultra',
    ],
  },
};

function buildEventFormData(draft, plan, notificationCount) {
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

  if (draft.communityId) formData.append('community_id', draft.communityId);
  if (draft.cover_file) formData.append('cover', draft.cover_file);

  return formData;
}

export default function EventAdConfigPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const draft = location.state?.draft || null;

  // El plan inicial es el que el usuario escogió en el modal
  // (premium | ultra). Si por lo que sea el draft no trae un plan
  // válido, arrancamos en premium.
  const initialPlan = draft?.promotion_plan === 'ultra' ? 'ultra' : 'premium';
  const [plan, setPlan] = useState(initialPlan);
  const [notificationCount, setNotificationCount] = useState(
    Math.min(Math.max(Number(draft?.notification_count) || NOTIF_MIN, NOTIF_MIN), NOTIF_MAX)
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

  // Sin borrador (p. ej. recarga directa aquí) no hay nada que
  // configurar: de vuelta al menú comunidad. Si el draft venía de una
  // comunidad concreta, mejor volver a esa comunidad.
  useEffect(() => {
    if (draft) return;
    const back = location.state?.draft?.communityId
      ? `/community/${location.state.draft.communityId}`
      : '/community';
    navigate(back, { replace: true });
  }, [draft, location.state, navigate]);

  const draftCategories = useMemo(
    () => (Array.isArray(draft?.categories) ? draft.categories.filter(Boolean) : []),
    [draft]
  );
  const categoriesQueryParam = useMemo(
    () => (draftCategories.length ? encodeURIComponent(JSON.stringify(draftCategories)) : ''),
    [draftCategories]
  );

  const loadTotal = useCallback(async () => {
    setLoadingTotal(true);
    setLoadError('');
    try {
      const query = draft?.communityId ? `?community_id=${encodeURIComponent(draft.communityId)}` : '';
      const data = await api.get(`/community/events/promotion-audience${query}`);
      setTotal(data?.total ?? 0);
    } catch (e) {
      setLoadError(e.message || 'No se pudo calcular la audiencia');
    } finally {
      setLoadingTotal(false);
    }
  }, [draft]);

  useEffect(() => {
    if (draft) loadTotal();
  }, [draft, loadTotal]);

  // La audiencia realmente contratable ahora mismo: si el filtro de
  // intereses está activo (y hay categorías con las que cruzar), el máximo
  // pasa a ser el nº de interesados; si no, el total notificable. El
  // Audiencia efectiva: si el filtro está activo (y hay categorías con
  // las que cruzar), pasa a ser el nº de interesados; si no, el total
  // notificable. Se usa SOLO para informar (banner ámbar bajo el slider);
  // NO se usa para topar el máximo del slider — la empresa puede
  // contratar hasta NOTIF_MAX aunque el pool sea menor. El pacing solo
  // enviará las notificaciones que quepan y no se cobrará por el resto
  // (ver eventPromoPacing.js).
  const audienceCap = filterInterested
    ? (categoriesDefined === false ? 0 : interested)
    : total;
  const audienceReady = audienceCap != null && !loadingInterested;
  const contractedExceedsAudience = audienceReady && notificationCount > audienceCap;

  // Con el filtro de intereses activado, si el pool resultante no llega al
  // mínimo contratable (NOTIF_MIN) bloqueamos la publicación y ocultamos
  // el slider. SIN filtro, dejamos publicar el evento igualmente aunque el
  // total de usuarios notificables todavía no llegue a NOTIF_MIN (fase de
  // crecimiento con pocos usuarios) — el slider sigue apareciendo y no se
  // bloquea, para no frenar la adopción temprana de la app.
  const blockedByFilterShortfall = filterInterested && audienceReady && audienceCap < NOTIF_MIN;

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
      const communityParam = draft?.communityId ? `&community_id=${encodeURIComponent(draft.communityId)}` : '';
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

  const backTarget = useMemo(() => {
    if (draft?.communityId) return `/community/${draft.communityId}`;
    return '/community';
  }, [draft]);

  const headerSubtitle = draft?.communityName
    ? `Evento en ${draft.communityName}`
    : (draft?.title || 'Nuevo evento');

  async function handlePublish() {
    if (!draft || !audienceReady || blockedByFilterShortfall) return;
    setSaving(true);
    setError('');
    try {
      const formData = buildEventFormData(draft, plan, notificationCount);
      // Fase 106: si el usuario activó el filtro de intereses, lo
      // mandamos al servidor para que el pacing solo notifique a quienes
      // tengan intereses coincidentes con el evento (users.interests ∩
      // event.categories). Sin filtro, se manda a todo el pool como
      // hasta ahora.
      if (filterInterested) formData.append('audience_interested_only', 'true');
      await api.postForm('/community/events', formData);
      showToast('¡Evento creado! 🌐', 'success');
      navigate(backTarget, { replace: true });
    } catch (e) {
      setError(e.message || 'Error al crear el evento');
    } finally {
      setSaving(false);
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
          {draft.communityName ? (
            <p className="text-xs font-mono text-surface-muted truncate">
              👥 {draft.communityName}
            </p>
          ) : (
            <p className="text-xs font-mono text-surface-muted">
              Evento suelto (sin comunidad)
            </p>
          )}
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
                : 'bg-yellow-500/20 border-yellow-400/60 text-yellow-100';
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

        {/* Detalles del plan seleccionado */}
        <div className={`bg-surface-card border rounded-2xl p-5 space-y-3 transition-colors ${meta.ring}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base font-display font-bold text-surface-text">
              <span className="text-xl">{meta.emoji}</span>
              {meta.label} Promotion
            </span>
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>
              {meta.price}
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
            <p className={`font-display font-bold text-4xl ${plan === 'ultra' ? 'text-yellow-300' : 'text-purple-300'}`}>
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
                  ? (plan === 'ultra' ? 'bg-yellow-400' : 'bg-purple-500')
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
                <span className={`w-5 h-5 border-2 border-t-transparent rounded-full animate-spin inline-block ${plan === 'ultra' ? 'border-yellow-400' : 'border-purple-400'}`} />
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
                <p className={`font-display font-bold text-2xl ${plan === 'ultra' ? 'text-yellow-300' : 'text-purple-300'}`}>
                  {Number(interested).toLocaleString('es-ES')}
                </p>
                <p className="text-[11px] text-surface-muted mt-1">
                  interesados de {Number(total).toLocaleString('es-ES')} notificables
                </p>
              </div>
            )
          )}
        </div>

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
              ⚠️ Solo hay {Number(audienceCap).toLocaleString('es-ES')} usuarios {filterInterested ? 'interesados' : 'notificables'}: se enviarán como mucho {Number(audienceCap).toLocaleString('es-ES')} notificaciones, y no se cobrará por el resto.
            </p>
          )}

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
          {saving ? 'Publicando...' : `🌐 Publicar evento ${meta.label}`}
        </button>
      </main>
    </div>
  );
}
