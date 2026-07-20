import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

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

const TIER_STYLE = {
  light:     { emoji: '🎫', text: 'text-amber-300', bar: 'bg-amber-400', pill: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
  volt:      { emoji: '⚡', text: 'text-blue-300',  bar: 'bg-blue-400',  pill: 'bg-blue-500/10 text-blue-300 border-blue-500/25' },
  community: { emoji: '🏠', text: 'text-red-300',   bar: 'bg-red-400',   pill: 'bg-red-500/10 text-red-300 border-red-500/25' },
};

const PLAN_STYLE = {
  ultra:   { emoji: '🚀', label: 'Ultra',   pill: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/25' },
  premium: { emoji: '⚡', label: 'Premium', pill: 'bg-accent-primary/10 text-accent-glow border-accent-primary/25' },
  basic:   { emoji: '·',  label: 'Basic',   pill: 'bg-surface-bg text-surface-muted border-surface-border' },
};

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES');
}

// null = "todavía no hay base sobre la que calcular" (0 impresiones), que no
// es lo mismo que 0 % ("hubo impresiones y no picó nadie"). Se pintan
// distinto a propósito: un guión no es un mal resultado, un 0 % sí.
function pct(value) {
  if (value == null) return '—';
  return `${Number(value).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Pill({ className = '', children }) {
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
function ConfirmEndModal({ open, kind, title, onCancel, onConfirm, busy }) {
  if (!open) return null;
  const label = kind === 'event' ? 'la publicidad de este evento' : 'la publicidad de este sorteo';
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
          <p className="font-display font-bold text-surface-text text-sm">Finalizar publicidad</p>
          <p className="text-[12px] text-surface-muted mt-1 leading-relaxed">
            Vas a cerrar {label} de <span className="text-surface-text">{title}</span>.
          </p>
          <p className="text-[11px] text-surface-muted mt-2 leading-relaxed">
            Los envíos publicitarios se detienen inmediatamente. El {kind === 'event' ? 'evento' : 'sorteo'} en sí sigue igual — esto solo cierra la promoción. Después podrás renovarla si te arrepientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 rounded-xl border border-surface-border text-surface-text text-xs font-display font-semibold disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-xs font-display font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            Sí, finalizar
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
function PromotionActions({ row, kind, onRenew, onEnd, freeThreshold, hasContract }) {
  if (!hasContract) return null;

  const canRenew = row.can_renew;
  const canEnd = row.can_end;
  const sent = kind === 'event' ? row.sent_official : row.shown;
  const belowThreshold = sent < freeThreshold;
  const unitLabel = kind === 'event' ? 'envíos' : 'banners enseñados';
  // "Terminado" cubre tanto el evento ya empezado como el sorteo ya
  // acabado/sorteado — en ambos casos la promoción ya no se puede tocar,
  // así que en vez de solo deshabilitar el botón se explica el porqué.
  const isOver = kind === 'event' ? row.started : row.ended;
  const isDrawn = kind === 'raffle' && !!row.drawn_at;
  const overLabel = kind === 'event'
    ? 'El evento ya ha terminado'
    : isDrawn ? 'El sorteo ya se ha realizado' : 'El sorteo ya ha terminado';

  const renewTitle = isOver
    ? `${overLabel} — no se puede renovar`
    : belowThreshold
      ? `Necesitas alcanzar ${freeThreshold} ${unitLabel} para renovar (${sent}/${freeThreshold})`
      : kind === 'event' ? 'Renovar promoción del evento' : 'Renovar publicidad del sorteo';

  const endTitle = isOver
    ? `${overLabel} — la promoción se cerró sola`
    : kind === 'raffle' && row.promo_ended_at
      ? 'La publicidad ya está finalizada'
      : belowThreshold
        ? `Necesitas alcanzar ${freeThreshold} ${unitLabel} para finalizar (${sent}/${freeThreshold})`
        : kind === 'event' ? 'Finalizar promoción del evento' : 'Finalizar publicidad del sorteo';

  return (
    <div className="border-t border-surface-border/60 pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onRenew}
          disabled={!canRenew}
          title={renewTitle}
          className="flex-1 py-2 rounded-xl bg-accent-primary/15 text-accent-glow border border-accent-primary/30 hover:bg-accent-primary/25 text-xs font-display font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🔄 Renovar
        </button>
        <button
          onClick={onEnd}
          disabled={!canEnd}
          title={endTitle}
          className="flex-1 py-2 rounded-xl bg-surface-bg border border-red-500/25 text-red-300 hover:bg-red-500/10 text-xs font-display font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ⏹ Finalizar
        </button>
      </div>
      {isOver ? (
        <p className="text-[10px] text-surface-muted leading-relaxed">
          {overLabel}. Los botones se enseñan como referencia, pero ya no se pueden accionar.
        </p>
      ) : belowThreshold ? (
        <p className="text-[10px] text-surface-muted leading-relaxed">
          Todavía no puedes actuar sobre esta promoción: hace falta llegar al mínimo de {freeThreshold} {unitLabel} para que pueda cobrarse ({sent}/{freeThreshold}).
        </p>
      ) : null}
    </div>
  );
}

function StatTile({ label, value, hint, accent = 'text-surface-text' }) {
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
function ProgressBar({ value, barClass = 'bg-accent-primary' }) {
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
function InterestBreakdown({ data, filtered, unit, filteredNote }) {
  const { interested, not_interested: notInterested, unknown } = data.interest;
  const classified = interested + notInterested;

  if (!classified && !unknown) {
    return (
      <div className="border-t border-surface-border/60 pt-3 mt-3">
        <p className="text-[11px] text-surface-muted leading-relaxed">
          Todavía no hay {unit} que desglosar.
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
          Sin clasificar ({fmt(unknown)} {unit}): {data.has_categories === false
            ? 'no hay categorías definidas con las que cruzar los intereses de la gente.'
            : 'son envíos anteriores a que se empezaran a registrar los segmentos.'}
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
          <Pill className="bg-accent-primary/10 text-accent-glow border-accent-primary/25 mt-0.5">🎯 Solo interesados</Pill>
          <p className="text-[11px] text-surface-muted leading-relaxed">{filteredNote}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-mono text-surface-muted">Reparto de {unit}</p>
        <p className="text-[10px] font-mono text-surface-muted">{interestedShare} % interesados</p>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden border border-surface-border bg-surface-bg">
        <div className="bg-emerald-400" style={{ width: `${interestedShare}%` }} />
        <div className="bg-surface-muted/40" style={{ width: `${100 - interestedShare}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
          <p className="text-[10px] font-mono text-emerald-300">🎯 Interesados</p>
          <p className="font-display font-bold text-surface-text text-sm mt-0.5">{fmt(interested)}</p>
          <p className="text-[10px] text-surface-muted mt-0.5">
            {fmt(data.clicks.interested)} clicks · CTR {pct(ctrI)}
          </p>
        </div>
        <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
          <p className="text-[10px] font-mono text-surface-muted">◦ No interesados</p>
          <p className="font-display font-bold text-surface-text text-sm mt-0.5">{fmt(notInterested)}</p>
          <p className="text-[10px] text-surface-muted mt-0.5">
            {fmt(data.clicks.not_interested)} clicks · CTR {pct(ctrN)}
          </p>
        </div>
      </div>

      {lift != null && (
        <p className="text-[11px] text-surface-muted leading-relaxed">
          {lift > 1.2
            ? <>Los interesados picaron <span className="font-mono text-emerald-300">{lift}×</span> más. Filtrar por intereses en la próxima campaña te daría menos alcance pero mejor conversión.</>
            : lift < 0.85
              ? <>Curiosamente los NO interesados picaron más. Con estos números, filtrar por intereses solo te recortaría alcance.</>
              : <>Los dos segmentos picaron prácticamente igual (<span className="font-mono text-surface-text">{lift}×</span>): aquí el filtro de intereses no te aportaría gran cosa.</>}
        </p>
      )}

      {unknown > 0 && (
        <p className="text-[10px] text-surface-muted leading-relaxed">
          + {fmt(unknown)} sin clasificar {data.has_categories === false
            ? '(sin categorías con las que cruzar intereses).'
            : '(envíos anteriores al registro de segmentos).'}
        </p>
      )}
    </div>
  );
}

