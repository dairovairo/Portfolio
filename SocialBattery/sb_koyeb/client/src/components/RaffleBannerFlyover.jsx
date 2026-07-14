import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

// ── Banner volador de sorteos Light y Volt ──────────────────────────────────
// Al entrar en el menú principal (HomePage), comprobamos si el usuario ha
// sido "elegido" para ver el banner volador de algún sorteo Light o Volt
// activo (ver GET /api/community/raffle-banner en el servidor, que además
// marca la visualización como consumida y aplica la prioridad de Light
// sobre Volt — no se le volverá a mostrar por ese sorteo). El propio banner
// es la avioneta + pancarta "¡Sorteo nuevo!" cruzando la pantalla de
// izquierda a derecha; al tocarlo se navega a la comunidad del sorteo.
const TIER_STYLES = {
  light: {
    image: '/raffle-banner-plane.png',
    bannerClass: 'bg-amber-400 text-surface-bg',
    flagClass: 'border-l-amber-400',
  },
  volt: {
    image: '/raffle-banner-plane-volt.png',
    bannerClass: 'bg-blue-400 text-surface-bg',
    flagClass: 'border-l-blue-400',
  },
};

export default function RaffleBannerFlyover() {
  const navigate = useNavigate();
  const [banner, setBanner] = useState(null);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function checkBanner() {
      try {
        const data = await api.get('/community/raffle-banner');
        if (cancelled || !data?.banner) return;
        setBanner(data.banner);
        // Pequeño respiro tras cargar la home antes de que cruce la pantalla.
        timeoutRef.current = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, 900);
      } catch {
        // Silencioso: si falla, simplemente no se muestra el banner.
      }
    }

    checkBanner();
    return () => {
      cancelled = true;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!banner) return null;

  const style = TIER_STYLES[banner.tier] || TIER_STYLES.light;

  function handleAnimationEnd() {
    setBanner(null);
  }

  function handleClick() {
    setBanner(null);
    navigate(`/community/${banner.community_id}`);
  }

  return (
    <div className="fixed top-[18%] left-0 w-full pointer-events-none z-[60] overflow-hidden h-24">
      {visible && (
        <button
          onClick={handleClick}
          onAnimationEnd={handleAnimationEnd}
          className="raffle-flyover pointer-events-auto absolute top-0 flex items-center gap-0 cursor-pointer"
          style={{ left: 0 }}
          title={`🎁 ${banner.title} — ${banner.community_name}`}
        >
          {/* Pancarta remolcada, va detrás (a la izquierda) de la avioneta */}
          <span className={`flex items-center font-display font-bold text-sm sm:text-base px-4 py-2 rounded-md shadow-lg whitespace-nowrap -mr-2 relative ${style.bannerClass}`}>
            🎉 ¡Sorteo nuevo! · {banner.community_name}
            <span className={`absolute right-[-10px] top-1/2 -translate-y-1/2 w-0 h-0 border-y-[14px] border-y-transparent border-l-[10px] ${style.flagClass}`} />
          </span>
          {/* Cuerda de remolque */}
          <span className="w-6 h-[2px] bg-slate-400/70 flex-shrink-0" />
          <img
            src={style.image}
            alt="Sorteo nuevo"
            className="w-16 h-16 sm:w-20 sm:h-20 object-contain flex-shrink-0 drop-shadow-lg"
          />
        </button>
      )}
    </div>
  );
}
