import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { verifyRaffle } from '../lib/raffleVerify';
import { useTranslation } from '../i18n';

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 mb-3 flex-shrink-0">
          <h2 className="font-display font-bold text-surface-text text-base">{title}</h2>
          <button type="button" onClick={onClose} aria-label="✕" className="w-8 h-8 rounded-lg border border-surface-border text-surface-muted">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Bases del sorteo. Con onAccept, además pide aceptarlas para participar.
export function RaffleRulesModal({ raffle, onClose, onAccept }) {
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);

  async function accept() {
    setSending(true);
    try { await onAccept(); } finally { setSending(false); }
  }

  return (
    <Sheet title={t('raffle.rulesTitle')} onClose={onClose}>
      <div className="overflow-y-auto flex-1 min-h-0 bg-surface-bg border border-surface-border rounded-xl p-3">
        <p className="text-xs text-surface-muted leading-relaxed whitespace-pre-wrap break-words">{raffle.rules_text}</p>
      </div>
      {onAccept && (
        <div className="flex-shrink-0 pt-3 space-y-3">
          <label className="flex items-start gap-2.5 text-xs text-surface-text leading-relaxed cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-amber-500 flex-shrink-0"
            />
            <span>{t('raffle.acceptRules')}</span>
          </label>
          <button
            type="button"
            onClick={accept}
            disabled={!accepted || sending}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-sm transition-all disabled:opacity-50"
          >
            {sending ? '…' : t('raffle.enterBtn')}
          </button>
        </div>
      )}
    </Sheet>
  );
}

// Repite el sorteo en el dispositivo con los datos públicos.
export function RaffleVerifyModal({ raffle, onClose }) {
  const { t } = useTranslation();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/community/raffles/${raffle.id}/verification`);
        const result = await verifyRaffle(raffle, data);
        const mine = data.entries.find(e => e.key === data.my_key);
        if (!cancelled) setState({ ...result, data, mine });
      } catch (e) {
        if (!cancelled) setError(e.message || t('raffle.verifyError'));
      }
    })();
    return () => { cancelled = true; };
  }, [raffle, t]);

  return (
    <Sheet title={t('raffle.verifyTitle')} onClose={onClose}>
      <div className="overflow-y-auto min-h-0 space-y-3 text-xs text-surface-muted leading-relaxed">
        <p>{t('raffle.verifyExplain')}</p>
        {error && <p className="text-red-400">{error}</p>}
        {!error && !state && <p>…</p>}
        {state && (
          <>
            <p className={state.seedOk ? 'text-emerald-400' : 'text-red-400'}>
              {state.seedOk ? `✓ ${t('raffle.verifySeedOk')}` : `✕ ${t('raffle.verifySeedBad')}`}
            </p>
            <p>{t('raffle.verifyParticipants', { n: state.participants })}{state.mine ? ` · ${t('raffle.verifyMine', { n: state.mine.tickets })}` : ''}</p>
            <ul className="space-y-1.5">
              {state.prizes.map(p => (
                <li key={p.id} className="bg-surface-bg border border-surface-border rounded-lg px-3 py-2">
                  <span className="text-surface-text">{p.title}</span>
                  {' · '}{p.winner?.username || t('raffle.unassigned')}
                  <span className={`block ${p.matches ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {p.matches ? `✓ ${t('raffle.verifyMatch')}` : t('raffle.verifyNoMatch')}
                  </span>
                </li>
              ))}
            </ul>
            <details className="bg-surface-bg border border-surface-border rounded-lg px-3 py-2">
              <summary className="cursor-pointer">{t('raffle.verifyData')}</summary>
              <div className="mt-2 space-y-2 font-mono text-[10px] break-all">
                <p>commit: {state.data.commit}</p>
                <p>seed: {state.data.seed}</p>
                <p>my_key: {state.data.my_key}</p>
                <ul>{state.data.entries.map(e => <li key={e.key}>{e.key} × {e.tickets}</li>)}</ul>
              </div>
            </details>
          </>
        )}
      </div>
    </Sheet>
  );
}