function EventCard({ event, freeThreshold, onOpen, onRenew, onEnd }) {
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
            {fmtDate(event.event_date)}{event.started ? ' · ya empezó' : ' · próximo'}
          </p>
        </div>
        <Pill className={plan.pill}>{plan.emoji} {plan.label}</Pill>
      </div>

      {!event.promoted ? (
        <p className="text-[11px] text-surface-muted leading-relaxed">
          Evento sin promoción de pago. Los miembros de tu comunidad recibieron el aviso igualmente
          ({fmt(event.sends.community)} avisos, {fmt(event.clicks.total)} clicks · CTR {pct(event.ctr)}).
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-surface-muted">Enviadas de las contratadas</span>
              <span className="text-surface-text">
                {fmt(event.sent_official)} / {fmt(event.contracted)}
              </span>
            </div>
            <ProgressBar value={event.progress} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Envíos totales" value={fmt(event.sends.total)} hint={`${fmt(event.sends.community)} a tu comunidad`} />
            <StatTile label="Clicks" value={fmt(event.clicks.total)} accent="text-accent-glow" />
            <StatTile label="CTR" value={pct(event.ctr)} accent="text-accent-glow" />
          </div>

          <div className="flex items-center flex-wrap gap-1.5">
            {event.audience_radius_km != null && (
              <Pill className="bg-surface-bg text-surface-muted border-surface-border">📍 {event.audience_radius_km} km</Pill>
            )}
            <Pill className={event.billable
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
              : 'bg-surface-bg text-surface-muted border-surface-border'}>
              {event.billable
                ? '💶 Se cobrará'
                : `Gratis hasta ${fmt(freeThreshold)} envíos (${fmt(event.sent_official)}/${fmt(freeThreshold)})`}
            </Pill>
          </div>

          <InterestBreakdown
            data={event}
            filtered={event.audience_interested_only}
            unit="envíos"
            filteredNote="El filtro solo cría el pool publicitario. El aviso a los miembros de tu comunidad sale igualmente, tengan intereses afines o no, y también cuenta aquí."
          />
        </>
      )}

      <div className="border-t border-surface-border/60 pt-3 flex items-center gap-4 text-[11px] font-mono text-surface-muted">
        <span>👥 {fmt(event.attendees)} apuntados</span>
        <span>❤️ {fmt(event.likes)} likes</span>
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

function RaffleCard({ raffle, freeThreshold, onOpen, onRenew, onEnd }) {
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
              ? `Sorteado el ${fmtDate(raffle.drawn_at)}`
              : raffle.ended ? `Terminó el ${fmtDate(raffle.ends_at)}` : `Termina el ${fmtDate(raffle.ends_at)}`}
          </p>
        </div>
        <Pill className={style.pill}>{style.emoji} {raffle.tier_label}</Pill>
      </div>

      {raffle.contracted != null && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-surface-muted">Banners enseñados de los contratados</span>
            <span className="text-surface-text">{fmt(raffle.shown)} / {fmt(raffle.contracted)}</span>
          </div>
          <ProgressBar value={raffle.progress} barClass={style.bar} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatTile
          label="Enseñados"
          value={fmt(raffle.shown)}
          hint={raffle.pending > 0 ? `${fmt(raffle.pending)} en cola` : 'reparto completo'}
        />
        <StatTile label="Clicks" value={fmt(raffle.clicks.total)} accent="text-accent-glow" />
        <StatTile label="CTR" value={pct(raffle.ctr)} accent="text-accent-glow" />
      </div>

      {/* Asignados vs enseñados: la avioneta se sirve diferida (la próxima
          vez que cada persona entre al menú principal) y como mucho una cada
          15 min por usuario, así que la cola es normal y no un error. */}
      <p className="text-[11px] text-surface-muted leading-relaxed">
        {fmt(raffle.targets)} personas tienen el banner asignado.{' '}
        {raffle.pending > 0
          ? `A ${fmt(raffle.pending)} aún no se les ha cruzado: la avioneta se muestra la próxima vez que entren al menú principal.`
          : 'A todas se les ha llegado a enseñar.'}
      </p>

      <InterestBreakdown
        data={raffle}
        filtered={raffle.banner_interested_only}
        unit="banners"
        filteredNote="Contratado con filtro: los banners solo fueron a gente con intereses afines a tu comunidad."
      />

      {raffle.eligible_participants != null && (
        <div className="border-t border-surface-border/60 pt-3 text-[11px] font-mono text-surface-muted">
          🎁 {fmt(raffle.eligible_participants)} participantes elegibles
        </div>
      )}

      {raffle.promo_ended_at && !raffle.ended && (
        <div className="border-t border-surface-border/60 pt-3">
          <Pill className="bg-red-500/10 text-red-300 border-red-500/25">⏹ Publicidad finalizada</Pill>
          <p className="text-[11px] text-surface-muted mt-2 leading-relaxed">
            Cerraste el reparto el {fmtDate(raffle.promo_ended_at)}. Los banners pendientes ya no se enseñan. Puedes reabrirla con "Renovar".
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
  const { communityId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('events');

  // Estado del modal de finalización. Un único slot — nunca se puede tener
  // dos confirmaciones abiertas a la vez, así que basta con "qué fila y de
  // qué tipo". `endingBusy` bloquea el botón de confirmar mientras vuela el
  // POST, para que un doble tap no dispare dos peticiones.
  const [ending, setEnding] = useState(null); // { kind, row } | null
  const [endingBusy, setEndingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/community/communities/${communityId}/dashboard`);
      setData(res);
    } catch (e) {
      setError(e.message || 'No se pudo cargar el dashboard');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Handlers de acciones de promoción ─────────────────────────────────────
  // Renovar navega a la página de configuración correspondiente con el
  // estado necesario para arrancar en modo renovación (renewEvent/renewRaffle
  // en el state). Es lo que interpretan EventAdConfigPage y
  // RaffleAdAudiencePage: si detectan estos objetos, prellenan el formulario
  // con los valores actuales y al confirmar llaman al endpoint renew-promotion
  // en vez de al de creación. Sin ese state las páginas siguen siendo las de
  // crear un evento/sorteo nuevo — no rompemos el flujo original.
  const handleRenewEvent = useCallback((event) => {
    navigate('/community/event-publicidad', {
      state: {
        renewEvent: {
          id: event.id,
          title: event.title,
          promotion_plan: event.promotion_plan,
          notification_count: event.contracted,
          communityId,
          communityName: data?.community?.name || '',
        },
      },
    });
  }, [navigate, communityId, data]);

  const handleRenewRaffle = useCallback((raffle) => {
    navigate(`/community/${communityId}/raffle-publicidad`, {
      state: {
        renewRaffle: {
          id: raffle.id,
          title: raffle.title,
          tier: raffle.tier,
          // Categorías propias del sorteo (fase 116): las usa
          // RaffleAdAudiencePage para pedir el conteo de "interesados"
          // contra las categorías del sorteo (con fallback a comunidad si
          // el sorteo no tiene). El dashboard ya las expone en la fila.
          categories: raffle.categories,
          banner_views_contracted: raffle.contracted,
          banner_interested_only: raffle.banner_interested_only,
        },
        communityName: data?.community?.name || '',
      },
    });
  }, [navigate, communityId, data]);

  // Finalizar sí es acción destructiva y no lleva parámetros: se dispara con
  // confirmación en modal. Se refresca el dashboard al terminar para que el
  // usuario vea el nuevo estado (promo_ended_at pintado, botones ajustados)
  // sin tener que tirar del pull-to-refresh.
  const askEnd = useCallback((kind, row) => {
    setEnding({ kind, row });
  }, []);

  const confirmEnd = useCallback(async () => {
    if (!ending) return;
    const path = ending.kind === 'event'
      ? `/community/events/${ending.row.id}/end-promotion`
      : `/community/raffles/${ending.row.id}/end-promotion`;
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
        <p className="text-surface-muted font-mono text-sm">Cargando dashboard...</p>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="font-display font-bold text-surface-text">No se pudo abrir el dashboard</p>
          <p className="text-sm text-surface-muted leading-relaxed">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={load} className="px-4 py-2 rounded-xl border border-surface-border text-surface-text text-xs font-display font-semibold">
              Reintentar
            </button>
            <button
              onClick={() => navigate(`/community/${communityId}`)}
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
            <h1 className="font-display font-bold text-surface-text text-base truncate">📊 Dashboard</h1>
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

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4 space-y-5">
        {/* ── Resumen global ──────────────────────────────────────────────
            "Impresiones" junta dos cosas que no son idénticas pero sí
            comparables: notificaciones de evento entregadas y banners de
            sorteo enseñados. Las dos son "una vez que tu anuncio apareció
            delante de alguien", que es lo que interesa sumar aquí. */}
        <section className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
          <h2 className="font-display font-bold text-surface-text text-sm">Resumen de toda la publicidad</h2>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Impresiones" value={fmt(s.total_impressions)} hint="envíos + banners" />
            <StatTile label="Clicks" value={fmt(s.total_clicks)} accent="text-accent-glow" hint="personas únicas" />
            <StatTile label="CTR global" value={pct(s.total_ctr)} accent="text-accent-glow" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-mono text-surface-muted">📅 Eventos</p>
              <p className="font-display font-bold text-surface-text text-sm mt-0.5">
                {fmt(s.event_clicks)} <span className="font-normal text-surface-muted text-xs">de {fmt(s.event_sends)}</span>
              </p>
              <p className="text-[10px] text-surface-muted mt-0.5">
                CTR {pct(s.event_ctr)} · {fmt(s.events_promoted)}/{fmt(s.events_total)} promocionados
              </p>
            </div>
            <div className="bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-mono text-surface-muted">🎁 Sorteos</p>
              <p className="font-display font-bold text-surface-text text-sm mt-0.5">
                {fmt(s.raffle_clicks)} <span className="font-normal text-surface-muted text-xs">de {fmt(s.raffle_shown)}</span>
              </p>
              <p className="text-[10px] text-surface-muted mt-0.5">
                CTR {pct(s.raffle_ctr)} · {fmt(s.raffles_total)} sorteos
              </p>
            </div>
          </div>
          <p className="text-[10px] text-surface-muted leading-relaxed">
            Un click es una persona distinta que abrió el contenido desde el anuncio, no una visita: las vueltas
            posteriores no vuelven a contar.
          </p>
        </section>

        {/* ── Pestañas ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {[
            { key: 'events',  label: `📅 Eventos (${events.length})` },
            { key: 'raffles', label: `🎁 Sorteos (${raffles.length})` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 rounded-xl text-xs font-display font-semibold border transition-colors ${
                tab === t.key
                  ? 'bg-accent-primary/15 text-accent-glow border-accent-primary/30'
                  : 'bg-surface-card text-surface-muted border-surface-border hover:text-surface-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeRows.length === 0 ? (
          <div className="text-center py-10 border border-surface-border rounded-2xl bg-surface-card px-6">
            <p className="text-sm text-surface-muted leading-relaxed">
              {tab === 'events'
                ? 'Todavía no has publicado ningún evento en esta comunidad. Cuando promociones uno, aquí verás a cuánta gente llegó y quién picó.'
                : 'Todavía no has creado ningún sorteo. Cuando lo hagas, aquí verás cuántos banners se enseñaron y cuántos acabaron en visita.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tab === 'events'
              ? events.map(e => (
                  <EventCard
                    key={e.id}
                    event={e}
                    freeThreshold={s.free_threshold}
                    onOpen={id => navigate(`/community/event/${id}`)}
                    onRenew={handleRenewEvent}
                    onEnd={row => askEnd('event', row)}
                  />
                ))
              : raffles.map(r => (
                  <RaffleCard
                    key={r.id}
                    raffle={r}
                    freeThreshold={s.free_threshold}
                    onOpen={id => navigate(`/community/${communityId}#raffle-${id}`)}
                    onRenew={handleRenewRaffle}
                    onEnd={row => askEnd('raffle', row)}
                  />
                ))}
          </div>
        )}
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
