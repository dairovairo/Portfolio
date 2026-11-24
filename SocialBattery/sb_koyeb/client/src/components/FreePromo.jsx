import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { localeTag } from '../lib/raffleTiers';
import { useTranslation } from '../i18n';

// Promoción gratis: lo que le queda a la cuenta. `status` es el free_promo que
// manda el servidor (null si los pagos están encendidos).
export function FreePromoNote({ status }) {
  const { t, lang } = useTranslation();
  if (!status) return null;
  const text = status.blocked === 'month'
    ? t('free.blockedMonth', { n: status.max_per_month, date: new Date(status.next_at).toLocaleDateString(localeTag(lang), { day: 'numeric', month: 'long' }) })
    : status.blocked === 'active'
      ? t('free.blockedActive', { n: status.max_active })
      : t('free.quota', { left: status.remaining, total: status.max_per_month, units: status.max_units });
  return (
    <p className={`text-xs leading-relaxed rounded-xl border px-3 py-2 ${status.blocked
      ? 'text-amber-200 bg-amber-500/10 border-amber-500/30'
      : 'text-surface-muted bg-surface-card border-surface-border'}`}
    >
      {status.blocked ? '⏳' : '🎁'} {text}
    </p>
  );
}

// "¿Promocionar?" de los formularios de crear evento y sorteo. La cantidad y
// el público se eligen en el paso siguiente.
export default function FreePromoToggle({ hint, checked, onChange }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/community/promo-quota')
      .then(res => { if (!cancelled) setStatus(res.free_promo); })
      .catch(() => {}); // el servidor lo comprueba igualmente al publicar
    return () => { cancelled = true; };
  }, []);

  const blocked = Boolean(status?.blocked);
  return (
    <div className="space-y-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={blocked}
        onClick={() => onChange(!checked)}
        className={`w-full flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all disabled:opacity-50 ${
          checked ? 'border-accent-primary bg-accent-primary/15' : 'border-surface-border bg-surface-bg'
        }`}
      >
        <span className="text-xl">🚀</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-display font-bold text-surface-text">{t('free.promoteTitle')}</span>
          <span className="block text-[11px] text-surface-muted leading-relaxed mt-0.5">{hint}</span>
        </span>
        <span className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${checked ? 'bg-accent-primary' : 'bg-surface-card border border-surface-border'}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </span>
      </button>
      <FreePromoNote status={status} />
    </div>
  );
}
