import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import TimeseriesChart from '../components/TimeseriesChart';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';

// ── Acciones sobre una promoción (fase 112) ────────────────────────────────
// Renovar y finalizar reutilizan el mismo modelo de dos botones al pie de
// cada tarjeta. Renovar navega a la página de configuración correspondiente
// (EventAdConfigPage / RaffleAdAudiencePage) — donde el usuario ajusta plan,
// aforo o filtros y confirma —, así que aquí solo se dispara la navegación.
// Finalizar hace el POST directamente porque no hay parámetros que elegir:
// cerrar es cerrar. Por eso finalizar sí necesita confirmación explícita
// (modal), mientras que renovar no (la propia página de config es la
// oportunidad de dar marcha atrás con "Atrás").

// ── Dashboard de publicidad de una comunidad ────────────────────────────────
// Se llega desde el botón 📊 del primer banner del perfil de comunidad, que
// solo ve el creador (ver CommunityDetailPage.jsx). Reúne en una pantalla
// todo lo que hasta ahora estaba desperdigado o directamente no se medía:
//
//   · Eventos Premium/Ultra → notificaciones push contratadas, enviadas y
//     clicadas (ver community_events + event_promo_notifications).
//   · Sorteos Light/Volt/Community → banners voladores asignados, enseñados
//     y clicados (ver community_raffles + raffle_banner_targets).
//
// Todo lo pesado lo agrega Postgres (RPC de la fase 111); aquí solo se pinta
// lo que devuelve GET /community/communities/:id/dashboard.
//
// Vocabulario que se usa en toda la pantalla, para que signifique siempre lo
// mismo:
//   · Contratadas → lo que se pidió (notification_count / banner_views_contracted).
//   · Enviadas / Enseñadas → lo que de verdad salió. Es la base de cobro.
//   · Clicks → gente DISTINTA que abrió el contenido desde el anuncio. No son
//     visitas: se cuenta el primer click de cada persona, no los rebotes.
//   · Interesado → sus intereses de perfil cruzaban con las categorías del
//     evento/comunidad EN EL MOMENTO del envío (se congela por fila, no se
//     recalcula: los intereses cambian con el tiempo).

