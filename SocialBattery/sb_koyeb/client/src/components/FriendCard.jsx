import { getBatteryColor, formatRelativeTime } from '../lib/battery';

export default function FriendCard({ friend, onClick }) {
  const color = getBatteryColor(friend.battery_level ?? 50);

  return (
    <button
      onClick={onClick}
      className="w-full bg-surface-card hover:bg-surface-hover border border-surface-border rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 text-left group"
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
            (friend.display_name || friend.username)?.[0]?.toUpperCase()
          )}
        </div>
        {/* Mini battery dot */}
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-surface-card flex items-center justify-center"
          style={{ backgroundColor: color.hex }}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold text-surface-text truncate">
            {friend.display_name || friend.username}
          </span>
          {friend.battery_is_estimated && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
              ⚡est.
            </span>
          )}
        </div>
        <div className="text-xs text-surface-muted font-mono mt-0.5">
          @{friend.username}
        </div>
        <div className="text-xs text-surface-muted mt-1">
          {formatRelativeTime(friend.battery_updated_at)}
        </div>
      </div>

      {/* Battery level */}
      <div className="flex-shrink-0 text-right">
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
