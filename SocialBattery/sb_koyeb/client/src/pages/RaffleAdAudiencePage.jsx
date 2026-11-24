import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { RAFFLE_AD_PRICING, FREE_UNITS, MIN_UNITS, UNITS_STEP, computeRaffleAdPriceCents, formatEurFromCents } from '../lib/adPricing';
import { buildRaffleFormData } from '../lib/raffleForm';
import { useTranslation } from '../i18n';
import WalletInline from '../components/WalletInline';
import { FreePromoNote } from '../components/FreePromo';
import { PAYMENTS_ENABLED } from '../lib/features';

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
// La audiencia nunca incluye a los miembros de la comunidad que organiza el
// sorteo: el Light es publicidad para llegar a gente nueva. El slider llega
// como mucho a la audiencia que existe, se paga por lo enseñado y las primeras
// unidades de la campaña son gratis (lib/adPricing.js).
const VIEWS_MAX = 100000;
const DEFAULT_VIEWS = 500;

const LIGHT_META = {
  emoji: '🎫',
  labelKey: 'raffleLightLabel',
  ring: 'border-amber-400 bg-amber-500/10',
  pill: 'text-amber-300 bg-amber-500/10 border border-amber-500/20',
  check: 'text-amber-300',
  audienceText: 'text-amber-300',
  slider: 'accent-amber-400',
  toggleOn: 'bg-amber-400',
  spinnerBorder: 'border-amber-400',
  button: 'bg-amber-500 hover:bg-amber-400 text-surface-bg',
  includeKeys: ['raffleLightInc1', 'raffleLightInc2', 'raffleLightInc3'],
};

