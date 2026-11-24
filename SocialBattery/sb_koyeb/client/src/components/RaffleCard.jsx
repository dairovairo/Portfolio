import { useState } from 'react';
import { api } from '../lib/api';
import { formatEurFromCents } from '../lib/adPricing';
import { PAYMENTS_ENABLED } from '../lib/features';
import { localeTag, raffleTier } from '../lib/raffleTiers';
import { useToast } from '../context/ToastContext';
import { getCategoryEmoji } from '../constants/categories';
import { useTranslation } from '../i18n';
import RaffleAvatar from './RaffleAvatar';
import { RaffleRulesModal, RaffleVerifyModal } from './RaffleModals';

const SMALL_BTN = 'px-2.5 py-1.5 rounded-lg border text-[11px] font-display font-semibold transition-all disabled:opacity-50';
const PRIMARY_BTN = `${SMALL_BTN} border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25`;
const PLAIN_BTN = `${SMALL_BTN} border-surface-border bg-surface-bg text-surface-muted hover:text-surface-text`;
const DANGER_BTN = `${SMALL_BTN} border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`;

function endLabel(raffle, t, lang) {
  const end = new Date(raffle.ends_at);
  const diffMs = end.getTime() - Date.now();
  if (raffle.is_drawn) {
    return t('raffle.endedOn', { date: end.toLocaleDateString(localeTag(lang), { day: 'numeric', month: 'short' }) });
  }
  if (diffMs <= 0) return t('community.raffleEnded');
  const days = Math.ceil(diffMs / (24 * 3600 * 1000));
  if (days === 1) {
    return end.toDateString() === new Date().toDateString() ? t('community.raffleEndsToday') : t('community.raffleEndsTomorrow');
  }
  return t('community.raffleEndsInDays', { n: days });
}

// Entrega del premio: cada parte ve su siguiente paso.
function PrizeDelivery({ prize, raffle, onAction, busy }) {
  const { t, lang } = useTranslation();
  const status = prize.claim_status;
  if (!status || (!prize.is_mine && !raffle.is_creator)) return null;
  const deadline = prize.claim_deadline ? new Date(prize.claim_deadline) : null;
  const expired = Boolean(deadline) && deadline < new Date();
  const date = deadline?.toLocaleDateString(localeTag(lang), { day: 'numeric', month: 'long' });

  const button = (action, label, className = PRIMARY_BTN, confirm = null) => (
    <button
      key={action}
      type="button"
      disabled={busy}
      className={className}
      onClick={() => { if (!confirm || window.confirm(confirm)) onAction(prize, action); }}
    >
      {label}
    </button>
  );

  let text = '';
  let buttons = [];
  if (prize.is_mine) {
    if (status === 'pending') {
      text = expired ? t('raffle.mineExpired') : t('raffle.minePending', { date });
      if (!expired) buttons = [button('claim', t('raffle.claimBtn'))];
    } else if (status === 'claimed') {
      text = t('raffle.mineClaimed', { contact: raffle.organizer_contact || '—' });
      buttons = [button('received', t('raffle.receivedBtn')), button('dispute', t('raffle.disputeBtn'), DANGER_BTN, t('raffle.disputeConfirm'))];
    } else if (status === 'delivered') {
      text = t('raffle.mineDelivered');
      buttons = [button('received', t('raffle.receivedBtn')), button('dispute', t('raffle.disputeBtn'), DANGER_BTN, t('raffle.disputeConfirm'))];
    } else if (status === 'disputed') {
      text = t('raffle.mineDisputed');
      buttons = [button('received', t('raffle.receivedBtn'))];
    } else {
      text = `✓ ${t('raffle.mineReceived')}`;
    }
  } else if (status === 'pending') {
    text = expired ? t('raffle.orgExpired') : t('raffle.orgPending', { date });
    if (expired) buttons = [button('redraw', t('raffle.redrawBtn'), PRIMARY_BTN, t('raffle.redrawConfirm'))];
  } else if (status === 'claimed') {
    text = t('raffle.orgClaimed');
    buttons = [button('delivered', t('raffle.deliveredBtn'))];
  } else if (status === 'delivered') {
    text = t('raffle.orgDelivered');
  } else if (status === 'disputed') {
    text = `⚠️ ${t('raffle.orgDisputed')}`;
  } else {
    text = `✓ ${t('raffle.orgReceived')}`;
  }

  return (
    <div className="pt-2 mt-2 border-t border-surface-border/60 space-y-2">
      <p className="text-[11px] text-surface-muted leading-relaxed">{text}</p>
      {buttons.length > 0 && <div className="flex gap-1.5 flex-wrap">{buttons}</div>}
    </div>
  );
}

