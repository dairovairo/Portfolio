import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useTranslation } from '../i18n';
import {
  startPurchase, getStorePrices, recoverPendingPlayPurchases, handleStripeReturn,
  manageSubscriptions, formatEuros,
} from '../lib/billing';
import { isNativeApp } from '../lib/nativePush';

// Cuenta de Stripe del creador: las aportaciones de los miembros van directas
// a ella, SocialBattery no las toca (server/lib/connect.js).
function ConnectSection({ isEnterprise }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/payments/connect/status')
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function start() {
    setStarting(true);
    setError('');
    try {
      const { url } = await api.post('/payments/connect/start', {});
      window.location.assign(url);
    } catch (e) {
      setError(e.message);
      setStarting(false);
    }
  }

  if (!status?.available || (!isEnterprise && !status.connected)) return null;

  return (
    <section className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-2">
      <h2 className="font-display font-bold text-surface-text text-base">🤝 {t('wallet.connectTitle')}</h2>
      <p className="text-xs text-surface-muted leading-relaxed">{t('wallet.connectExplain')}</p>
      {status.charges_enabled ? (
        <p className="text-sm text-emerald-300">✓ {t('wallet.connectReady')}</p>
      ) : isEnterprise ? (
        <>
          {status.connected && <p className="text-xs text-amber-300">{t('wallet.connectPending')}</p>}
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50"
          >
            {starting ? '…' : t(status.connected ? 'wallet.connectContinue' : 'wallet.connectStart')}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => navigate('/shop')} className="text-xs text-accent-glow underline">{t('raffle.goShop')}</button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}

// Monedero prepago de publicidad: recargas, reservas de campañas en curso
// e historial. Ver server/routes/payments.js y la migración phase134.
export default function WalletPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t, lang } = useTranslation();

  const [me, setMe] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [storePrices, setStorePrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'error', text }

  const load = useCallback(async () => {
    try {
      const [meRes, catRes] = await Promise.all([api.get('/payments/me'), api.get('/payments/catalog')]);
      setMe(meRes);
      setCatalog(catRes);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || t('wallet.loadError') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      const ret = await handleStripeReturn();
      if (ret === 'success') setNotice({ kind: 'ok', text: t('wallet.paymentOk') });
      else if (ret === 'cancel') setNotice({ kind: 'error', text: t('wallet.paymentCancelled') });
      const recovered = await recoverPendingPlayPurchases();
      if (recovered > 0) setNotice({ kind: 'ok', text: t('wallet.paymentOk') });
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!catalog) return;
    getStorePrices(catalog.wallet_packs.map(p => p.id)).then(setStorePrices);
  }, [catalog]);

  async function handleBuy(pack) {
    setBuying(pack.id);
    setNotice(null);
    try {
      await startPurchase(pack.id, { userId: profile?.id, returnPath: '/wallet' });
      setNotice({ kind: 'ok', text: t('wallet.paymentOk') });
      await load();
    } catch (err) {
      const msg = String(err?.message || '');
      // Cancelar en la hoja de Google Play no es un error.
      if (!/cancel/i.test(msg)) setNotice({ kind: 'error', text: msg || t('wallet.paymentError') });
    } finally {
      setBuying(null);
    }
  }

  const native = isNativeApp();
  const providerReady = catalog && (native ? catalog.providers?.google_play : catalog.providers?.stripe);
  const activeSubs = (me?.subscriptions || []).filter(s => s.active);

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg" aria-label={t('wallet.back')}>
            ←
          </button>
          <h1 className="flex-1 font-display font-bold text-surface-text">{t('wallet.title')}</h1>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {notice && (
          <div className={`rounded-xl border px-3 py-2 text-sm ${notice.kind === 'ok'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
            {notice.text}
          </div>
        )}

        {/* Saldo */}
        <section className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <div className="text-xs text-surface-muted">{t('wallet.available')}</div>
          <div className="font-mono font-bold text-accent-glow text-3xl mt-1">
            {loading ? '…' : formatEuros(me?.balance_cents, lang)}
          </div>
          {me?.held_cents > 0 && (
            <div className="text-xs text-surface-muted mt-2">
              {t('wallet.reserved', { amount: formatEuros(me.held_cents, lang), n: me.holds.length })}
            </div>
          )}
          <p className="text-[11px] text-surface-muted/80 mt-3 leading-relaxed">{t('wallet.howItWorks')}</p>
        </section>

        {/* Recargar */}
        <section>
          <h2 className="font-display font-bold text-surface-text text-base mb-1">{t('wallet.topUp')}</h2>
          <p className="text-xs text-surface-muted mb-3">{native ? t('wallet.viaPlay') : t('wallet.viaCard')}</p>
          {catalog && !providerReady && (
            <p className="text-xs text-amber-300 mb-3">{t('wallet.notAvailableYet')}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {(catalog?.wallet_packs || []).map(pack => (
              <button
                key={pack.id}
                disabled={!providerReady || buying !== null}
                onClick={() => handleBuy(pack)}
                className="rounded-2xl border border-surface-border bg-surface-card hover:border-accent-primary/40 p-4 text-center transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="font-display font-bold text-surface-text text-lg">{formatEuros(pack.amountCents, lang)}</div>
                <div className="text-[11px] text-surface-muted mt-0.5">
                  {buying === pack.id ? t('wallet.processing') : (storePrices[pack.id] ? t('wallet.payPrice', { price: storePrices[pack.id] }) : t('wallet.credit'))}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Campañas con saldo reservado */}
        {me?.holds?.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-surface-text text-base mb-2">{t('wallet.activeCampaigns')}</h2>
            <ul className="space-y-2">
              {me.holds.map(h => (
                <li key={h.id} className="flex items-center justify-between bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm">
                  <span className="text-surface-text">
                    {h.kind === 'event' ? t('wallet.holdEvent', { plan: h.plan }) : t('wallet.holdRaffle')}
                    <span className="text-surface-muted"> · {t('wallet.units', { n: h.units_contracted })}</span>
                  </span>
                  <span className="font-mono text-surface-muted">{formatEuros(h.amount_cents, lang)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {me?.payments_enabled && <ConnectSection isEnterprise={Boolean(me.is_enterprise)} />}

        {/* Suscripciones */}
        {activeSubs.length > 0 && (
          <section className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-2">
            <h2 className="font-display font-bold text-surface-text text-base">{t('wallet.subscriptions')}</h2>
            {activeSubs.map(s => (
              <div key={s.id} className="text-sm text-surface-text flex justify-between">
                <span>{s.product_id === 'sub_volt' ? t('shop.subVoltName') : t('shop.subEnterpriseName')}</span>
                <span className="text-surface-muted text-xs">
                  {s.current_period_end ? t(s.auto_renew ? 'wallet.renewsOn' : 'wallet.endsOn', { date: new Date(s.current_period_end).toLocaleDateString() }) : ''}
                </span>
              </div>
            ))}
            <button onClick={() => manageSubscriptions().catch(err => setNotice({ kind: 'error', text: err.message }))}
              className="text-xs text-accent-glow underline">
              {t('wallet.manageSubs')}
            </button>
          </section>
        )}

        {/* Movimientos */}
        <section>
          <h2 className="font-display font-bold text-surface-text text-base mb-2">{t('wallet.history')}</h2>
          {!loading && !(me?.transactions?.length) && (
            <p className="text-xs text-surface-muted">{t('wallet.noHistory')}</p>
          )}
          <ul className="divide-y divide-surface-border">
            {(me?.transactions || []).map(tx => (
              <li key={tx.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-surface-text truncate">{t(`wallet.tx_${tx.type}`)}</div>
                  {tx.type !== 'topup' && <div className="text-[11px] text-surface-muted truncate">{tx.description}</div>}
                  <div className="text-[10px] text-surface-muted/70">{new Date(tx.created_at).toLocaleString()}</div>
                </div>
                <span className={`font-mono flex-shrink-0 ${tx.amount_cents >= 0 ? 'text-emerald-400' : 'text-surface-muted'}`}>
                  {tx.amount_cents >= 0 ? '+' : ''}{formatEuros(tx.amount_cents, lang)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-[10px] text-surface-muted/60 text-center leading-relaxed">{t('wallet.legal')}</p>
      </main>
      <BottomNav />
    </div>
  );
}