export const TIER_STYLE = {
  light:     { emoji: '🎫', text: 'text-amber-300', bar: 'bg-amber-400', pill: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
  volt:      { emoji: '⚡', text: 'text-blue-300',  bar: 'bg-blue-400',  pill: 'bg-blue-500/10 text-blue-300 border-blue-500/25' },
  community: { emoji: '🏠', text: 'text-red-300',   bar: 'bg-red-400',   pill: 'bg-red-500/10 text-red-300 border-red-500/25' },
};

export const PLAN_STYLE = {
  ultra:   { emoji: '🚀', labelKey: 'planUltra',   pill: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/25' },
  premium: { emoji: '⚡', labelKey: 'planPremium', pill: 'bg-accent-primary/10 text-accent-glow border-accent-primary/25' },
  basic:   { emoji: '·',  labelKey: 'planBasic',   pill: 'bg-surface-bg text-surface-muted border-surface-border' },
};

export function fmt(n, lang = 'es') {
  const tag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';
  return Number(n || 0).toLocaleString(tag);
}

// null = "todavía no hay base sobre la que calcular" (0 impresiones), que no
// es lo mismo que 0 % ("hubo impresiones y no picó nadie"). Se pintan
// distinto a propósito: un guión no es un mal resultado, un 0 % sí.
export function pct(value, lang = 'es') {
  if (value == null) return '—';
  const tag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';
  return `${Number(value).toLocaleString(tag, { maximumFractionDigits: 1 })} %`;
}

export function fmtDate(iso, lang = 'es') {
  if (!iso) return '—';
  const tag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';
  return new Date(iso).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Pill({ className = '', children }) {
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

// ── Modal de confirmación para finalizar ──────────────────────────────────
// Se abre desde PromotionActions cuando el usuario pulsa "Finalizar". No
// hay parámetros que elegir, solo confirmar. Se cierra con Esc / click fuera
// o pulsando cualquiera de los dos botones — mientras se envía el POST se
// deshabilita "Sí, finalizar" y se pone un spinner, para que un doble tap
// no dispare dos peticiones.
export function ConfirmEndModal({ open, kind, title, onCancel, onConfirm, busy }) {
  const { t } = useTranslation();
  if (!open) return null;
  const label = kind === 'event' ? t('dashboardDetail.confirmLabelEvt') : t('dashboardDetail.confirmLabelRaf');
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-safe"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card border border-surface-border rounded-2xl p-5 max-w-sm w-full space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="font-display font-bold text-surface-text text-sm">{t('dashboardDetail.confirmTitle')}</p>
          <p className="text-[12px] text-surface-muted mt-1 leading-relaxed">
            {t('dashboardDetail.confirmSubject', { label })} <span className="text-surface-text">{title}</span>.
          </p>
          <p className="text-[11px] text-surface-muted mt-2 leading-relaxed">
            {kind === 'event' ? t('dashboardDetail.confirmExplainEvt') : t('dashboardDetail.confirmExplainRaf')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-xl border border-surface-border text-surface-text text-xs font-display font-semibold disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-xs font-display font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            {t('dashboardDetail.confirmCta')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Renderiza los dos botones de acción (Renovar / Finalizar) al pie de la
// tarjeta. Los flags can_end y can_renew los calcula el servidor: si un
// botón está deshabilitado es porque falta el mínimo de cobro o el
// evento/sorteo ya está fuera de ventana; el hint lo explica en corto.
//
// `hasContract` (lo calcula quien llama: event.promoted / tier light|
// community) decide si el bloque se enseña EN ABSOLUTO — solo se oculta
// del todo cuando nunca hubo contrato de pago (evento basic, sorteo Volt),
// que es el único caso en que no hay nada que renovar o finalizar. Antes
// se ocultaba también cuando SÍ había contrato pero no se podía actuar
// ahora mismo (ya terminado, o por debajo del mínimo de cobro) — eso
// escondía la opción justo cuando el usuario más la necesitaba ver
// (aunque fuese deshabilitada, con el motivo). Ahora en ese caso los
// botones se enseñan igual, deshabilitados y con el motivo explicado.
export function PromotionActions({ row, kind, onRenew, onEnd, freeThreshold, hasContract }) {
  const { t } = useTranslation();
  if (!hasContract) return null;

  const canRenew = row.can_renew;
  const canEnd = row.can_end;
  const sent = kind === 'event' ? row.sent_official : row.shown;
  const belowThreshold = sent < freeThreshold;
  const unitLabel = kind === 'event' ? t('dashboardDetail.unitSends') : t('dashboardDetail.unitBanners');
  const isOver = kind === 'event' ? row.started : row.ended;
  const isDrawn = kind === 'raffle' && !!row.drawn_at;
  const overLabel = kind === 'event'
    ? t('dashboardDetail.overEvent')
    : isDrawn ? t('dashboardDetail.overRaffleDrawn') : t('dashboardDetail.overRaffleEnded');

  const renewTitle = isOver
    ? overLabel + t('dashboardDetail.renewOverSuffix')
    : belowThreshold
      ? t('dashboardDetail.renewNeeded', { threshold: freeThreshold, unit: unitLabel, sent })
      : kind === 'event' ? t('dashboardDetail.renewEventTitle') : t('dashboardDetail.renewRaffleTitle');

  const endTitle = isOver
    ? overLabel + t('dashboardDetail.endOverSuffix')
    : kind === 'raffle' && row.promo_ended_at
      ? t('dashboardDetail.endAlreadyDone')
      : belowThreshold
        ? t('dashboardDetail.endNeeded', { threshold: freeThreshold, unit: unitLabel, sent })
        : kind === 'event' ? t('dashboardDetail.endEventTitle') : t('dashboardDetail.endRaffleTitle');

  return (
    <div className="border-t border-surface-border/60 pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onRenew}
          disabled={!canRenew}
          title={renewTitle}
          className="flex-1 py-2 rounded-xl bg-accent-primary/15 text-accent-glow border border-accent-primary/30 hover:bg-accent-primary/25 text-xs font-display font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('dashboardDetail.renewBtn')}
        </button>
        <button
          onClick={onEnd}
          disabled={!canEnd}
          title={endTitle}
          className="flex-1 py-2 rounded-xl bg-surface-bg border border-red-500/25 text-red-300 hover:bg-red-500/10 text-xs font-display font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('dashboardDetail.endBtn')}
        </button>
      </div>
      {isOver ? (
        <p className="text-[10px] text-surface-muted leading-relaxed">
          {t('dashboardDetail.overExplain', { overLabel })}
        </p>
      ) : belowThreshold ? (
        <p className="text-[10px] text-surface-muted leading-relaxed">
          {t('dashboardDetail.belowExplain', { threshold: freeThreshold, unit: unitLabel, sent })}
        </p>
      ) : null}
    </div>
  );
}

export function StatTile({ label, value, hint, accent = 'text-surface-text' }) {
  return (
    <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-mono text-surface-muted truncate">{label}</p>
      <p className={`font-display font-bold text-lg leading-tight mt-0.5 ${accent}`}>{value}</p>
      {hint && <p className="text-[10px] text-surface-muted mt-0.5 leading-tight">{hint}</p>}
    </div>
  );
}

// Barra de progreso "de lo enviado sobre lo contratado". Se recorta al 100 %
// visualmente pero el número de al lado sí puede pasarse (p.ej. si el aforo
// real quedó por encima de lo contratado), así que no se miente: la barra es
// solo el dibujo, la cifra manda.
export function ProgressBar({ value, barClass = 'bg-accent-primary' }) {
  const width = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-1.5 rounded-full bg-surface-bg border border-surface-border overflow-hidden">
      <div className={`h-full ${barClass} transition-all`} style={{ width: `${width}%` }} />
    </div>
  );
}

// ── Desglose interesados / no interesados ──────────────────────────────────
// Es la parte con más chicha del dashboard: el CTR de cada segmento es
// exactamente la respuesta a "¿me compensa pagar por filtrar por intereses?".
// Si los interesados pican mucho más, la próxima campaña se afina; si pican
// parecido, el filtro solo recorta alcance a cambio de nada.
//
// Ojo con el caso `filtered`: aunque la campaña se contratara con el filtro
// duro, el desglose NO tiene por qué salir 100 % interesados, y por eso se
// pinta igualmente en vez de darlo por hecho:
//
//   · En un EVENTO, el filtro solo cría el pool publicitario que reparte el
//     job de pacing. El aviso inmediato a los miembros de la propia
//     comunidad se manda siempre, tengan intereses afines o no (ver POST
//     /events en routes/community.js), y esos envíos también están aquí.
//   · En un SORTEO Light sí sale 100 %: su pool excluye por definición a los
//     miembros de la comunidad, así que no hay envíos "de comunidad" que se
//     salten el filtro.
//
// La conclusión automática de abajo (el "lift") solo se saca sin filtro: con
// filtro, el segmento de no interesados es un residuo de miembros de la
// comunidad, no una muestra con la que comparar nada.
export function InterestBreakdown({ data, filtered, unit, filteredNote }) {
  const { t, lang } = useTranslation();
  const { interested, not_interested: notInterested, unknown } = data.interest;
  const classified = interested + notInterested;

  if (!classified && !unknown) {
    return (
      <div className="border-t border-surface-border/60 pt-3 mt-3">
        <p className="text-[11px] text-surface-muted leading-relaxed">
          {t('dashboardDetail.nothingToBreak', { unit })}
        </p>
      </div>
    );
  }

  // Filas anteriores a la fase 111 (o campañas sin categorías definidas) no
  // se pueden clasificar. Se enseñan aparte en vez de colarlas en uno de los
  // dos segmentos: un número inventado es peor que un hueco reconocido.
  if (!classified) {
    return (
      <div className="border-t border-surface-border/60 pt-3 mt-3">
        <p className="text-[11px] text-surface-muted leading-relaxed">
          {data.has_categories === false
            ? t('dashboardDetail.unclassifiedNoCat', { n: fmt(unknown, lang), unit })
            : t('dashboardDetail.unclassifiedOld', { n: fmt(unknown, lang), unit })}
        </p>
      </div>
    );
  }

  const interestedShare = Math.round((interested / classified) * 100);
  const ctrI = data.ctr_interested;
  const ctrN = data.ctr_not_interested;
  // Solo se saca conclusión si hay CTR en los dos lados y el de no
  // interesados no es 0 (dividir entre 0 daría un "∞× mejor" ridículo).
  const lift = !filtered && ctrI != null && ctrN != null && ctrN > 0
    ? Math.round((ctrI / ctrN) * 10) / 10
    : null;

  return (
    <div className="border-t border-surface-border/60 pt-3 mt-3 space-y-2.5">
      {filtered && (
        <div className="flex items-start gap-2">
          <Pill className="bg-accent-primary/10 text-accent-glow border-accent-primary/25 mt-0.5">{t('dashboardDetail.onlyInterestedTag')}</Pill>
          <p className="text-[11px] text-surface-muted leading-relaxed">{filteredNote}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-mono text-surface-muted">{t('dashboardDetail.breakdownShare', { unit })}</p>
        <p className="text-[10px] font-mono text-surface-muted">{t('dashboardDetail.interestedShare', { n: interestedShare })}</p>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden border border-surface-border bg-surface-bg">
        <div className="bg-emerald-400" style={{ width: `${interestedShare}%` }} />
        <div className="bg-surface-muted/40" style={{ width: `${100 - interestedShare}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
          <p className="text-[10px] font-mono text-emerald-300">{t('dashboardDetail.interestedRow')}</p>
          <p className="font-display font-bold text-surface-text text-sm mt-0.5">{fmt(interested, lang)}</p>
          <p className="text-[10px] text-surface-muted mt-0.5">
            {t('dashboardDetail.clicksCtr', { n: fmt(data.clicks.interested, lang), ctr: pct(ctrI, lang) })}
          </p>
        </div>
        <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
          <p className="text-[10px] font-mono text-surface-muted">{t('dashboardDetail.notInterestedRow')}</p>
          <p className="font-display font-bold text-surface-text text-sm mt-0.5">{fmt(notInterested, lang)}</p>
          <p className="text-[10px] text-surface-muted mt-0.5">
            {t('dashboardDetail.clicksCtr', { n: fmt(data.clicks.not_interested, lang), ctr: pct(ctrN, lang) })}
          </p>
        </div>
      </div>

      {lift != null && (
        <p className="text-[11px] text-surface-muted leading-relaxed">
          {lift > 1.2
            ? t('dashboardDetail.liftBetter', { lift })
            : lift < 0.85
              ? t('dashboardDetail.liftWorse')
              : t('dashboardDetail.liftFlat', { lift })}
        </p>
      )}

      {unknown > 0 && (
        <p className="text-[10px] text-surface-muted leading-relaxed">
          {data.has_categories === false
            ? t('dashboardDetail.unknownExtraNoCat', { n: fmt(unknown, lang) })
            : t('dashboardDetail.unknownExtraOld', { n: fmt(unknown, lang) })}
        </p>
      )}
    </div>
  );
}

// Fase 124 — panel compacto para el LISTADO del dashboard. Se pinta en
// vez del <EventCard> gigante para no sobrecargar la pantalla cuando
// hay varios eventos (con el cap de 4 activos + histórico, la lista se
// llena rápido). Muestra lo mínimo para saber qué te está pasando con
// cada campaña — plan, fecha, clicks y CTR agregado — y un chevron
// que empuja al usuario a abrir el detalle. El detalle completo
// (StatTiles, InterestBreakdown, banner Ultra, PromotionActions…) vive
// en CommunityDashboardEventPage.jsx y se enseña ahí de una vez.
//
// El agregado de "Clicks" suma los internos (notificación push /
// personas únicas) + los del banner Ultra + los del enlace externo,
// para dar una única cifra de "gente que interactuó con este anuncio"
// en la fila del listado. Los desgloses viven en el detalle.
export function EventCardCompact({ event, onOpen }) {
  const { t, lang } = useTranslation();
  const plan = PLAN_STYLE[event.promotion_plan] || PLAN_STYLE.basic;
  const bannerClicks = Number(event.ultra_banner_clicks || 0);
  const urlClicks = Number(event.url_clicks || 0);
  const totalClicks = (event.clicks?.total || 0) + bannerClicks + urlClicks;

  return (
    <button
      onClick={() => onOpen(event.id)}
      className="w-full text-left bg-surface-card border border-surface-border rounded-2xl p-3.5 flex items-center gap-3 hover:border-accent-primary/40 hover:bg-surface-card/80 transition-all"
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-display font-bold text-surface-text text-sm truncate">{event.title}</p>
          <Pill className={plan.pill}>{plan.emoji} {t('dashboardDetail.' + plan.labelKey)}</Pill>
        </div>
        <p className="text-[10px] font-mono text-surface-muted">
          {fmtDate(event.event_date, lang)}{event.started ? t('dashboardDetail.startedSuffix') : t('dashboardDetail.upcomingSuffix')}
        </p>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="text-surface-muted">
            👆 <span className="text-accent-glow">{fmt(totalClicks, lang)}</span> clicks
          </span>
          {event.promoted && (
            <span className="text-surface-muted">
              📈 CTR <span className="text-accent-glow">{pct(event.ctr, lang)}</span>
            </span>
          )}
        </div>
      </div>
      <span className="text-surface-muted text-xl leading-none flex-shrink-0" aria-hidden="true">›</span>
    </button>
  );
}

export function EventCard({ event, freeThreshold, onOpen, onRenew, onEnd }) {
  const { t, lang } = useTranslation();
  const plan = PLAN_STYLE[event.promotion_plan] || PLAN_STYLE.basic;

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            onClick={() => onOpen(event.id)}
            className="font-display font-bold text-surface-text text-sm text-left truncate hover:text-accent-glow transition-colors block max-w-full"
          >
            {event.title}
          </button>
          <p className="text-[10px] font-mono text-surface-muted mt-0.5">
            {fmtDate(event.event_date, lang)}{event.started ? t('dashboardDetail.startedSuffix') : t('dashboardDetail.upcomingSuffix')}
          </p>
        </div>
        <Pill className={plan.pill}>{plan.emoji} {t('dashboardDetail.' + plan.labelKey)}</Pill>
      </div>

      {!event.promoted ? (
        <p className="text-[11px] text-surface-muted leading-relaxed">
          {t('dashboardDetail.unpromotedEvent', { sends: fmt(event.sends.community, lang), clicks: fmt(event.clicks.total, lang), ctr: pct(event.ctr, lang) })}
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-surface-muted">{t('dashboardDetail.sentContracted')}</span>
              <span className="text-surface-text">
                {fmt(event.sent_official, lang)} / {fmt(event.contracted, lang)}
              </span>
            </div>
            <ProgressBar value={event.progress} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatTile label={t('dashboardDetail.sendsTotal')} value={fmt(event.sends.total, lang)} hint={t('dashboardDetail.sendsCommunityHint', { n: fmt(event.sends.community, lang) })} />
            <StatTile label={t('dashboardDetail.clicksLabel')} value={fmt(event.clicks.total, lang)} accent="text-accent-glow" />
            <StatTile label={t('dashboardDetail.ctrCol')} value={pct(event.ctr, lang)} accent="text-accent-glow" />
          </div>

          {/* Fase 123 — métricas del banner del menú principal
              (exclusivo Ultra). Se enseña APARTE del bloque de arriba
              porque son cosas distintas: arriba se mide el CTR de la
              notificación push (personas únicas que tapearon el push);
              aquí las impresiones y clicks del banner que aparece en
              HomePage a quien tiene claim del día. El banner es la
              prestación que justifica el sobrecoste de Ultra sobre
              Premium, así que merece su propia fila para que se vea el
              retorno. En Premium/Basic no aparece — el banner ni se
              muestra ni suma nada. */}
          {event.promotion_plan === 'ultra' && (
            <div className="bg-fuchsia-500/5 border border-fuchsia-500/20 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-mono text-fuchsia-300/80 uppercase tracking-wide">
                {t('dashboardDetail.ultraBannerBlock')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <StatTile
                  label={t('dashboardDetail.ultraReach')}
                  value={fmt(event.ultra_banner_views, lang)}
                  hint={t('dashboardDetail.ultraReachHint')}
                />
                <StatTile
                  label={t('dashboardDetail.clicksLabel')}
                  value={fmt(event.ultra_banner_clicks, lang)}
                  accent="text-accent-glow"
                />
                <StatTile
                  label={t('dashboardDetail.ultraCtrCol')}
                  value={pct(event.ultra_banner_ctr, lang)}
                  accent="text-accent-glow"
                />
              </div>
              <p className="text-[10px] text-surface-muted leading-relaxed">
                {t('dashboardDetail.ultraExplain')}
              </p>
            </div>
          )}

          {/* Fase 125 — clicks al enlace externo de ESTE evento. Antes
              vivía como chip pequeño en la fila de engagement de abajo
              y también agregado en la sección "URLs externas" del
              listado principal; se movió aquí para que el organizador
              vea qué evento le trae más gente a su web. Solo se pinta
              si el evento tiene URL — si no, no hay nada que medir. Es
              un contador ingenuo (cada tap suma), NO personas únicas —
              misma filosofía que el chip del banner Ultra de arriba. */}
          {event.url && (
            <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-mono text-accent-glow/80 uppercase tracking-wide">
                  {t('dashboardDetail.urlBlockTitle')}
                </p>
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-surface-muted hover:text-accent-glow truncate max-w-[55%]"
                  title={event.url}
                >
                  {event.url}
                </a>
              </div>
              <div className="flex items-baseline gap-3">
                <p className="font-display font-bold text-accent-glow text-2xl">
                  {fmt(event.url_clicks, lang)}
                </p>
                <p className="text-[11px] font-mono text-surface-muted">
                  {event.url_clicks === 1 ? t('dashboardDetail.urlClickOne') : t('dashboardDetail.urlClickMany')}
                </p>
              </div>
              <p className="text-[10px] text-surface-muted leading-relaxed">
                {t('dashboardDetail.urlExplain')}
              </p>
            </div>
          )}

          <div className="flex items-center flex-wrap gap-1.5">
            {event.audience_radius_km != null && (
              <Pill className="bg-surface-bg text-surface-muted border-surface-border">{t('dashboardDetail.radiusPill', { n: event.audience_radius_km })}</Pill>
            )}
            <Pill className={event.billable
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
              : 'bg-surface-bg text-surface-muted border-surface-border'}>
              {event.billable
                ? t('dashboardDetail.billablePill')
                : t('dashboardDetail.freeUntilPill', { threshold: fmt(freeThreshold, lang), sent: fmt(event.sent_official, lang) })}
            </Pill>
          </div>

          <InterestBreakdown
            data={event}
            filtered={event.audience_interested_only}
            unit={t('dashboardDetail.unitSends')}
            filteredNote={t('dashboardDetail.filterNoteEvt')}
          />
        </>
      )}

      <div className="border-t border-surface-border/60 pt-3 flex items-center gap-4 text-[11px] font-mono text-surface-muted">
        <span>{t('dashboardDetail.attendeesPill', { n: fmt(event.attendees, lang) })}</span>
        <span>{t('dashboardDetail.likesPill', { n: fmt(event.likes, lang) })}</span>
      </div>

      <PromotionActions
        row={event}
        kind="event"
        onRenew={() => onRenew(event)}
        onEnd={() => onEnd(event)}
        freeThreshold={freeThreshold}
        hasContract={event.promoted}
      />
    </div>
  );
}

// Fase 124 — panel compacto para el LISTADO del dashboard, mismo
// patrón que EventCardCompact. El detalle vive en
// CommunityDashboardRafflePage. Enseña lo justo para saber qué te está
// pasando con cada sorteo (tier, estado del sorteo, clicks del banner,
// CTR si aplica) y un chevron que empuja a abrir el detalle.
export function RaffleCardCompact({ raffle, onOpen }) {
  const { t, lang } = useTranslation();
  const style = TIER_STYLE[raffle.tier] || TIER_STYLE.light;
  const clicks = raffle.clicks?.total || 0;
  // Estado que se muestra en la sublínea. Mismo criterio que el
  // RaffleCard grande (drawn_at → "sorteado", ends_at pasado sin
  // sortear → "terminó", si no "termina el ..."). Los tres estados
  // ya llegan calculados desde el server (r.drawn_at / r.ended), lo
  // que hacemos aquí es solo formatear.
  const statusLabel = raffle.drawn_at
    ? t('dashboardDetail.raffleDrawnDate', { date: fmtDate(raffle.drawn_at, lang) })
    : raffle.ended ? t('dashboardDetail.raffleEndedDate', { date: fmtDate(raffle.ends_at, lang) }) : t('dashboardDetail.raffleEndsDate', { date: fmtDate(raffle.ends_at, lang) });

  return (
    <button
      onClick={() => onOpen(raffle.id)}
      className="w-full text-left bg-surface-card border border-surface-border rounded-2xl p-3.5 flex items-center gap-3 hover:border-accent-primary/40 hover:bg-surface-card/80 transition-all"
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-display font-bold text-surface-text text-sm truncate">{raffle.title}</p>
          <Pill className={style.pill}>{style.emoji} {raffle.tier_label}</Pill>
        </div>
        <p className="text-[10px] font-mono text-surface-muted">{statusLabel}</p>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="text-surface-muted">
            👆 <span className="text-accent-glow">{fmt(clicks, lang)}</span> clicks
          </span>
          <span className="text-surface-muted">
            📈 CTR <span className="text-accent-glow">{pct(raffle.ctr, lang)}</span>
          </span>
        </div>
      </div>
      <span className="text-surface-muted text-xl leading-none flex-shrink-0" aria-hidden="true">›</span>
    </button>
  );
}

export function RaffleCard({ raffle, freeThreshold, onOpen, onRenew, onEnd }) {
  const { t, lang } = useTranslation();
  const style = TIER_STYLE[raffle.tier] || TIER_STYLE.light;

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            onClick={() => onOpen(raffle.id)}
            className="font-display font-bold text-surface-text text-sm text-left truncate hover:text-accent-glow transition-colors block max-w-full"
          >
            {raffle.title}
          </button>
          <p className="text-[10px] font-mono text-surface-muted mt-0.5">
            {raffle.drawn_at
              ? t('dashboardDetail.raffleDrawnDate', { date: fmtDate(raffle.drawn_at, lang) })
              : raffle.ended ? t('dashboardDetail.raffleEndedDate', { date: fmtDate(raffle.ends_at, lang) }) : t('dashboardDetail.raffleEndsDate', { date: fmtDate(raffle.ends_at, lang) })}
          </p>
        </div>
        <Pill className={style.pill}>{style.emoji} {raffle.tier_label}</Pill>
      </div>

      {raffle.contracted != null && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-surface-muted">{t('dashboardDetail.bannersContracted')}</span>
            <span className="text-surface-text">{fmt(raffle.shown, lang)} / {fmt(raffle.contracted, lang)}</span>
          </div>
          <ProgressBar value={raffle.progress} barClass={style.bar} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatTile
          label={t('dashboardDetail.bannersShown')}
          value={fmt(raffle.shown, lang)}
          hint={raffle.pending > 0 ? t('dashboardDetail.bannersPending', { n: fmt(raffle.pending, lang) }) : t('dashboardDetail.bannersComplete')}
        />
        <StatTile label={t('dashboardDetail.clicksLabel')} value={fmt(raffle.clicks.total, lang)} accent="text-accent-glow" />
        <StatTile label={t('dashboardDetail.ctrCol')} value={pct(raffle.ctr, lang)} accent="text-accent-glow" />
      </div>

      {/* Asignados vs enseñados: la avioneta se sirve diferida (la próxima
          vez que cada persona entre al menú principal) y como mucho una cada
          15 min por usuario, así que la cola es normal y no un error. */}
      <p className="text-[11px] text-surface-muted leading-relaxed">
        {t('dashboardDetail.targetsExplain', { n: fmt(raffle.targets, lang) })}
        {raffle.pending > 0
          ? t('dashboardDetail.targetsPending', { n: fmt(raffle.pending, lang) })
          : t('dashboardDetail.targetsAll')}
      </p>

      <InterestBreakdown
        data={raffle}
        filtered={raffle.banner_interested_only}
        unit={t('dashboardDetail.unitBanners')}
        filteredNote={t('dashboardDetail.filterNoteRaf')}
      />

      {raffle.eligible_participants != null && (
        <div className="border-t border-surface-border/60 pt-3 text-[11px] font-mono text-surface-muted">
          {t('dashboardDetail.eligibleCount', { n: fmt(raffle.eligible_participants, lang) })}
        </div>
      )}

      {raffle.promo_ended_at && !raffle.ended && (
        <div className="border-t border-surface-border/60 pt-3">
          <Pill className="bg-red-500/10 text-red-300 border-red-500/25">{t('dashboardDetail.promoEndedTag')}</Pill>
          <p className="text-[11px] text-surface-muted mt-2 leading-relaxed">
            {t('dashboardDetail.promoEndedExpl', { date: fmtDate(raffle.promo_ended_at, lang) })}
          </p>
        </div>
      )}

      <PromotionActions
        row={raffle}
        kind="raffle"
        onRenew={() => onRenew(raffle)}
        onEnd={() => onEnd(raffle)}
        freeThreshold={freeThreshold}
        hasContract={raffle.tier === 'light' || raffle.tier === 'community'}
      />
    </div>
  );
}

export default function CommunityDashboardPage() {
  const { t, lang } = useTranslation();
  const { communityId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('events');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/community/communities/${communityId}/dashboard`);
      setData(res);
    } catch (e) {
      setError(e.message || t('dashboardDetail.loadFailDefault'));
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    load();
  }, [load]);

  // NOTA (fase 124): los handlers de renovar/finalizar campaña de eventos
  // Y sorteos viven ahora en sus subpáginas correspondientes
  // (CommunityDashboardEventPage y CommunityDashboardRafflePage). Esta
  // página es solo el LISTADO — al tapear cualquier fila se navega al
  // detalle y allí se ejecutan las acciones. Sin esto, el listado
  // arrastraría la mitad del estado (ending, endingBusy, modales) para
  // botones que ya no está pintando.

  // Se ordenan por clicks: lo primero que quieres ver al abrir esto es qué
  // campaña funcionó, no cuál publicaste antes. A igualdad de clicks manda
  // el alcance, para que dos campañas sin clicks no salgan en orden aleatorio.
  const events = useMemo(() => {
    if (!data?.events) return [];
    return [...data.events].sort((a, b) => (b.clicks.total - a.clicks.total) || (b.sends.total - a.sends.total));
  }, [data]);

  const raffles = useMemo(() => {
    if (!data?.raffles) return [];
    return [...data.raffles].sort((a, b) => (b.clicks.total - a.clicks.total) || (b.shown - a.shown));
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <p className="text-surface-muted font-mono text-sm">{t('dashboardDetail.loadingDash')}</p>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="font-display font-bold text-surface-text">{t('dashboardDetail.loadFailTitle')}</p>
          <p className="text-sm text-surface-muted leading-relaxed">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={load} className="px-4 py-2 rounded-xl border border-surface-border text-surface-text text-xs font-display font-semibold">
              {t('dashboardDetail.retry')}
            </button>
            <button
              onClick={() => navigate(`/community/${communityId}`)}
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

  const s = data.summary;
  const activeRows = tab === 'events' ? events : raffles;

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(`/community/${communityId}`)}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center flex-shrink-0"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-base truncate">{t('dashboardDetail.dashHeader')}</h1>
            <p className="text-[10px] font-mono text-surface-muted truncate">{data.community.name}</p>
          </div>
          <button
            onClick={load}
            title={t('dashboardDetail.refreshTitle')}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-muted flex items-center justify-center flex-shrink-0 hover:text-accent-glow hover:border-accent-primary/40 transition-colors"
          >
            ↻
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4 space-y-5">
        {/* ── Resumen global ──────────────────────────────────────────────
            "Impresiones" junta dos cosas que no son idénticas pero sí
            comparables: notificaciones de evento entregadas y banners de
            sorteo enseñados. Las dos son "una vez que tu anuncio apareció
            delante de alguien", que es lo que interesa sumar aquí. */}
        <section className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
          <h2 className="font-display font-bold text-surface-text text-sm">{t('dashboardDetail.summaryTitle')}</h2>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label={t('dashboardDetail.kpiImpressions')} value={fmt(s.total_impressions, lang)} hint={t('dashboardDetail.kpiImpressionsHint')} />
            <StatTile label={t('dashboardDetail.kpiClicks')} value={fmt(s.total_clicks, lang)} accent="text-accent-glow" hint={t('dashboardDetail.kpiClicksHint')} />
            <StatTile label={t('dashboardDetail.kpiCtr')} value={pct(s.total_ctr, lang)} accent="text-accent-glow" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-mono text-surface-muted">{t('dashboardDetail.eventsBlock')}</p>
              <p className="font-display font-bold text-surface-text text-sm mt-0.5">
                {fmt(s.event_clicks, lang)} <span className="font-normal text-surface-muted text-xs">{t('dashboardDetail.ofX', { n: fmt(s.event_sends, lang) })}</span>
              </p>
              <p className="text-[10px] text-surface-muted mt-0.5">
                {t('dashboardDetail.eventsBlockSub', { ctr: pct(s.event_ctr, lang), promoted: fmt(s.events_promoted, lang), total: fmt(s.events_total, lang) })}
              </p>
            </div>
            <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-mono text-surface-muted">{t('dashboardDetail.rafflesBlock')}</p>
              <p className="font-display font-bold text-surface-text text-sm mt-0.5">
                {fmt(s.raffle_clicks, lang)} <span className="font-normal text-surface-muted text-xs">{t('dashboardDetail.ofX', { n: fmt(s.raffle_shown, lang) })}</span>
              </p>
              <p className="text-[10px] text-surface-muted mt-0.5">
                {t('dashboardDetail.rafflesBlockSub', { ctr: pct(s.raffle_ctr, lang), total: fmt(s.raffles_total, lang) })}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-surface-muted leading-relaxed">
            {t('dashboardDetail.summaryExplain')}
          </p>
        </section>

        {/* Fase 121 — clicks a URL externa de la comunidad. Es un
            contador DISTINTO al bloque de arriba: allí se mide CTR de
            personas únicas del ANUNCIO interno (push del evento,
            avioneta del sorteo); aquí se mide cuánta gente ha tapeado
            el 🔗 externo de tu comunidad. Los reboteos SÍ cuentan (el
            mismo usuario abriendo tres veces suma tres) porque lo que
            interesa medir es la tracción bruta del enlace, no el CTR
            de una campaña.
            NOTA (fase 125): antes había también un agregado de "clicks
            a URLs de eventos" aquí — se movió al detalle de cada
            evento (CommunityDashboardEventPage → EventCard) porque
            saber el total ciego servía de poco; lo que ayuda al
            organizador es ver cuál es el evento que le trae más gente
            a su web. Ver mini-bloque "🔗 Enlace externo" en EventCard.
            Los sorteos no tienen URL (fase 122). */}
        {s.community_url_clicks != null && (
          <section className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-2">
            <h2 className="font-display font-bold text-surface-text text-sm flex items-center gap-2">
              {t('dashboardDetail.commUrlTitle')}
              <span className="text-[10px] font-mono text-surface-muted font-normal">{t('dashboardDetail.accumulatedTag')}</span>
            </h2>
            <div className="flex items-baseline gap-3">
              <p className="font-display font-bold text-accent-glow text-2xl">
                {fmt(s.community_url_clicks, lang)}
              </p>
              <p className="text-[11px] font-mono text-surface-muted">
                {data.community.url ? t('dashboardDetail.toYourWeb') : t('dashboardDetail.noUrlYet')}
              </p>
            </div>
            <p className="text-[10px] text-surface-muted leading-relaxed">
              {t('dashboardDetail.commUrlExplain')}
            </p>
          </section>
        )}

        {/* Fase 126 — gráfico temporal para las métricas agregadas de la
            comunidad. Fase 128 amplió el catálogo: además de los clicks
            al enlace ya existentes, ahora se pueden graficar los
            envíos/clicks push totales de eventos y los banners/clicks
            totales de sorteos. Por eso el bloque ya no está condicionado
            a que la comunidad tenga URL — con actividad publicitaria
            (aunque no haya enlace propio) el gráfico ya aporta datos. */}
        <TimeseriesChart
          communityId={communityId}
          entityType="community"
          entityId={communityId}
          entity={data.community}
        />

        {/* Fase 121 — tope de actividades vivas por comunidad. Se
            enseña con un badge X/4 en ámbar cuando queda hueco y en
            rojo cuando ya está lleno (los POST de creación tirarán
            400). Solo el creador ve el dashboard, así que este aviso
            es el sitio natural para verlo. */}
        {s.active_activity_limit != null && (
          <section className={`border rounded-2xl p-4 flex items-center gap-3 ${
            s.active_activity_count >= s.active_activity_limit
              ? 'bg-red-500/5 border-red-500/25'
              : 'bg-surface-card border-surface-border'
          }`}>
            <span className="text-2xl">
              {s.active_activity_count >= s.active_activity_limit ? '🚫' : '📌'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-surface-text text-sm">
                {t('dashboardDetail.activeLimitTitle')} <span className="font-mono text-surface-muted">
                  ({fmt(s.active_activity_count, lang)}/{fmt(s.active_activity_limit, lang)})
                </span>
              </p>
              <p className="text-[11px] text-surface-muted mt-0.5 leading-relaxed">
                {s.active_activity_count >= s.active_activity_limit
                  ? t('dashboardDetail.activeLimitFull')
                  : t('dashboardDetail.activeLimitHint', { n: s.active_activity_limit })}
              </p>
            </div>
          </section>
        )}

        {/* ── Pestañas ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {[
            { key: 'events',  label: t('dashboardDetail.tabEvents', { n: events.length }) },
            { key: 'raffles', label: t('dashboardDetail.tabRaffles', { n: raffles.length }) },
          ].map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`flex-1 py-2 rounded-xl text-xs font-display font-semibold border transition-colors ${
                tab === tb.key
                  ? 'bg-accent-primary/15 text-accent-glow border-accent-primary/30'
                  : 'bg-surface-card text-surface-muted border-surface-border hover:text-surface-text'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {activeRows.length === 0 ? (
          <div className="text-center py-10 border border-surface-border rounded-2xl bg-surface-card px-6">
            <p className="text-sm text-surface-muted leading-relaxed">
              {tab === 'events' ? t('dashboardDetail.emptyEvents') : t('dashboardDetail.emptyRaffles')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tab === 'events'
              ? events.map(e => (
                  <EventCardCompact
                    key={e.id}
                    event={e}
                    onOpen={id => navigate(`/community/${communityId}/dashboard/event/${id}`)}
                  />
                ))
              : raffles.map(r => (
                  <RaffleCardCompact
                    key={r.id}
                    raffle={r}
                    onOpen={id => navigate(`/community/${communityId}/dashboard/raffle/${id}`)}
                  />
                ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
