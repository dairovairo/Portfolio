import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

// ── Clave de localStorage: incrementar versión si se resetea el tutorial ──────
const TUTORIAL_KEY = 'sb_tutorial_done_v1';

// ── Pasos del tutorial ────────────────────────────────────────────────────────
// En todos los pasos se usa la batería llena básica: /mascot-high.png
const STEPS = [
  {
    mascot: '/mascot-high.png',
    title: 'Bienvenido a SocialBattery',
    body: '¡Hola! Soy tu compañera de energía. Aquí podrás compartir cómo te sientes socialmente cada día y conectar con quienes tienen la misma actitud que tú. 🔋',
    cta: '¡Vamos! ⚡',
  },
  // Próximos pasos del tutorial — pendientes de implementar
];

export default function TutorialOverlay() {
  const { profile } = useAuth();
  const { isLight } = useTheme();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  // Muestra el tutorial solo si el usuario no lo ha visto antes
  useEffect(() => {
    if (!profile?.id) return;
    const key = `${TUTORIAL_KEY}_${profile.id}`;
    if (!localStorage.getItem(key)) {
      // Pequeño retraso para que el HomePage se renderice antes de mostrar el overlay
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [profile?.id]);

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
  }

  if (!visible) return null;

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-end justify-end sm:items-center sm:justify-center pb-28 sm:pb-0 px-4">
      {/* Fondo oscuro con blur */}
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-sm animate-slide-up"
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
  );
}
