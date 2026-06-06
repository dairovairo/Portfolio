import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

// ── Clave de localStorage: incrementar versión si se resetea el tutorial ──────
const TUTORIAL_KEY = 'sb_tutorial_done_v1';

// ── Configuración de pasos ────────────────────────────────────────────────────
const STEPS = [
  {
    mascot: '/mascot-high.png',
    title: 'Bienvenido a SocialBattery',
    body: '¡Hola! Soy tu compañera de energía. Aquí podrás compartir cómo te sientes socialmente cada día y conectar con quienes tienen la misma actitud que tú. 🔋',
    cta: '¡Vamos! ⚡',
    highlight: null,           // sin resaltado en el paso 1
    scrollTo: null,
  },
  {
    mascot: '/mascot-high.png',
    title: 'Tu batería social',
    body: '¡Actualiza tu batería social para que la vean todos tus amigos! 🔋✨',
    cta: 'Entendido',
    highlight: 'tutorial-battery-bar',   // ID del BatterySlider en HomePage
    scrollTo: 'tutorial-battery-bar',
  },
  {
    mascot: '/mascot-high.png',
    title: 'Tu círculo social',
    body: '¡Invita a tus amigos para crear tu círculo social! 👥🌟',
    cta: '¡Empezar!',
    highlight: 'tutorial-social-panels',  // wraper que cubre amigos + grupos
    scrollTo: 'tutorial-social-panels',
  },
];

export default function TutorialOverlay() {
  const { profile } = useAuth();
  const { isLight } = useTheme();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const prevHighlightRef = useRef(null);

  // Muestra el tutorial solo si el usuario no lo ha visto antes
  useEffect(() => {
    if (!profile?.id) return;
    const key = `${TUTORIAL_KEY}_${profile.id}`;
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [profile?.id]);

  // Gestión del resaltado y scroll al cambiar de paso
  useEffect(() => {
    if (!visible) return;

    const current = STEPS[step];

    // Eliminar clase de resaltado del paso anterior
    if (prevHighlightRef.current) {
      const prevEl = document.getElementById(prevHighlightRef.current);
      if (prevEl) {
        prevEl.classList.remove('tutorial-highlight');
      }
    }

    // Aplicar resaltado al elemento objetivo del paso actual
    if (current.highlight) {
      const el = document.getElementById(current.highlight);
      if (el) {
        el.classList.add('tutorial-highlight');
        prevHighlightRef.current = current.highlight;
        // Scroll suave hacia el elemento
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      }
    } else {
      prevHighlightRef.current = null;
      // Volver al top en el paso 1
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step, visible]);

  // Limpiar resaltados al cerrar
  useEffect(() => {
    if (!visible) {
      STEPS.forEach(s => {
        if (s.highlight) {
          const el = document.getElementById(s.highlight);
          if (el) el.classList.remove('tutorial-highlight');
        }
      });
      prevHighlightRef.current = null;
    }
  }, [visible]);

  function advance() {
    if (step < STEPS.length - 1) {
      setAnimKey(k => k + 1);
      setStep(s => s + 1);
    } else {
      dismiss();
    }
  }

  function dismiss() {
    if (!profile?.id) return;
    localStorage.setItem(`${TUTORIAL_KEY}_${profile.id}`, '1');
    setVisible(false);
    setStep(0);
  }

  if (!visible) return null;

  const current = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  return (
    <>
      {/* Fondo oscuro con blur — en pasos 2 y 3 es más transparente para ver el elemento */}
      <div
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
        onClick={dismiss}
        style={{
          // En pasos con resaltado el overlay tiene un "hueco" visual gracias al ring del elemento
          pointerEvents: 'auto',
        }}
      />

      {/* Panel del tutorial — anclado abajo en móvil */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center pb-28 sm:pb-8 px-4 pointer-events-none">
        <div
          className="relative w-full max-w-sm animate-slide-up pointer-events-auto"
          style={{ animationDuration: '0.35s' }}
        >
          {/* Mascota flotando sobre la tarjeta */}
          <div className="flex justify-center mb-[-20px] relative z-10 pointer-events-none select-none">
            <img
              key={`mascot-tutorial-${step}`}
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
                    background: i <= step
                      ? 'var(--sb-accent)'
                      : 'var(--sb-border)',
                    opacity: i < step ? 0.55 : 1,
                  }}
                />
              ))}
            </div>

            {/* Contenido de texto */}
            <div
              key={`content-${animKey}`}
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

            {/* Botones de acción */}
            <div className="flex gap-2">
              <button
                onClick={dismiss}
                className="py-3 px-4 rounded-xl border border-surface-border text-surface-muted text-sm font-display font-semibold
                  hover:text-surface-text hover:border-surface-muted transition-all"
              >
                Saltar
              </button>
              <button
                onClick={advance}
                className="flex-1 py-3 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display
                  font-semibold transition-all hover:shadow-lg hover:shadow-accent-primary/20"
              >
                {current.cta}
              </button>
            </div>

            {/* Contador de paso */}
            <p className="text-center text-xs text-surface-muted/50 mt-3 font-mono">
              {step + 1} / {STEPS.length}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
