import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatEuros } from '../lib/billing';
import { PAYMENTS_ENABLED } from '../lib/features';
import { useTranslation } from '../i18n';

// Saldo publicitario en línea para las pantallas de contratar campaña
// (EventAdConfigPage / RaffleAdAudiencePage). Si los pagos no están activos
// en el servidor (PAYMENTS_ENABLED) no pinta nada: las campañas siguen
// siendo gratis como antes.
export default function WalletInline({ neededCents = 0, warn = true, forceInsufficient = false }) {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!PAYMENTS_ENABLED) return undefined;
    let cancelled = false;
    api.get('/payments/me')
      .then(me => { if (!cancelled) setState(me); })
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, []);

  if (!state?.payments_enabled) return null;

  const balance = Number(state.balance_cents || 0);
  const short = forceInsufficient || (warn && neededCents > balance);

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs flex items-center justify-between gap-3 ${short
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : 'border-surface-border bg-surface-card text-surface-muted'}`}>
      <span>
        {short ? `${t('wallet.insufficient')} ` : ''}
        {t('wallet.balanceShort', { amount: formatEuros(balance, lang) })}
      </span>
      <button
        type="button"
        onClick={() => navigate('/wallet')}
        className="flex-shrink-0 font-display font-semibold text-accent-glow underline"
      >
        {t('wallet.goTopUp')}
      </button>
    </div>
  );
}
