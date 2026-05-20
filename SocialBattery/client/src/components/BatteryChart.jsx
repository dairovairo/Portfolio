import { useMemo } from 'react';
import { getBatteryColor } from '../lib/battery';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HOURS = [0, 6, 9, 12, 15, 18, 21, 23];

export function BatteryLineChart({ history }) {
  // Last 14 data points
  const points = useMemo(() => {
    return [...(history || [])].slice(0, 20).reverse();
  }, [history]);

  if (!points.length) return (
    <div className="text-center text-slate-500 text-sm py-8">Sin historial aún</div>
  );

  const W = 320, H = 120, PAD = 16;
  const minY = 0, maxY = 100;
  const toX = (i) => PAD + (i / (points.length - 1 || 1)) * (W - PAD * 2);
  const toY = (v) => PAD + (1 - v / maxY) * (H - PAD * 2);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.level)}`).join(' ');
  const fillD = `${pathD} L ${toX(points.length - 1)} ${H - PAD} L ${toX(0)} ${H - PAD} Z`;

  const lastColor = getBatteryColor(points[points.length - 1]?.level ?? 50);

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}>
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lastColor.hex} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lastColor.hex} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[25, 50, 75].map(v => (
          <line key={v} x1={PAD} y1={toY(v)} x2={W - PAD} y2={toY(v)}
            stroke="#1e1e2e" strokeWidth="1" />
        ))}
        {/* Fill */}
        <path d={fillD} fill="url(#chartFill)" />
        {/* Line */}
        <path d={pathD} fill="none" stroke={lastColor.hex} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Last dot */}
        <circle cx={toX(points.length - 1)} cy={toY(points[points.length - 1].level)}
          r="4" fill={lastColor.hex} style={{ filter: `drop-shadow(0 0 6px ${lastColor.hex})` }} />
      </svg>
      {/* Labels */}
      <div className="flex justify-between px-4 mt-1">
        {points.length >= 2 && (
          <>
            <span className="text-xs text-slate-600 font-mono">
              {DAYS[points[0].day_of_week]}
            </span>
            <span className="text-xs font-mono" style={{ color: lastColor.hex }}>
              {points[points.length - 1].level}% ahora
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function BatteryHeatmap({ history }) {
  // Build day-of-week × time-of-day averages
  const grid = useMemo(() => {
    const buckets = {};
    (history || []).forEach(h => {
      const timeSlot = Math.floor(h.hour / 6); // 0-3 (night, morning, afternoon, evening)
      const key = `${h.day_of_week}_${timeSlot}`;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(h.level);
    });
    return buckets;
  }, [history]);

  const slots = ['🌙', '🌅', '☀️', '🌆'];
  const slotLabels = ['Noche', 'Mañana', 'Tarde', 'Noche'];

  if (!Object.keys(grid).length) return (
    <div className="text-center text-slate-500 text-sm py-4">
      Actualiza tu batería varios días para ver el patrón
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-slate-600 font-mono text-left pr-2 pb-2"></th>
            {DAYS.map(d => (
              <th key={d} className="text-slate-500 font-mono font-normal pb-2 text-center">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, si) => (
            <tr key={si}>
              <td className="pr-2 py-1 text-center" title={slotLabels[si]}>{slot}</td>
              {DAYS.map((_, di) => {
                const key = `${di}_${si}`;
                const vals = grid[key];
                const avg = vals ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
                const color = avg !== null ? getBatteryColor(avg) : null;
                return (
                  <td key={di} className="py-1 px-0.5">
                    <div
                      className="h-7 rounded-md flex items-center justify-center font-mono text-xs font-bold transition-all"
                      style={color ? {
                        background: `${color.hex}25`,
                        color: color.hex,
                        border: `1px solid ${color.hex}40`,
                      } : {
                        background: '#1e1e2e',
                        color: '#334155',
                      }}
                      title={avg !== null ? `${avg}% (${vals.length} registros)` : 'Sin datos'}
                    >
                      {avg !== null ? avg : '·'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
