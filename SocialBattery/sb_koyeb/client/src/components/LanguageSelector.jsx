// ─────────────────────────────────────────────────────────────────────────────
// LanguageSelector — dos variantes:
//
//   • variant="compact"  — chip pequeño (Español ▾) para superponer en la
//     esquina superior de AuthPage / OnboardingPage, sin ocupar layout.
//   • variant="panel"    — fila de tarjetas grande, para usarse dentro de
//     un apartado de Ajustes (mismo lenguaje visual que el selector de
//     temas de SettingsPage).
//
// Ambas variantes trabajan contra el mismo `useTranslation()` — el cambio
// es inmediato en todo el árbol. El PATCH al servidor lo dispara el
// consumidor (`onChange` prop opcional) para no acoplar este componente a
// la capa de red.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useTranslation, LANGUAGE_LABELS } from '../i18n';

export default function LanguageSelector({ variant = 'panel', onChange, className = '' }) {
  const { lang, setLang, availableLangs, t } = useTranslation();

  function handlePick(next) {
    if (next === lang) return;
    setLang(next);
    // El PATCH lo hace el consumidor (Ajustes lo hace, la esquina superior
    // en Auth/Onboarding no — aún no hay sesión). Se pasa el nuevo idioma
    // para que el consumidor no dependa de leer el contexto justo después.
    onChange?.(next);
  }

  if (variant === 'compact') {
    return <CompactSelector lang={lang} langs={availableLangs} onPick={handlePick} className={className} label={t('languages.label')} />;
  }
  return <PanelSelector lang={lang} langs={availableLangs} onPick={handlePick} className={className} />;
}

// ── Compact (chip + menú) ────────────────────────────────────────────────────

function CompactSelector({ lang, langs, onPick, className, label }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Cerrar al hacer clic fuera. Es un menú superpuesto, tiene que respetar
  // el gesto natural de "toco fuera para cerrar" — mismo patrón que el
  // menú de foto en PhotoSourceMenu.jsx.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card/80
          backdrop-blur px-3 py-1.5 text-xs font-display font-semibold text-surface-text
          hover:border-surface-muted transition-colors"
      >
        <span aria-hidden="true">🌐</span>
        <span>{LANGUAGE_LABELS[lang]}</span>
        <span className={`text-surface-muted text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-1.5 min-w-[10rem] rounded-2xl border border-surface-border
            bg-surface-card shadow-2xl overflow-hidden animate-slide-down z-50"
        >
          {langs.map(code => {
            const active = code === lang;
            return (
              <li key={code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { onPick(code); setOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm font-display transition-colors flex items-center justify-between
                    ${active
                      ? 'bg-accent-primary/15 text-accent-glow font-semibold'
                      : 'text-surface-text hover:bg-surface-bg'}`}
                >
                  <span>{LANGUAGE_LABELS[code]}</span>
                  {active && <span className="text-accent-primary text-xs">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Panel (tarjetas grandes) ────────────────────────────────────────────────

function PanelSelector({ lang, langs, onPick, className }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${className}`}>
      {langs.map(code => {
        const active = code === lang;
        return (
          <button
            key={code}
            type="button"
            onClick={() => onPick(code)}
            aria-pressed={active}
            className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 transition-all text-left
              ${active
                ? 'border-accent-primary bg-accent-primary/10 shadow-sm shadow-accent-primary/20'
                : 'border-surface-border bg-surface-bg hover:border-surface-muted'}`}
          >
            <span className="text-xl" aria-hidden="true">🌐</span>
            <span className={`flex-1 font-display font-semibold text-sm ${active ? 'text-accent-glow' : 'text-surface-text'}`}>
              {LANGUAGE_LABELS[code]}
            </span>
            {active && <span className="text-accent-primary text-sm font-mono">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
