import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useTutorial } from '../context/TutorialContext';

// ── Definición de los 7 pasos ─────────────────────────────────────────────────
//
//  page:       ruta en la que este paso debe mostrarse
//  highlight:  id del elemento DOM a resaltar (null = sin resaltado)
//  navigateTo: ruta a la que navegar al pulsar el CTA de ESTE paso
//              (null = avanzar sin navegar)
//  switchTab:  nombre del tab a activar al llegar a este paso dentro de /community
//
const STEPS = [
  {
    mascot:     '/mascot-high.png',
    title:      'Bienvenido a SocialBattery',
    body:       '\u00a1Hola! Soy tu compa\u00f1era de energ\u00eda. Aqu\u00ed podr\u00e1s compartir c\u00f3mo te sientes socialmente cada d\u00eda y conectar con quienes tienen la misma actitud que t\u00fa. \ud83d\udd0b',
    cta:        '\u00a1Vamos! \u26a1',
    page:       '/',
    highlight:  null,
    navigateTo: null,
    switchTab:  null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Tu bater\u00eda social',
    body:       '\u00a1Actualiza tu bater\u00eda social para que la vean todos tus amigos! \ud83d\udd0b\u2728',
    cta:        'Entendido',
    page:       '/',
    highlight:  'tutorial-battery-bar',
    navigateTo: null,
    switchTab:  null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Tu c\u00edrculo social',
    body:       '\u00a1Invita a tus amigos para crear tu c\u00edrculo social! \ud83d\udc65\ud83c\udf1f',
    cta:        'Siguiente',
    page:       '/',
    highlight:  'tutorial-social-panels',
    navigateTo: '/pools',
    switchTab:  null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Quedadas',
    body:       '\u00a1Puedes organizar quedadas con tus amigos! \ud83e\udd1d\ud83d\udcc5',
    cta:        'Siguiente',
    page:       '/pools',
    highlight:  null,
    navigateTo: '/messages/inbox',
    switchTab:  null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Mensajes',
    body:       '\u00a1Comun\u00edcate con tus amigos cuando quieras! \ud83d\udcac\u26a1',
    cta:        'Siguiente',
    page:       '/messages/inbox',
    highlight:  null,
    navigateTo: '/community',
    switchTab:  null,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Eventos',
    body:       '\u00a1En el men\u00fa comunidad puedes ver los eventos disponibles y a\u00f1adirlos a tu planificaci\u00f3n! \ud83c\udf10\ud83d\udcc5',
    cta:        'Siguiente',
    page:       '/community',
    highlight:  'tutorial-events-section',
    navigateTo: null,
    switchTab:  'events',
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Comunidades',
    body:       '\u00a1Adem\u00e1s puedes unirte a comunidades seg\u00fan tus gustos! \ud83d\udc65\u2728',
    cta:        '\u00a1Empezar!',
    page:       '/community',
    highlight:  'tutorial-communities-section',
    navigateTo: '/',
    switchTab:  'communities',
  },
];

const TOTAL = STEPS.length;

// ── Componente ────────────────────────────────────────────────────────────────
// Props:
//   currentPage  — ruta actual (p.ej. "/community")
//   onSwitchTab  — callback(tabName) para que CommunityPage cambie su tab activo
export default function TutorialOverlay({ currentPage, onSwitchTab }) {
  const { isLight } = useTheme();
  const { active, step, advance, dismiss } = useTutorial();
  const navigate = useNavigate();
  const prevHighlightRef = useRef(null);

  const current = STEPS[step] ?? STEPS[TOTAL - 1];

  // ── Activar tab cuando el paso lo requiere ───────────────────────────────
  useEffect(() => {
    if (!active) return;
    if (current.page !== currentPage) return;
    if (current.switchTab && onSwitchTab) {
      onSwitchTab(current.switchTab);
    }
  }, [active, step, currentPage, current.page, current.switchTab, onSwitchTab]);

  // ── Gestión del resaltado DOM ────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;

    // Quitar resaltado anterior
    if (prevHighlightRef.current) {
      const el = document.getElementById(prevHighlightRef.current);
      if (el) el.classList.remove('tutorial-highlight');
    }

    if (current.highlight && current.page === currentPage) {
      // Pequeño delay para que el tab haya renderizado el contenido
      const t = setTimeout(() => {
        const el = document.getElementById(current.highlight);
        if (el) {
          el.classList.add('tutorial-highlight');
          prevHighlightRef.current = current.highlight;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 120);
      return () => clearTimeout(t);
    } else {
      prevHighlightRef.current = null;
    }
  }, [active, step, currentPage, current.highlight, current.page]);

  // ── Limpiar resaltados al cerrar ─────────────────────────────────────────
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

  // Solo renderizar si el tutorial está activo y estamos en la página correcta
  if (!active || current.page !== currentPage) return null;

  function handleAdvance() {
    if (current.navigateTo) {
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
