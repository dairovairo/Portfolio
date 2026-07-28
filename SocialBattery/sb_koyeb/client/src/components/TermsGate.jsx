import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTranslation } from '../i18n';

// Gate legal — obligatorio cuando terms_accepted_at es null en la BD.
// Ver comentario largo en la versión anterior (phase 130).
export default function TermsGate() {
  const { acceptTerms, signOut } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (!accepted || submitting) return;
    setSubmitting(true);
    try {
      await acceptTerms();
    } catch (err) {
      showToast(err?.message || t('termsGate.submitError'));
      setSubmitting(false);
    }
  }

  // Reconstruimos el texto del checkbox insertando los tres tramos
  // dinámicos ({age} en <strong>, {terms}/{privacy} como <Link>). Cada
  // idioma controla el orden y la puntuación de esos tres huecos vía
  // t('termsGate.checkboxTemplate'). El truco del split-por-marcador es
  // el mismo que usamos en AuthPage/OnboardingPage con \u0000.
  const template = t('termsGate.checkboxTemplate');
  const AGE = '\u0000AGE\u0000';
  const TERMS = '\u0000TERMS\u0000';
  const PRIVACY = '\u0000PRIVACY\u0000';
  const filled = template
    .replace('{age}', AGE)
    .replace('{terms}', TERMS)
    .replace('{privacy}', PRIVACY);

  // Reemplazamos secuencialmente para respetar el orden que dicte cada idioma.
  const parts = [];
  let remaining = filled;
  while (remaining.length > 0) {
    const idxs = [AGE, TERMS, PRIVACY]
      .map(marker => ({ marker, idx: remaining.indexOf(marker) }))
      .filter(({ idx }) => idx >= 0)
      .sort((a, b) => a.idx - b.idx);
    if (idxs.length === 0) { parts.push({ type: 'text', value: remaining }); break; }
    const first = idxs[0];
    if (first.idx > 0) parts.push({ type: 'text', value: remaining.slice(0, first.idx) });
    parts.push({ type: 'marker', value: first.marker });
    remaining = remaining.slice(first.idx + first.marker.length);
  }

  return (
    <div className="min-h-screen bg-surface-bg text-surface-text flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full">
        <img src="/logo-icon.png" alt="SocialBattery" className="h-10 w-auto mx-auto mb-6" />

        <h1 className="font-display text-2xl font-bold text-center mb-2">{t('termsGate.title')}</h1>
        <p className="text-sm text-surface-muted text-center mb-8 leading-relaxed">
          {t('termsGate.subtitle')}
        </p>

        <label className="flex items-start gap-3 bg-surface-card border border-surface-border rounded-2xl p-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-surface-border bg-surface-bg
              text-accent-primary focus:ring-accent-primary/40 focus:ring-offset-0 shrink-0"
          />
          <span className="text-sm text-surface-text leading-relaxed">
            {parts.map((p, i) => {
              if (p.type === 'text') return <span key={i}>{p.value}</span>;
              if (p.value === AGE)   return <strong key={i}>{t('termsGate.checkboxAge')}</strong>;
              if (p.value === TERMS) return (
                <Link key={i} to="/terminos" target="_blank" className="text-accent-glow underline underline-offset-2">
                  {t('termsGate.checkboxTerms')}
                </Link>
              );
              if (p.value === PRIVACY) return (
                <Link key={i} to="/privacidad" target="_blank" className="text-accent-glow underline underline-offset-2">
                  {t('termsGate.checkboxPrivacy')}
                </Link>
              );
              return null;
            })}
          </span>
        </label>

        <button
          onClick={handleContinue}
          disabled={!accepted || submitting}
          className="mt-4 w-full bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-40
            disabled:cursor-not-allowed text-surface-text font-display font-semibold py-3 rounded-xl
            transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/20"
        >
          {submitting ? t('termsGate.continuing') : t('termsGate.continueBtn')}
        </button>

        <button
          onClick={signOut}
          disabled={submitting}
          className="mt-3 w-full text-surface-muted hover:text-surface-text text-sm font-display
            font-semibold py-2 transition-colors disabled:opacity-50"
        >
          {t('termsGate.signOutBtn')}
        </button>
      </div>
    </div>
  );
}
