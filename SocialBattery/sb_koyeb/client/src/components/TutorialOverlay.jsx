import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useTutorial } from '../context/TutorialContext';

// ── Definición de los 5 pasos ─────────────────────────────────────────────────
//
//  page:       ruta en la que este paso debe mostrarse (null = cualquiera / HomePage)
//  highlight:  id del elemento DOM a resaltar (null = sin resaltado)
//  navigateTo: ruta a la que navegar al pulsar el CTA de ESTE paso
//              (null = avanzar sin navegar)
//
const STEPS = [
  {
    mascot:     '/mascot-high.png',
    title:      'Bienvenido a SocialBattery',
    body:       '¡Hola! Soy tu compañera de energía. Aquí podrás compartir cómo te sientes socialmente cada día y conectar con quienes tienen la misma actitud que tú. 🔋',
    cta:        '¡Vamos! ⚡',
    page:       '/',
    highlight:  null,
    navigateTo: null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Tu batería social',
    body:       '¡Actualiza tu batería social para que la vean todos tus amigos! 🔋✨',
    cta:        'Entendido',
    page:       '/',
    highlight:  'tutorial-battery-bar',
    navigateTo: null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Tu círculo social',
    body:       '¡Invita a tus amigos para crear tu círculo social! 👥🌟',
    cta:        'Siguiente',
    page:       '/',
    highlight:  'tutorial-social-panels',
    navigateTo: '/pools',
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Quedadas',
    body:       '¡Puedes organizar quedadas con tus amigos! 🤝📅',
    cta:        'Siguiente',
    page:       '/pools',
    highlight:  null,
    navigateTo: '/messages/inbox',
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Mensajes',
    body:       '¡Comunícate con tus amigos cuando quieras! 💬⚡',
    cta:        '¡Empezar!',
    page:       '/messages/inbox',
    highlight:  null,
    navigateTo: '/',
  },
];

const TOTAL = STEPS.length;

// ── Componente ────────────────────────────────────────────────────────────────
// Recibe `currentPage` (la ruta actual) para saber si tiene que mostrarse.
export default function TutorialOverlay({ currentPage }) {
  const { isLight } = useTheme();
  const { active, step, advance, dismiss } = useTutorial();
  const navigate   = useNavigate();
  const animKeyRef = useRef(0);
  const prevHighlightRef = useRef(null);

  const current = STEPS[step] ?? STEPS[TOTAL - 1];

  // ── Gestión del resaltado DOM ────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;

    // Quitar resaltado anterior
    if (prevHighlightRef.current) {
      const el = document.getElementById(prevHighlightRef.current);
      if (el) el.classList.remove('tutorial-highlight');
    }

    // Añadir resaltado si el paso actual lo pide Y estamos en la página correcta
    if (current.highlight && current.page === currentPage) {
      const el = document.getElementById(current.highlight);
      if (el) {
        el.classList.add('tutorial-highlight');
        prevHighlightRef.current = current.highlight;
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
      }
    } else {
      prevHighlightRef.current = null;
    }
  }, [active, step, currentPage, current.highlight, current.page]);

  // ── Limpieza al cerrar ───────────────────────────────────────────────────
  useEffect(() => {
    if (!active) {
      STEPS.forEach(s => {
        if (s.highlight) {
          const el = document.getElementById(s.highlight);
          if (el) el.classList.remove('tutorial-highlight');
        }
      });
      prevHighlightRef.current = null;
    }
  }, [active]);

  // No mostrar si el tutorial no está activo o si este paso no corresponde a la página actual
  if (!active || current.page !== currentPage) return null;

  function handleAdvance() {
    if (current.navigateTo) {
      // Primero avanzamos el step, luego navegamos
      advance();
      navigate(current.navigateTo);
    } else if (step < TOTAL - 1) {
      advance();
    } else {
      dismiss();
    }
  }

  return (
    <>
      {/* Fondo oscuro */}
      <div
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
        onClick={dismiss}
      />

      {/* Panel anclado abajo */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center pb-28 sm:pb-8 px-4 pointer-events-none">
        <div
          className="relative w-full max-w-sm animate-slide-up pointer-events-auto"
          style={{ animationDuration: '0.35s' }}
        >
          {/* Mascota */}
          <div className="flex justify-center mb-[-20px] relative z-10 pointer-events-none select-none">
            <img
              key={`mascot-${step}`}
              src={current.mascot}
              alt="Mascota SocialBattery"
              className="w-36 h-36 object-contain"
              draggable={false}
              style={{
                animation: 'mascotFadeIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                filter: isLight
                  ? 'drop-shadow(0 0 22px rgba(0,148,158,0.45))'
                  : 'drop-shadow(0 0 26px rgba(45,212,220,0.55))',
              }}
            />
          </div>

          {/* Tarjeta */}
          <div className="bg-surface-card border border-surface-border rounded-3xl px-6 pt-8 pb-6 shadow-2xl">

            {/* Puntos de progreso */}
            <div className="flex justify-center items-center gap-1.5 mb-5">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all duration-300"
                  style={{
                    width: i === step ? 20 : 7,
                    height: 7,
                    background: i <= step ? 'var(--sb-accent)' : 'var(--sb-border)',
                    opacity: i < step ? 0.55 : 1,
                  }}
                />
              ))}
            </div>

            {/* Texto */}
            <div
              key={`content-${step}`}
              className="text-center mb-6"
              style={{ animation: 'slideUp 0.28s ease-out both' }}
            >
              <h2 className="font-display text-xl font-bold text-surface-text mb-2 leading-snug">
                {current.title}
              </h2>
              <p className="text-surface-muted text-sm leading-relaxed">
                {current.body}
              </p>
            </div>

            {/* Botones */}
            <div className="flex gap-2">
              <button
                onClick={dismiss}
                className="py-3 px-4 rounded-xl border border-surface-border text-surface-muted text-sm font-display font-semibold
                  hover:text-surface-text hover:border-surface-muted transition-all"
              >
                Saltar
              </button>
              <button
                onClick={handleAdvance}
                className="flex-1 py-3 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display
                  font-semibold transition-all hover:shadow-lg hover:shadow-accent-primary/20"
              >
                {current.cta}
              </button>
            </div>

            {/* Contador */}
            <p className="text-center text-xs text-surface-muted/50 mt-3 font-mono">
              {step + 1} / {TOTAL}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