export default function RaffleAdAudiencePage() {
  const { communityId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t, lang } = useTranslation();
  const localeTag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';

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
  const communityName = location.state?.communityName || t('adConfig.raffleFallbackCommunity');

  const [loadingTotal, setLoadingTotal] = useState(true);
  const [total, setTotal] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [freeUnits, setFreeUnits] = useState(FREE_UNITS);
  const [freePromo, setFreePromo] = useState(null); // cupo de promociones gratis
  // Al renovar se parte del filtro del ciclo actual.
  const [filterInterested, setFilterInterested] = useState(Boolean(renewRaffle?.banner_interested_only));
  const [interested, setInterested] = useState(null);
  const [categoriesDefined, setCategoriesDefined] = useState(null);

  const [bannerViews, setBannerViews] = useState(
    isRenew && renewRaffle?.banner_views_contracted
      ? Math.min(Math.max(Number(renewRaffle.banner_views_contracted), MIN_UNITS), VIEWS_MAX)
      : DEFAULT_VIEWS
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [insufficientFunds, setInsufficientFunds] = useState(false);

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

  const loadTotal = useCallback(async () => {
    setLoadingTotal(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (raffleCategories.length) params.set('categories', JSON.stringify(raffleCategories));
      if (renewRaffle?.id) params.set('raffle_id', renewRaffle.id);
      const data = await api.get(`/community/communities/${communityId}/raffle-audience?${params}`);
      setTotal(data?.total ?? 0);
      setInterested(data?.interested ?? null);
      setCategoriesDefined(Boolean(data?.categories_defined));
      setFreeUnits(data?.free_units ?? FREE_UNITS);
      setFreePromo(data?.free_promo ?? null);
    } catch (e) {
      setLoadError(e.message || t('adConfig.audienceCalcError'));
    } finally {
      setLoadingTotal(false);
    }
  }, [communityId, raffleCategories, renewRaffle, t]);

  useEffect(() => {
    if (draft || isRenew) loadTotal();
  }, [draft, isRenew, loadTotal]);

  const audienceCap = filterInterested
    ? (categoriesDefined === false ? 0 : interested)
    : total;
  const audienceReady = audienceCap != null;
  // No se puede contratar más de lo que existe (mínimo MIN_UNITS).
  const viewsMax = freePromo?.max_units ?? VIEWS_MAX;
  const sliderMax = audienceCap == null
    ? viewsMax
    : Math.min(viewsMax, Math.max(MIN_UNITS, Math.ceil(audienceCap / UNITS_STEP) * UNITS_STEP));
  const units = Math.min(bannerViews, sliderMax);
  const contractedExceedsAudience = audienceReady && units > audienceCap;
  const nobodyMatches = filterInterested && audienceReady && audienceCap === 0;

  // Importe máximo (lo que se reserva) y lo que se cobraría como mucho de
  // verdad si hay menos audiencia que unidades.
  const maxPriceCents = computeRaffleAdPriceCents('light', units, freeUnits);
  const estPriceCents = computeRaffleAdPriceCents(
    'light', audienceReady ? Math.min(units, audienceCap) : units, freeUnits);

  async function handleCreate() {
    if (!audienceReady || nobodyMatches) return;
    setCreating(true);
    setCreateError('');
    try {
      if (isRenew) {
        // Renovación: solo aforo y filtro de intereses. El tier y la fecha
        // del sorteo se mantienen. El servidor borra los targets del ciclo
        // anterior, resetea promo_ended_at y reasigna un ciclo nuevo con los
        // parámetros que llegan aquí (ver renew-promotion en community.js).
        await api.post(`/community/raffles/${renewRaffle.id}/renew-promotion`, {
          banner_views_contracted: units,
          banner_interested_only: filterInterested,
        });
        showToast(t('adConfig.raffleRenewed'), 'success');
        navigate(`/community/${communityId}`, { replace: true });
        return;
      }
      if (!draft) return;
      const formData = buildRaffleFormData({
        ...draft, tier: 'light', banner_views_contracted: units, banner_interested_only: filterInterested,
      });
      await api.postForm(`/community/communities/${communityId}/raffles`, formData);
      showToast(t('adConfig.raffleCreated'), 'success');
      navigate(`/community/${communityId}`, { replace: true });
    } catch (e) {
      setInsufficientFunds(e?.code === 'INSUFFICIENT_FUNDS');
      setCreateError(e.message || (isRenew ? t('adConfig.errRaffleRenew') : t('adConfig.errRaffleCreate')));
    } finally {
      setCreating(false);
    }
  }

  const audienceLabel = useMemo(() => {
    if (filterInterested) return t('adConfig.raffleInterestedLabel');
    return t('adConfig.raffleReachableLabel');
  }, [filterInterested, t]);

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
            <h1 className="font-display font-bold text-surface-text text-base truncate">{t('adConfig.raffleConfigTitle')}</h1>
            <p className="text-xs font-mono text-surface-muted truncate">{communityName}</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-32 pt-4 space-y-4">
        {isRenew && (
          <div className="bg-surface-card border border-amber-500/30 rounded-2xl p-5 space-y-2">
            <p className="text-sm font-display font-bold text-surface-text">{t('adConfig.raffleRenewingTitle')}</p>
            <p className="text-[12px] text-surface-muted leading-relaxed">
              {t('adConfig.raffleRenewingExplain', { title: renewRaffle.title })}
            </p>
          </div>
        )}

        {/* Resumen del sorteo en creación */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-1">
          <h2 className="font-display font-bold text-surface-text text-sm truncate">
            {isRenew ? renewRaffle.title : (draft?.title || t('adConfig.raffleNewTitle'))}
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
              {t('adConfig.' + LIGHT_META.labelKey)}
            </span>
            <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${LIGHT_META.pill}`}>
              {PAYMENTS_ENABLED
                ? t('adConfig.perUnit', { price: formatEurFromCents(RAFFLE_AD_PRICING.light.unitPriceCents), unit: t('adConfig.unitView') })
                : t('free.tag')}
            </span>
          </div>
          <ul className="space-y-1.5 text-[12px] font-mono text-surface-muted leading-relaxed">
            {LIGHT_META.includeKeys.map((key, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`${LIGHT_META.check} flex-shrink-0`}>✓</span>
                <span>{t('adConfig.' + key)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Audiencia total notificable — usuarios fuera de la comunidad
            del sorteo (los miembros no cuentan). */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-2">
          <p className="text-xs font-mono text-surface-muted uppercase tracking-wide">{t('adConfig.raffleReachable')}</p>
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
                {t('adConfig.retry')}
              </button>
            </div>
          ) : (
            <p className={`font-display font-bold text-4xl ${LIGHT_META.audienceText}`}>
              {Number(total).toLocaleString(localeTag)}
            </p>
          )}
          <p className="text-[11px] text-surface-muted leading-relaxed">
            {t('adConfig.raffleReachableHint', { community: communityName })}
          </p>
        </div>

        {/* ── Filtro por intereses ──────────────────────────────────────
            Al activarse, se cruza users.interests con las categorías de
            la comunidad; solo se sortean visualizaciones entre esos
            usuarios interesados. */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-display font-bold text-surface-text">{t('adConfig.filterInterestTitle')}</p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                {t('adConfig.raffleFilterHintLight')}
              </p>
            </div>
            <InterestToggle
              checked={filterInterested}
              onChange={() => setFilterInterested(v => !v)}
              disabled={loadingTotal || !!loadError}
              activeBg={LIGHT_META.toggleOn}
            />
          </div>

          {filterInterested && (
            categoriesDefined === false ? (
              <div className="text-center py-1 space-y-2 border-t border-surface-border/60 pt-3">
                <p className="text-xs text-surface-muted leading-relaxed">
                  {t('adConfig.raffleNoCatsCommunity')}
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/community/${communityId}`)}
                  className="text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
                >
                  {t('adConfig.raffleEditCommunity')}
                </button>
              </div>
            ) : (
              <div className="text-center py-1 border-t border-surface-border/60 pt-3">
                <p className={`font-display font-bold text-2xl ${LIGHT_META.audienceText}`}>
                  {Number(interested).toLocaleString(localeTag)}
                </p>
                <p className="text-[11px] text-surface-muted mt-1">
                  {t('adConfig.interestedOfTotal', { total: Number(total).toLocaleString(localeTag) })}
                </p>
              </div>
            )
          )}
        </div>

        {nobodyMatches ? (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center space-y-1">
            <p className="text-sm text-surface-muted leading-relaxed">{t('adConfig.nobodyMatches')}</p>
            <p className="text-xs text-surface-muted">{t('adConfig.raffleBelowMinLHint')}</p>
          </div>
        ) : (
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-mono text-surface-muted">
              {t('adConfig.raffleContractSlots')}
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
            onChange={e => setBannerViews(Number(e.target.value))}
            className={`w-full ${LIGHT_META.slider} cursor-pointer`}
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-surface-muted">
            <span>{t('adConfig.minLbl', { n: MIN_UNITS.toLocaleString(localeTag) })}</span>
            <span>{t('adConfig.maxLbl', { n: sliderMax.toLocaleString(localeTag) })}</span>
          </div>

          {contractedExceedsAudience && (
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 leading-relaxed">
              {t('adConfig.raffleWarnCap', { n: Number(audienceCap).toLocaleString(localeTag), n2: Number(audienceCap).toLocaleString(localeTag), label: audienceLabel })}
            </p>
          )}

          {PAYMENTS_ENABLED && (
          <>
          <div className="border-t border-surface-border/60 pt-2 mt-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-surface-muted">{t('adConfig.priceContracted')}</span>
              <span className={`text-sm font-display font-bold ${LIGHT_META.audienceText}`}>
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
              {t('adConfig.rafflePricePerView', { price: formatEurFromCents(RAFFLE_AD_PRICING.light.unitPriceCents) })}
            </p>
          </div>

          <p className="text-[10px] font-mono text-surface-muted">
            {freeUnits > 0 ? t('adConfig.raffleFreeUnitsNote', { n: freeUnits }) : t('adConfig.noFreeUnitsNote')}
          </p>
          </>
          )}
        </div>
        )}

        {/* Notas informativas */}
        <div className="space-y-2">
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.raffleNote1')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.raffleNote2')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.raffleNote3')}
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-card border border-surface-border rounded-xl px-3 py-2">
            {t('adConfig.raffleNote4')}
          </p>
        </div>

        <WalletInline neededCents={estPriceCents} warn={!isRenew} forceInsufficient={insufficientFunds} />
        <FreePromoNote status={freePromo} />

        {createError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{createError}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={creating || !audienceReady || nobodyMatches || Boolean(freePromo?.blocked)}
          className={`w-full py-3.5 rounded-xl font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98] ${LIGHT_META.button}`}
        >
          {creating
            ? (isRenew ? t('adConfig.renewing') : t('adConfig.raffleCreating'))
            : (isRenew ? t('adConfig.raffleRenewSimpleBtn') : t('adConfig.raffleCreateBtn'))}
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
