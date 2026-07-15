import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

// ── Banner volador de sorteos Community, Light y Volt ───────────────────────
// Al entrar en el menú principal (HomePage), comprobamos si el usuario ha
// sido "elegido" para ver el banner volador de algún sorteo Community,
// Light o Volt activo (ver GET /api/community/raffle-banner en el servidor,
// que además marca la visualización como consumida y aplica la prioridad
// Community > Light > Volt — no se le volverá a mostrar por ese sorteo).
// Dentro de cada uno de esos tres tipos, si el usuario tiene pendiente más
// de un sorteo, el servidor prioriza el que pertenezca a una comunidad de
// la que el usuario ya es miembro sobre uno de una comunidad ajena (los
// Community siempre son de la propia comunidad del usuario; los Light y
// Volt pueden o no serlo). El servidor limita además a como mucho una
// avioneta cada 15 minutos por usuario, sea cual sea el sorteo, para no
// saturarle si entra varias veces seguidas a la app. El
// propio banner es la avioneta + pancarta "¡Sorteo nuevo!" cruzando la
// pantalla de izquierda a derecha; al tocarlo se navega a la comunidad del
// sorteo. A diferencia de Light/Volt (que se reparten entre usuarios de
// toda la app), el banner Community solo se reparte entre los miembros de
// la propia comunidad del sorteo (ver assignRaffleBannerTargets en el
// servidor).
const TIER_STYLES = {
  light: {
    image: '/raffle-banner-plane.png',
    bannerClass: 'bg-gradient-to-r from-amber-400 to-amber-300 text-surface-bg',
    flagClass: 'border-l-amber-300',
    ringClass: 'ring-amber-200/60',
  },
  volt: {
    image: '/raffle-banner-plane-volt.png',
    bannerClass: 'bg-gradient-to-r from-blue-400 to-sky-300 text-surface-bg',
    flagClass: 'border-l-sky-300',
    ringClass: 'ring-sky-200/60',
  },
  community: {
    image: '/raffle-banner-plane-community.png',
    bannerClass: 'bg-gradient-to-r from-red-400 to-rose-300 text-surface-bg',
    flagClass: 'border-l-rose-300',
    ringClass: 'ring-rose-200/60',
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
    navigate(`/community/${banner.community_id}#raffle-${banner.raffle_id}`);
  }

  return (
    <div className="fixed top-[16%] left-0 w-full pointer-events-none z-[60] overflow-hidden h-32 sm:h-36">
      {visible && (
        <button
          onClick={handleClick}
          onAnimationEnd={handleAnimationEnd}
          className="raffle-flyover pointer-events-auto absolute top-0 flex items-center gap-0 cursor-pointer"
          style={{ left: 0 }}
          title={`🎁 ${banner.title} — ${banner.community_name}`}
        >
          {/* Pancarta remolcada, va detrás (a la izquierda) de la avioneta */}
          <span className={`flex items-center gap-3 pl-2 pr-5 py-2 rounded-xl shadow-xl ring-1 ${style.ringClass} whitespace-nowrap -mr-2 relative ${style.bannerClass}`}>
            {/* Foto del evento/sorteo, o icono de respaldo si no tiene */}
            <span className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden flex-shrink-0 bg-white/25 ring-2 ring-white/70 shadow-inner">
              {banner.image_url ? (
                <img
                  src={banner.image_url}
                  alt={banner.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-2xl">🎁</span>
              )}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-display font-extrabold text-base sm:text-lg drop-shadow-sm">
                🎉 ¡Sorteo nuevo!
              </span>
              <span className="font-display font-semibold text-xs sm:text-sm opacity-90 truncate max-w-[38vw]">
                {banner.community_name}
              </span>
            </span>
            <span className={`absolute right-[-12px] top-1/2 -translate-y-1/2 w-0 h-0 border-y-[18px] border-y-transparent border-l-[12px] ${style.flagClass}`} />
          </span>
          {/* Cuerda de remolque */}
          <span className="w-7 h-[2px] bg-slate-400/70 flex-shrink-0" />
          <img
            src={style.image}
            alt="Sorteo nuevo"
            className="w-20 h-20 sm:w-24 sm:h-24 object-contain flex-shrink-0 drop-shadow-lg"
          />
        </button>
      )}
    </div>
  );
}
