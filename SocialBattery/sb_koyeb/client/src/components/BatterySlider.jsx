import { useState, useCallback } from 'react';
import { getBatteryColor } from '../lib/battery';

export default function BatterySlider({ value, onChange, readonly = false, isEstimated = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const color = getBatteryColor(value);

  const segments = Array.from({ length: 20 }, (_, i) => {
    const segLevel = (i + 1) * 5;
    const filled = segLevel <= value;
    const segColor = getBatteryColor(segLevel);
    return { i, filled, hex: segColor.hex };
  });

  return (
    <div className="w-full">
      {/* Visual battery bar */}
      <div className="relative mb-6">
        <div className="flex items-center gap-1 h-10">
          {segments.map(({ i, filled, hex }) => (
            <div
              key={i}
              className="flex-1 h-full rounded-sm transition-all duration-150"
              style={{
                backgroundColor: filled ? hex : '#1e1e2e',
                opacity: filled ? 1 : 0.5,
                boxShadow: filled ? `0 0 6px ${hex}40` : 'none',
              }}
            />
          ))}
          {/* Battery tip */}
          <div className="w-2 h-4 bg-slate-600 rounded-r-sm ml-0.5 flex-shrink-0" />
        </div>
      </div>

      {/* Level display */}
      <div className="text-center mb-6">
        <span
          className="font-display text-7xl font-800 tabular-nums transition-colors duration-200"
          style={{ color: color.hex, textShadow: `0 0 40px ${color.hex}60` }}
        >
          {value}
        </span>
        <span className="font-display text-2xl text-surface-muted ml-1">%</span>
        <div
          className="text-sm font-mono mt-1 uppercase tracking-widest transition-colors duration-200"
          style={{ color: color.hex }}
        >
          {color.label}
        </div>
        {isEstimated && (
          <div className="mt-2 inline-flex items-center gap-1.5 bg-yellow-500/15 border border-yellow-500/25 text-yellow-400 text-xs font-mono px-3 py-1.5 rounded-full">
            <span>⚡</span>
            <span>Batería estimada por IA · No actualizada hoy</span>
          </div>
        )}
      </div>

      {/* Slider */}
      {!readonly && (
        <div className="relative px-1">
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => setIsDragging(false)}
            onTouchStart={() => setIsDragging(true)}
            onTouchEnd={() => setIsDragging(false)}
            className="w-full appearance-none h-2 rounded-full outline-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${color.hex} 0%, ${color.hex} ${value}%, #1e1e2e ${value}%, #1e1e2e 100%)`,
            }}
          />
        </div>
      )}

      <style>{`
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: white;
          border: 3px solid ${color.hex};
          box-shadow: 0 0 12px ${color.hex}80;
          cursor: pointer;
          transition: box-shadow 0.15s;
        }
        input[type='range']::-webkit-slider-thumb:hover {
          box-shadow: 0 0 20px ${color.hex};
        }
        input[type='range']::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: white;
          border: 3px solid ${color.hex};
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
