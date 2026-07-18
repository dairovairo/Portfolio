import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { isOnline } from '../hooks/usePresence';
import { useSettings } from '../context/SettingsContext';
import MascotDisplay from './MascotDisplay';
import { MASCOT_PREVIEW_OVERLAY_STYLE } from '../lib/mascotRenderer';

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// HomePage.jsx): 0-33 → low, 34-66 → mid, 67-100 → high.
function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

export default function FriendCard({ friend, online: onlineProp, onClick }) {
  const color = getBatteryColor(friend.battery_level ?? 50);
  const tier = getMascotTier(friend.battery_level ?? 50);
  const { showLastSeen } = useSettings();
  // If caller passes online prop (reactive), use it; otherwise fall back to local check
  const online = onlineProp !== undefined ? onlineProp : isOnline(friend.last_seen_at);

  return (
    <button
      onClick={onClick}
      className="w-full bg-surface-card hover:bg-surface-hover border border-surface-border rounded-2xl p-[18px] flex items-center gap-4 transition-all duration-200 text-left group"
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-display font-bold border-2 transition-all duration-200"
          style={{
            borderColor: color.hex,
            boxShadow: `0 0 12px ${color.hex}30`,
            background: `${color.hex}15`,
          }}
        >
          {friend.avatar_url ? (
            <img src={friend.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            friend.username?.[0]?.toUpperCase()
          )}
        </div>
        {/* Online dot */}
        <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-surface-card ${online ? 'bg-green-400' : 'bg-slate-600'}`} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold text-surface-text truncate">
            {friend.username}
          </span>
          {friend.battery_is_estimated && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
              ⚡est.
            </span>
          )}
        </div>
        {showLastSeen && (
          <div className="text-xs text-surface-muted mt-1">
            Última actualización: {formatRelativeTime(friend.battery_updated_at)}
          </div>
        )}
      </div>

      {/* Mascota — refleja el nivel de batería del amigo. La base (color/
          tier) se resuelve siempre localmente a partir de su battery_level,
          pero la ropa/calzado/gorro/accesorios/actividad NO viven aquí: son
          personalización local de cada usuario. Para poder mostrarla, cada
          cliente "hornea" su propio equipado en un PNG (ver
          lib/mascotRenderer.js → renderMascotOverlayBlob y
          components/MascotPreviewSync.jsx) que se sube al servidor
          (users.mascot_preview_url) y llega aquí como
          friend.mascot_preview_url — simplemente se superpone encima de la
          mascota base, ya recoloreado y posicionado.
          Colocada a la derecha del nombre de perfil (antes iba a la
          izquierda, entre el avatar y el nombre). */}
      <div className="relative flex-shrink-0 flex flex-col items-center" style={{ width: 56 }}>
        <div className="relative" style={{ width: 56, height: 56 }}>
          <MascotDisplay
            tier={tier}
            size={56}
            glowColor={color.hex}
            outfitSrc={null}
            feetSrc={null}
            headSrc={null}
            accessories={[]}
            activityLayers={[]}
          />
          {friend.mascot_preview_url && (
            <img
              src={friend.mascot_preview_url}
              alt=""
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={MASCOT_PREVIEW_OVERLAY_STYLE}
            />
          )}
        </div>
        <span className="text-[9px] font-display font-semibold text-surface-muted mt-0.5 max-w-[56px] truncate">
          {friend.mascot_name || 'Volty'}
        </span>
      </div>

      {/* Battery level — ancho fijo (suficiente para "100") para que el
          número no cambie de tamaño entre 1 y 2 dígitos; si no, al ser
          flex-shrink-0 dentro del flex, hace que "Info" (flex-1) se encoja
          o crezca y desplace todo lo que va después, incluida la mascota. */}
      <div className="flex-shrink-0 text-right w-12">
        <div
          className="font-display text-2xl font-bold tabular-nums transition-colors duration-200"
          style={{ color: color.hex }}
        >
          {friend.battery_level ?? '—'}
        </div>
        <div className="text-xs text-surface-muted font-mono">%</div>
      </div>

      {/* Mini bar — fills bottom to top */}
      <div className="w-1.5 h-12 bg-surface-bg rounded-full flex-shrink-0 overflow-hidden relative">
        <div
          className="absolute bottom-0 w-full rounded-full transition-all duration-500"
          style={{
            height: `${friend.battery_level ?? 0}%`,
            backgroundColor: color.hex,
            boxShadow: `0 0 8px ${color.hex}`,
          }}
        />
      </div>
    </button>
  );
}