function GoalProgress({ raffle, onCollaborate }) {
  const { t } = useTranslation();
  const reached = raffle.raised_cents >= raffle.goal_cents;
  const percent = Math.min(100, Math.round((raffle.raised_cents / raffle.goal_cents) * 100));
  return (
    <div className="bg-surface-bg border border-surface-border rounded-xl p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono">
        <span className="text-surface-text">{t('raffle.goalTitle')}</span>
        <span className={reached ? 'text-emerald-400' : 'text-surface-muted'}>
          {formatEurFromCents(raffle.raised_cents)} / {formatEurFromCents(raffle.goal_cents)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-card overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${reached ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[11px] text-surface-muted leading-relaxed">
        {reached ? `🔓 ${t('raffle.goalReached')}` : t('raffle.goalHint')}
      </p>
      {onCollaborate && !raffle.is_drawn && (
        <>
          <button type="button" onClick={onCollaborate} className={PRIMARY_BTN}>🤝 {t('raffle.goalContribute')}</button>
          <p className="text-[10px] text-surface-muted/80 leading-relaxed">{t('raffle.goalDisclaimer')}</p>
        </>
      )}
    </div>
  );
}

export default function RaffleCard({ raffle, onChanged, onDraw, onShare, onRenew, onEndPromo, onLike, onCollaborate }) {
  const { t, lang } = useTranslation();
  const { showToast } = useToast();
  const [busy, setBusy] = useState('');
  const [modal, setModal] = useState(null); // 'rules' | 'enter' | 'verify'

  const isCreator = raffle.is_creator;
  const hasEnded = new Date(raffle.ends_at) <= new Date();
  const isDrawn = raffle.is_drawn;
  const open = !hasEnded && !isDrawn;
  const prizes = raffle.prizes || [];
  const tier = raffleTier(raffle.tier);
  const liked = Boolean(raffle.liked_by_current_user);
  // Sin pagos un sorteo puede no tener promoción (todavía).
  const neverPromoted = raffle.tier === 'light' && !raffle.banner_views_contracted;
  const hasPromo = isCreator && open && (raffle.tier === 'light' || raffle.tier === 'community');

  async function run(key, action) {
    if (busy) return;
    setBusy(key);
    try { await action(); } finally { setBusy(''); }
  }

  // Llamada que cambia el sorteo: avisa y recarga la lista.
  async function call(key, request, message) {
    await run(key, async () => {
      try {
        await request();
        if (message) showToast(message, 'success');
      } catch (e) {
        showToast(e.message || t('raffle.actionError'), 'error');
      }
      await onChanged?.();
    });
  }

  function handlePrizeAction(prize, action) {
    return call(`prize-${prize.id}`, () => api.post(`/community/raffles/prizes/${prize.id}/${action}`, {}), t('raffle.prizeUpdated'));
  }

  async function enter() {
    await call('entry', () => api.post(`/community/raffles/${raffle.id}/entry`, { accept_rules: true }), t('raffle.entered'));
    setModal(null);
  }

  function leave() {
    if (!window.confirm(t('raffle.leaveConfirm'))) return;
    call('entry', () => api.delete(`/community/raffles/${raffle.id}/entry`), t('raffle.left'));
  }

  return (
    <div
      id={`raffle-${raffle.id}`}
      className={`bg-surface-card border ${tier.border} rounded-2xl overflow-hidden transition-shadow`}
    >
      {raffle.image_url && (
        <div className="aspect-[16/9] bg-surface-bg">
          <img src={raffle.image_url} alt={raffle.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">🎁</span>
            <h3 className="font-display font-bold text-surface-text text-sm break-words min-w-0">{raffle.title}</h3>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!isCreator && onLike && (
              <button
                type="button"
                onClick={() => run('like', () => onLike(raffle.id))}
                disabled={busy === 'like'}
                aria-pressed={liked}
                title={liked ? t('communityDetail.raffleLikeRemove') : t('communityDetail.raffleLikeAdd')}
                className={`flex items-center gap-1 px-2 h-8 rounded-lg border text-[11px] font-display font-semibold transition-colors disabled:opacity-50 ${
                  liked
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-surface-border text-surface-muted hover:border-amber-500/30'
                }`}
              >
                {liked ? '♥' : '♡'} {raffle.like_count || 0}
              </button>
            )}
            <button
              type="button"
              onClick={() => run('share', () => onShare(raffle))}
              disabled={busy === 'share'}
              title={t('communityDetail.raffleShare')}
              className="flex-shrink-0 w-8 h-8 rounded-lg border border-surface-border flex items-center justify-center text-surface-muted hover:text-surface-text hover:border-accent-primary/40 transition-colors disabled:opacity-50"
            >
              {busy === 'share' ? '⏳' : '📤'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {PAYMENTS_ENABLED && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20">
              {tier.emoji} {t(`raffle.tier_${raffle.tier}`)}
            </span>
          )}
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {t('raffle.freeEntry')}
          </span>
          {(raffle.categories || []).map(cat => (
            <span key={cat} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-surface-muted border border-surface-border">
              {getCategoryEmoji(cat)} {cat}
            </span>
          ))}
        </div>

        <p className="text-[11px] text-surface-muted/80 italic leading-relaxed">{t(`raffle.rules_${PAYMENTS_ENABLED ? raffle.tier : 'light'}`)}</p>

        {raffle.description && (
          <p className="text-xs text-surface-muted leading-relaxed whitespace-pre-wrap break-words">{raffle.description}</p>
        )}

        {raffle.organizer_name && (
          <p className="text-[11px] text-surface-muted">
            {t('raffle.organizedBy', { name: raffle.organizer_name })}
            {raffle.rules_text && (
              <> · <button type="button" onClick={() => setModal('rules')} className="text-accent-glow underline">{t('raffle.seeRules')}</button></>
            )}
          </p>
        )}

        <div className="flex items-center gap-3 text-[11px] font-mono text-surface-muted flex-wrap">
          <span className={open ? 'text-accent-glow' : isDrawn ? '' : 'text-amber-400'}>{endLabel(raffle, t, lang)}</span>
          <span>·</span>
          <span>{t('raffle.participants', { n: raffle.participant_count ?? 0 })}</span>
        </div>

        {PAYMENTS_ENABLED && raffle.goal_cents > 0 && raffle.raised_cents != null && (
          <GoalProgress raffle={raffle} onCollaborate={open ? onCollaborate : null} />
        )}

        {prizes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-mono text-surface-muted uppercase tracking-wide">
              {prizes.length > 1 ? t('raffle.prizesN', { n: prizes.length }) : t('raffle.prize1')}
            </p>
            {prizes.map(prize => (
              <div key={prize.id} className="bg-surface-bg border border-surface-border rounded-lg p-2">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-md bg-surface-card border border-surface-border overflow-hidden flex-shrink-0 flex items-center justify-center text-lg">
                    {prize.image_url ? <img src={prize.image_url} alt="" className="w-full h-full object-cover" /> : <span>🎁</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[12px] font-display font-semibold text-surface-text truncate">
                        {prizes.length > 1 && <span className="text-surface-muted font-mono mr-1">#{prize.position}</span>}
                        {prize.title}
                      </p>
                      {prize.value_cents != null && (
                        <p className="text-[10px] font-mono text-amber-300/80 whitespace-nowrap">{formatEurFromCents(prize.value_cents)}</p>
                      )}
                    </div>
                    {prize.requires_goal && !isDrawn && (
                      <p className="text-[10px] font-mono text-red-300 mt-0.5">🔒 {t('raffle.extraPrize')}</p>
                    )}
                    {isDrawn && (prize.winner ? (
                      <p className="text-[10px] font-mono text-amber-300 mt-0.5 truncate">🏆 {prize.winner.username}</p>
                    ) : (
                      <p className="text-[10px] font-mono text-surface-muted mt-0.5 italic">
                        {prize.requires_goal ? t('raffle.goalMissed') : t('raffle.unassigned')}
                      </p>
                    ))}
                  </div>
                </div>
                <PrizeDelivery prize={prize} raffle={raffle} onAction={handlePrizeAction} busy={busy === `prize-${prize.id}`} />
              </div>
            ))}
          </div>
        )}

        {/* Sorteos anteriores a la fase 122: un único ganador, sin premios. */}
        {isDrawn && prizes.length === 0 && raffle.winner && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
            <RaffleAvatar user={raffle.winner} />
            <div className="min-w-0">
              <p className="text-[10px] font-mono text-amber-400/80">{t('communityDetail.raffleWinner')}</p>
              <p className="text-sm font-display font-bold text-surface-text truncate">{raffle.winner.username}</p>
            </div>
          </div>
        )}

        {isDrawn && !raffle.winner && (
          <p className="text-[11px] text-surface-muted italic">{t('raffle.noWinners')}</p>
        )}
        {isDrawn && raffle.draw_seed && raffle.winner && prizes.length > 0 && (
          <button type="button" onClick={() => setModal('verify')} className={PLAIN_BTN}>🔍 {t('raffle.verifyBtn')}</button>
        )}

        {isCreator && hasEnded && !isDrawn && (
          <button
            type="button"
            onClick={() => run('draw', () => onDraw(raffle.id))}
            disabled={busy === 'draw'}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-xs transition-all disabled:opacity-50"
          >
            {busy === 'draw' ? t('raffle.drawing') : `🎉 ${t('raffle.drawBtn')}`}
          </button>
        )}
        {!isCreator && hasEnded && !isDrawn && (
          <p className="text-[11px] text-surface-muted italic">{t('raffle.drawingSoon')}</p>
        )}

        {open && isCreator && (
          <p className="text-[11px] text-surface-muted italic">{t('raffle.creatorHint')}</p>
        )}
        {open && !isCreator && (
          !raffle.can_participate ? (
            <p className="text-[11px] text-surface-muted italic">{t('raffle.notEligible')}</p>
          ) : !raffle.requires_entry ? (
            <p className="text-[11px] text-emerald-400">✓ {t('raffle.autoEntered')}</p>
          ) : raffle.entered ? (
            <div className="flex items-center justify-between gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
              <p className="text-xs text-emerald-400">✓ {t('raffle.youAreIn')}</p>
              <button type="button" onClick={leave} disabled={busy === 'entry'} className="text-[11px] text-surface-muted underline disabled:opacity-50">
                {t('raffle.leaveBtn')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setModal('enter')}
              disabled={busy === 'entry'}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-xs transition-all disabled:opacity-50"
            >
              🎟️ {t('raffle.enterBtn')}
            </button>
          )
        )}

        {isCreator && open && !neverPromoted && (
          <p className="text-[11px] text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-1.5">
            📣 {t('raffle.bannersShown', {
              n: Number(raffle.banner_views_sent || 0).toLocaleString(localeTag(lang))
                + (raffle.banner_views_contracted ? ` / ${Number(raffle.banner_views_contracted).toLocaleString(localeTag(lang))}` : ''),
            })}
          </p>
        )}
        {hasPromo && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => run('renew', () => onRenew(raffle))} disabled={Boolean(busy)} className={`${SMALL_BTN} border-accent-primary/30 bg-accent-primary/10 text-accent-glow hover:bg-accent-primary/20`}>
              {neverPromoted
                ? `🚀 ${t('free.promoteTitle')}`
                : `🔄 ${raffle.tier === 'community' ? t('raffle.notifyAgain') : t('raffle.renewPromo')}`}
            </button>
            {!raffle.promo_ended_at && (
              <button
                type="button"
                disabled={Boolean(busy)}
                className={DANGER_BTN}
                onClick={() => {
                  if (window.confirm(t(raffle.tier === 'light' ? 'raffle.endPromoConfirmLight' : 'raffle.endPromoConfirm'))) {
                    run('end', () => onEndPromo(raffle));
                  }
                }}
              >
                ⏹ {t('raffle.endPromo')}
              </button>
            )}
          </div>
        )}
        {hasPromo && raffle.promo_ended_at && !neverPromoted && (
          <p className="text-[11px] text-red-300/80 leading-relaxed">{t('raffle.promoEndedNote')}</p>
        )}
      </div>

      {modal === 'rules' && <RaffleRulesModal raffle={raffle} onClose={() => setModal(null)} />}
      {modal === 'enter' && <RaffleRulesModal raffle={raffle} onClose={() => setModal(null)} onAccept={enter} />}
      {modal === 'verify' && <RaffleVerifyModal raffle={raffle} onClose={() => setModal(null)} />}
    </div>
  );
}
