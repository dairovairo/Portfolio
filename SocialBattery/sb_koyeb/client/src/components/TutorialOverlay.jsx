import { useEffect, useRef, useState, useCallback } from 'react';
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
//  spotlight:  true = usar efecto recorte (todo borroso menos el elemento)
//
const STEPS = [
  {
    mascot:     '/mascot-high.png',
    title:      'Bienvenido a SocialBattery',
    body:       '\u00a1Hola! soy Volty. Aqu\u00ed podr\u00e1s compartir c\u00f3mo te sientes socialmente cada d\u00eda y conectar con quienes tienen la misma actitud que t\u00fa. \ud83d\udd0b',
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
    spotlight:  true,
    mascotRight: true,   // mascota flotante a la derecha del título
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
    panelTop:   true,
    compactTop:  true,       // panel pequeño anclado arriba
    mascotRight: true,       // mascota a la derecha dentro del panel
    noHighlight: true,       // sin cuadrado azul de realce
    noBlur:      true,       // sin efecto borroso en el fondo
    scrollBlock: 'start',    // scroll mínimo: lleva el top del elemento al top visible
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Quedadas',
    body:       '\u00a1Puedes organizar quedadas con tus amigos! \ud83e\udd1d\ud83d\udcc5',
    cta:        'Siguiente',
    page:       '/pools',
    highlight:  'tutorial-pools-header',
    navigateTo: '/messages/inbox',
    switchTab:  null,
    spotlight:  true,
    mascotRight: true,
  },
  {
    mascot:     '/mascot-high.png',
    title:      'Mensajes',
    body:       '\u00a1Comun\u00edcate con tus amigos cuando quieras! \ud83d\udcac\u26a1',
    cta:        'Siguiente',
    page:       '/messages/inbox',
    highlight:  'tutorial-messages-header',
    navigateTo: '/community',
    switchTab:  null,
    spotlight:  true,
    mascotRight: true,
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
    highlight:  null,
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
  const [spotlightRect, setSpotlightRect] = useState(null);

  const current = STEPS[step] ?? STEPS[TOTAL - 1];
  const isSpotlight = !!(current.spotlight && current.highlight && current.page === currentPage);

  // ── Calcular rect del elemento spotlight ─────────────────────────────────
  const updateSpotlightRect = useCallback(() => {
    if (!isSpotlight) { setSpotlightRect(null); return; }
    const el = document.getElementById(current.highlight);
    if (el) {
      const r = el.getBoundingClientRect();
      setSpotlightRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
  }, [isSpotlight, current.highlight]);

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

    // Quitar resaltado anterior (sólo si no es spotlight, que no usa clase CSS)
    if (prevHighlightRef.current) {
      const el = document.getElementById(prevHighlightRef.current);
      if (el) el.classList.remove('tutorial-highlight');
    }

    if (current.highlight && current.page === currentPage) {
      const t = setTimeout(() => {
        const el = document.getElementById(current.highlight);
        if (el) {
          // En modo spotlight elevamos z-index pero sin outline
          if (current.spotlight) {
            el.style.position = 'relative';
            el.style.zIndex = '45';
            updateSpotlightRect();
          } else if (!current.noHighlight) {
            el.classList.add('tutorial-highlight');
          }
          prevHighlightRef.current = current.highlight;
          el.scrollIntoView({ behavior: 'smooth', block: current.scrollBlock || 'center' });
        }
      }, 120);
      return () => clearTimeout(t);
    } else {
      prevHighlightRef.current = null;
      setSpotlightRect(null);
    }
  }, [active, step, currentPage, current.highlight, current.page, current.spotlight, updateSpotlightRect]);

  // Recalcular rect en resize/scroll
  useEffect(() => {
    if (!isSpotlight) return;
    const recalc = () => updateSpotlightRect();
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [isSpotlight, updateSpotlightRect]);

  // ── Limpiar resaltados al cerrar ─────────────────────────────────────────
  useEffect(() => {
    if (!active) {
      STEPS.forEach(s => {
        if (s.highlight) {
          const el = document.getElementById(s.highlight);
          if (el) {
            el.classList.remove('tutorial-highlight');
            if (s.spotlight) {
              el.style.position = '';
              el.style.zIndex = '';
            }
          }
        }
      });
      prevHighlightRef.current = null;
      setSpotlightRect(null);
    }
  }, [active]);

  // Solo renderizar si el tutorial está activo y estamos en la página correcta
  if (!active || current.page !== currentPage) return null;

  function handleAdvance() {
    // Limpiar spotlight inline styles del paso actual antes de avanzar
    if (current.spotlight && current.highlight) {
      const el = document.getElementById(current.highlight);
      if (el) { el.style.position = ''; el.style.zIndex = ''; }
    }
    if (step >= TOTAL - 1) {
      // Último paso: cerrar siempre el tutorial, luego navegar si procede
      dismiss();
      if (current.navigateTo) navigate(current.navigateTo);
    } else if (current.navigateTo) {
      advance();
      navigate(current.navigateTo);
    } else {
      advance();
    }
  }

  // ── Overlay: en spotlight usamos SVG clip-path para "recortar" la zona ───
  const PAD = 12;    // padding alrededor del elemento resaltado
  const RADIUS = 16; // border-radius del recorte
  const panelTop    = !!current.panelTop;
  const compactTop  = !!current.compactTop;   // reservado para futuros pasos compactos sin mascota
  const mascotRight = !!current.mascotRight;  // mascota flotante dentro de la tarjeta a la derecha
  const noBlur      = !!current.noBlur;       // sin efecto borroso en el fondo

  const mascotStyle = {
    animation: 'mascotFadeIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
    filter: isLight
      ? 'drop-shadow(0 0 22px rgba(0,148,158,0.45))'
      : 'drop-shadow(0 0 26px rgba(45,212,220,0.55))',
  };

  return (
    <>
      {/* Fondo oscuro / spotlight */}
      {isSpotlight && spotlightRect ? (
        <svg
          className="fixed inset-0 z-40 pointer-events-none"
          style={{ width: '100vw', height: '100vh' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="sb-blur">
              <feGaussianBlur stdDeviation="2" />
            </filter>
            <mask id="sb-spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={spotlightRect.left - PAD}
                y={spotlightRect.top - PAD}
                width={spotlightRect.width + PAD * 2}
                height={spotlightRect.height + PAD * 2}
                rx={RADIUS} ry={RADIUS}
                fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="transparent" filter="url(#sb-blur)" />
          <rect
            width="100%" height="100%"
            fill="rgba(0,0,0,0.60)"
            mask="url(#sb-spotlight-mask)"
            style={{ pointerEvents: 'auto' }}
          />
          <rect
            x={spotlightRect.left - PAD}
            y={spotlightRect.top - PAD}
            width={spotlightRect.width + PAD * 2}
            height={spotlightRect.height + PAD * 2}
            rx={RADIUS} ry={RADIUS}
            fill="none"
            stroke="rgba(45,212,220,0.70)"
            strokeWidth="2"
          />
        </svg>
      ) : (
        <div
          className={`fixed inset-0 z-40 bg-black/55${noBlur ? '' : ' backdrop-blur-[2px]'}`}
        />
      )}

      {/* ── PASO compacto: panel pequeño anclado arriba, con mascota opcional ─── */}
      {compactTop && (
        <div className="fixed top-0 inset-x-0 z-50 flex justify-center px-4 pt-4 pointer-events-none">
          <div
            className="w-full max-w-sm pointer-events-auto animate-slide-up"
            style={{ animationDuration: '0.35s' }}
          >
            <div className="bg-surface-card border border-surface-border rounded-2xl px-4 py-3 shadow-2xl">
              {/* Progreso */}
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-1">
                  {STEPS.map((_, i) => (
                    <div
                      key={i}
                      className="rounded-full transition-all duration-300"
                      style={{
                        width: i === step ? 16 : 5,
                        height: 5,
                        background: i <= step ? 'var(--sb-accent)' : 'var(--sb-border)',
                        opacity: i < step ? 0.55 : 1,
                      }}
                    />
                  ))}
                </div>
                <span className="text-xs text-surface-muted/50 font-mono">{step + 1}/{TOTAL}</span>
              </div>
              {/* Contenido + mascota opcional a la derecha */}
              <div className="flex items-start gap-2 mb-3">
                <div
                  key={`content-${step}`}
                  className="flex-1 min-w-0"
                  style={{ animation: 'slideUp 0.28s ease-out both' }}
                >
                  <h2 className="font-display text-base font-bold text-surface-text mb-1 leading-snug">
                    {current.title}
                  </h2>
                  <p className="text-surface-muted text-xs leading-relaxed">
                    {current.body}
                  </p>
                </div>
                {mascotRight && (
                  <div className="pointer-events-none select-none flex-shrink-0 mt-[-10px] mr-[-6px]">
                    <img
                      key={`mascot-${step}`}
                      src={current.mascot}
                      alt="Mascota SocialBattery"
                      className="w-20 h-20 object-contain"
                      draggable={false}
                      style={mascotStyle}
                    />
                  </div>
                )}
              </div>
              {/* Botón */}
              <div className="flex gap-2">
                <button
                  onClick={handleAdvance}
                  className="flex-1 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-display
                    font-semibold transition-all hover:shadow-lg hover:shadow-accent-primary/20"
                >
                  {current.cta}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PASOS NORMALES: panel abajo (o arriba con mascota) ───────────────── */}
      {!compactTop && (
        <div
          className={`fixed inset-x-0 z-50 flex flex-col items-center px-4 pointer-events-none ${
            panelTop ? 'top-0 pt-4 sm:pt-6' : 'bottom-0 pb-28 sm:pb-8'
          }`}
        >
          <div
            className="relative w-full max-w-sm animate-slide-up pointer-events-auto"
            style={{ animationDuration: '0.35s' }}
          >
            {/* Mascota encima (panel abajo, no mascotRight) */}
            {!panelTop && !mascotRight && (
              <div className="flex justify-center mb-[-20px] relative z-10 pointer-events-none select-none">
                <img
                  key={`mascot-${step}`}
                  src={current.mascot}
                  alt="Mascota SocialBattery"
                  className="w-36 h-36 object-contain"
                  draggable={false}
                  style={mascotStyle}
                />
              </div>
            )}

            {/* Tarjeta */}
            <div className={`bg-surface-card border border-surface-border rounded-3xl shadow-2xl ${
              mascotRight ? 'px-5 pt-5 pb-5' : 'px-6 pt-8 pb-6'
            }`}>

              {/* Fila superior: progreso + mascota a la derecha (mascotRight) */}
              <div className={`flex items-start ${mascotRight ? 'gap-3 mb-4' : 'flex-col'}`}>
                {/* Columna texto */}
                <div className="flex-1 min-w-0">
                  {/* Puntos de progreso */}
                  <div className="flex items-center gap-1.5 mb-4">
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
                    className={`mb-5 ${mascotRight ? 'text-left' : 'text-center'}`}
                    style={{ animation: 'slideUp 0.28s ease-out both' }}
                  >
                    <h2 className="font-display text-xl font-bold text-surface-text mb-2 leading-snug">
                      {current.title}
                    </h2>
                    <p className="text-surface-muted text-sm leading-relaxed">
                      {current.body}
                    </p>
                  </div>
                </div>

                {/* Mascota a la derecha del título (mascotRight) */}
                {mascotRight && (
                  <div className="pointer-events-none select-none flex-shrink-0 mt-[-8px] mr-[-8px]">
                    <img
                      key={`mascot-${step}`}
                      src={current.mascot}
                      alt="Mascota SocialBattery"
                      className="w-24 h-24 object-contain"
                      draggable={false}
                      style={mascotStyle}
                    />
                  </div>
                )}
              </div>

              {/* Botones */}
              <div className="flex gap-2">
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

            {/* Mascota debajo cuando panel arriba (sin mascotRight) */}
            {panelTop && !mascotRight && (
              <div className="flex justify-center mt-[-20px] relative z-10 pointer-events-none select-none">
                <img
                  key={`mascot-${step}`}
                  src={current.mascot}
                  alt="Mascota SocialBattery"
                  className="w-36 h-36 object-contain"
                  draggable={false}
                  style={mascotStyle}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
